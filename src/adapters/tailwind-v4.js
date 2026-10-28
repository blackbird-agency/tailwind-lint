'use strict';

const fs = require('fs');
const path = require('path');
const { assertLocked } = require('../lockfile');
const { readHyvaConfig, isHyvaTheme, hyvaModules, hyvaSourceCss, hyvaTokensCss, assertMagentoRoot } = require('../hyva');
const postcss = require('postcss');
const micromatch = require('micromatch');

const SPACING_KEYS = new Set([
    'width', 'height', 'size', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'flexBasis', 'gap', 'space',
    'translate', 'inset', 'padding', 'margin', 'lineHeight',
]);

const NAMED_NAMESPACES = {
    width: ['--container', '--width'],
    maxWidth: ['--container', '--max-width'],
    minWidth: ['--container', '--min-width'],
    height: ['--height'],
    minHeight: ['--min-height'],
    maxHeight: ['--max-height'],
    size: ['--size'],
    fontSize: ['--text'],
    lineHeight: ['--leading'],
    borderRadius: ['--radius'],
};

const STATIC_KEYS = {
    borderRadius: { none: '0', full: 'calc(infinity * 1px)' },
};

// Comments are matched first so that an @import inside a comment is skipped (group 1 unset).
const IMPORT = /\/\*[\s\S]*?\*\/|@import\s+(?:url\()?\s*["']([^"']+)["'][^;]*;?/g;
const TOKENS_SLOT = '/* tailwind-lint: hyva-tokens.css */';

function parse(file, css) {
    try {
        return postcss.parse(css, { from: file });
    } catch (error) {
        throw new Error(`tailwind-lint: cannot parse ${file}: ${error.reason ?? error.message}`);
    }
}

// Targets inside generated/ are resolved without touching the disk: their files may be stale.
function resolveImport(from, target, generatedDir) {
    if (!target.startsWith('.') && !path.isAbsolute(target)) return null;
    const resolved = path.resolve(path.dirname(from), target);
    if (resolved.endsWith('.css')) return resolved;
    if (resolved.startsWith(generatedDir + path.sep)) return `${resolved}.css`;
    return [`${resolved}.css`, path.join(resolved, 'index.css')].find(fs.existsSync) ?? resolved;
}

function unrebuildable(file, target) {
    return new Error(`tailwind-lint: ${file} imports ${target}, a generated file tailwind-lint cannot rebuild`);
}

function rewriteEntry(entry, generatedDir, hyva) {
    const isGenerated = (target) => target.startsWith(generatedDir + path.sep);
    return fs.readFileSync(entry, 'utf8').replace(IMPORT, (whole, target) => {
        if (target === undefined) return whole;
        const resolved = resolveImport(entry, target, generatedDir);
        if (!resolved || !isGenerated(resolved)) return whole;
        const name = path.relative(generatedDir, resolved);
        if (hyva && name === 'hyva-source.css') return hyva.sourceCss;
        if (hyva && name === 'hyva-tokens.css') return TOKENS_SLOT;
        throw unrebuildable(entry, resolved);
    });
}

function collectFiles(entry, css, generatedDir) {
    const files = [];
    const seen = new Set();
    const visit = (file, text) => {
        if (seen.has(file)) return;
        seen.add(file);
        files.push({ file, css: text, root: parse(file, text) });
        for (const match of text.matchAll(IMPORT)) {
            if (match[1] === undefined) continue;
            const target = resolveImport(file, match[1], generatedDir);
            if (!target) continue;
            if (target.startsWith(generatedDir + path.sep)) throw unrebuildable(file, target);
            if (fs.existsSync(target)) visit(target, fs.readFileSync(target, 'utf8'));
        }
    };
    visit(entry, css);
    return files;
}

function themeVariables(files) {
    const variables = new Map();
    for (const { root } of files) {
        root.walkAtRules('theme', (theme) => {
            theme.walkDecls(/^--/, (decl) => variables.set(decl.prop, decl.value));
        });
    }
    return variables;
}

function sourceGlobs(files) {
    const globs = { include: [], ignore: [] };
    for (const { file, css } of files) {
        for (const match of css.matchAll(/@source\s+(not\s+)?["']([^"']+)["']/g)) {
            const target = path.resolve(path.dirname(file), match[2]);
            globs[match[1] ? 'ignore' : 'include'].push(/[*{]/.test(match[2]) || path.extname(target) ? target : `${target}/**`);
        }
    }
    return globs;
}

function markers(files) {
    const found = new Set(['group', 'peer']);
    for (const { root } of files) {
        root.walkAtRules('custom-variant', (rule) => {
            if (/^dark\b/.test(rule.params) && rule.toString().includes('.dark')) found.add('dark');
        });
    }
    return found;
}

function onlyLayers(node) {
    for (let parent = node.parent; parent && parent.type !== 'root'; parent = parent.parent) {
        if (parent.type !== 'atrule' || parent.name !== 'layer') return false;
    }
    return true;
}

function unescapeClass(selector) {
    const match = selector.trim().match(/^\.((?:\\[0-9a-fA-F]{1,6} ?|\\.|[\w-])+)$/);
    if (!match) return null;
    return match[1].replace(/\\([0-9a-fA-F]{1,6}) ?|\\(.)/g, (_, hex, char) => (hex ? String.fromCodePoint(parseInt(hex, 16)) : char));
}

function buildComponentIndex(files) {
    const names = new Set();
    const applied = new Map();
    const add = (name, params) => {
        if (!applied.has(name)) applied.set(name, new Set());
        params.replace(/!important/g, '').split(/\s+/).filter(Boolean).forEach((token) => applied.get(name).add(token));
    };
    for (const { root } of files) {
        root.walkAtRules('utility', (rule) => {
            if (!rule.params.endsWith('-*')) names.add(rule.params.trim());
        });
        root.walkRules((rule) => {
            if (!onlyLayers(rule)) return;
            rule.selectors.map(unescapeClass).filter(Boolean).forEach((name) => names.add(name));
        });
        root.walkAtRules('apply', (rule) => {
            const owner = rule.parent;
            if (owner?.type === 'atrule' && owner.name === 'utility') add(owner.params.trim(), rule.params);
            if (owner?.type !== 'rule' || !onlyLayers(owner)) return;
            owner.selectors.map(unescapeClass).filter(Boolean).forEach((name) => add(name, rule.params));
        });
    }
    return { names, applied };
}

function hyvaContext(root, cssDir, name, configFile) {
    if (!root) throw new Error(`tailwind-lint: site ${name} is a Hyvä theme, the Magento root is required`);
    assertMagentoRoot(configFile, root);
    const config = readHyvaConfig(cssDir);
    const area = config?.tailwind?.area ?? 'frontend';
    return { config, sourceCss: hyvaSourceCss(root, hyvaModules(root, config), area) };
}

function loadSite({ name, config: configFile, css }, req, root) {
    const hyvaTheme = isHyvaTheme(path.dirname(configFile), fs.existsSync(css) ? fs.readFileSync(css, 'utf8') : '');
    assertLocked(req, ['tailwindcss', '@tailwindcss/node', ...(hyvaTheme ? ['@hyva-themes/hyva-modules'] : [])]);
    const cssDir = path.dirname(css);
    const generatedDir = path.join(cssDir, 'generated');
    const hyva = hyvaTheme ? hyvaContext(root, cssDir, name, configFile) : null;
    const entryCss = rewriteEntry(css, generatedDir, hyva);
    const files = collectFiles(css, entryCss, generatedDir);
    const themeFile = req.resolve('tailwindcss/theme.css');
    const defaults = themeVariables([{ root: parse(themeFile, fs.readFileSync(themeFile, 'utf8')) }]);
    let project = themeVariables(files);
    let variables = new Map([...defaults, ...project]);
    const globs = sourceGlobs(files);
    const components = buildComponentIndex(files);
    const signatures = new Map();
    const generated = new Map();
    let declared = null;
    let compiler = null;
    let designSystem = null;
    let ready = null;

    const scales = new Map();
    const prepare = () => {
        ready ??= (async () => {
            const tokens = entryCss.includes(TOKENS_SLOT) ? (await hyvaTokensCss(cssDir, hyva.config, req)) ?? '' : '';
            const finalCss = entryCss.replace(TOKENS_SLOT, () => tokens);
            files[0] = { file: css, css: finalCss, root: parse(css, finalCss) };
            project = themeVariables(files);
            variables = new Map([...defaults, ...project]);
            scales.clear();
            const tailwind = req('@tailwindcss/node');
            [compiler, designSystem] = await Promise.all([
                tailwind.compile(finalCss, { base: cssDir, from: css, onDependency: () => {} }),
                tailwind.__unstable__loadDesignSystem(finalCss, { base: cssDir }),
            ]);
            declared = new Set(components.names);
            parse(`${css} (compiled)`, compiler.build([])).walkRules((rule) => {
                for (const match of rule.selector.matchAll(/\.((?:\\.|[\w-])+)/g)) declared.add(match[1].replace(/\\(.)/g, '$1'));
            });
        })();
        return ready;
    };

    const resolve = (value) => {
        let out = value;
        for (let pass = 0; pass < 4 && out.includes('var(--'); pass++) {
            out = out.replace(/var\((--[\w-]+)\)/g, (whole, variable) => variables.get(variable) ?? whole);
        }
        return out.replace(/\s+/g, ' ').trim();
    };

    // Not every quarter step v4 accepts: any pixel value would become a key (`w-[37px]` → `w-9.25`).
    const spacingGrid = () => {
        const unit = String(resolve(variables.get('--spacing') ?? '')).match(/^(\d*\.?\d+)(rem|px)$/);
        if (!unit) return {};
        const pixels = Number(unit[1]) * (unit[2] === 'rem' ? 16 : 1);
        const grid = { px: '1px' };
        for (const step of [0.5, 1.5, 2.5, 3.5]) grid[String(step)] = `${step * pixels}px`;
        for (let step = 0; step <= 400; step++) grid[String(step)] = `${step * pixels}px`;
        return grid;
    };

    const buildScale = (key) => {
        const named = { ...(STATIC_KEYS[key] ?? {}) };
        for (const namespace of NAMED_NAMESPACES[key] ?? []) {
            for (const [variable, value] of variables) {
                const suffix = variable.startsWith(`${namespace}-`) ? variable.slice(namespace.length + 1) : '';
                if (!suffix || suffix.includes('--')) continue;
                // Like a v3 [fontSize, lineHeight] tuple: `text-base` also sets the line height.
                const lineHeight = variables.get(`${variable}--line-height`);
                named[suffix] = lineHeight ? [resolve(value), resolve(lineHeight)] : resolve(value);
            }
        }
        return SPACING_KEYS.has(key) ? { ...spacingGrid(), ...named } : named;
    };
    const assertReady = (method) => {
        if (!declared) throw new Error(`tailwind-lint: ${method}() called before loadClasses or loadSignatures`);
    };
    const scale = (key) => {
        assertReady('scale');
        if (!scales.has(key)) scales.set(key, buildScale(key));
        return scales.get(key);
    };

    return {
        name,
        version: 4,
        markers: markers(files),
        postcss,
        covers(absFile) {
            if (absFile.endsWith('.css')) return absFile.startsWith(cssDir + path.sep);
            return micromatch.isMatch(absFile, globs.include, { ignore: globs.ignore });
        },
        isDefaultShade(color) {
            assertReady('isDefaultShade');
            if (!/^[a-z]+-\d+$/.test(color)) return false;
            const variable = `--color-${color}`;
            return !project.has(variable) && defaults.has(variable);
        },
        scale,
        closure(className) {
            if (!components.names.has(className)) return null;
            const applied = components.applied.get(className) ?? new Set();
            const own = signatures.get(className) ?? [];
            const ownSet = new Set(own.map(([property, value]) => `${property}:${resolve(value)}`));
            return {
                has(token) {
                    if (applied.has(token)) return true;
                    const declarations = (signatures.get(token) ?? []).filter(([property]) => !property.startsWith('--tw-'));
                    return declarations.length > 0
                        && declarations.every(([property, value]) => ownSet.has(`${property}:${resolve(value)}`));
                },
            };
        },
        async loadSignatures(classNames) {
            await prepare();
            const missing = new Set(classNames.filter((className) => !signatures.has(className)));
            if (!missing.size) return;
            const found = new Map();
            postcss.parse(compiler.build([...missing])).walkRules((rule) => {
                if (!onlyLayers(rule)) return;
                for (const className of rule.selectors.map(unescapeClass)) {
                    if (!missing.has(className)) continue;
                    const declarations = found.get(className) ?? [];
                    rule.each((node) => node.type === 'decl' && declarations.push([node.prop, node.value]));
                    found.set(className, declarations);
                }
            });
            missing.forEach((className) => signatures.set(className, found.get(className) ?? null));
        },
        async loadClasses(raws) {
            await prepare();
            const missing = [...new Set(raws)].filter((raw) => !generated.has(raw));
            if (!missing.length) return;
            designSystem.candidatesToCss(missing).forEach((output, index) => generated.set(missing[index], output !== null));
        },
        generates(raw) {
            if (!generated.has(raw)) throw new Error(`tailwind-lint: generates(${raw}) called before loadClasses`);
            return generated.get(raw);
        },
        declares(className) {
            assertReady('declares');
            return declared.has(className);
        },
        signature(className) {
            return signatures.get(className) ?? null;
        },
    };
}

module.exports = { loadSite };
