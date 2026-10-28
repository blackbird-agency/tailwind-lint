'use strict';

const fs = require('fs');
const path = require('path');
const { assertLocked } = require('../lockfile');
const { readHyvaConfig, isHyvaTheme, hyvaModules, hyvaModuleCssFiles, assertMagentoRoot, realpath } = require('../hyva');

const COLOR_THEME_KEYS = [
    'colors', 'textColor', 'backgroundColor', 'borderColor', 'ringColor', 'ringOffsetColor', 'outlineColor',
    'fill', 'stroke', 'divideColor', 'placeholderColor', 'accentColor', 'caretColor', 'textDecorationColor',
    'boxShadowColor', 'gradientColorStops',
];

function flattenKeys(object, prefix, out) {
    if (!object || typeof object !== 'object') return out;
    for (const [key, value] of Object.entries(object)) {
        const name = key === 'DEFAULT' ? prefix : [prefix, key].filter(Boolean).join('-');
        if (value && typeof value === 'object' && !Array.isArray(value)) flattenKeys(value, name, out);
        else out.add(name);
    }
    return out;
}

function collectImports(file, seen = new Set()) {
    if (seen.has(file) || !fs.existsSync(file)) return seen;
    seen.add(file);
    const css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of css.matchAll(/@import\s+(?:url\()?\s*["']?([^"')\s;]+)["']?\s*\)?/g)) {
        const specifier = match[1];
        const target = path.resolve(path.dirname(file), specifier);
        if (/^(?:[a-z]+:)?\/\//i.test(specifier) || target.includes(`${path.sep}node_modules${path.sep}`)) continue;
        if (target.endsWith('.css') && fs.statSync(target, { throwIfNoEntry: false })?.isFile()) collectImports(target, seen);
        // A bare specifier without .css (`tailwindcss/base`) is a package import, resolved by the build, not by the linter.
        else if (/^\.{0,2}\//.test(specifier) || specifier.endsWith('.css') || /[*?{]/.test(specifier) || fs.existsSync(target)) {
            throw new Error(`tailwind-lint: ${file} imports ${specifier}, which tailwind-lint cannot resolve`);
        }
    }
    return seen;
}

function buildComponentIndex(entry, postcss, nesting) {
    const direct = new Map();
    for (const file of collectImports(entry)) {
        const root = parse(postcss, [nesting], file);
        root.walkAtRules('apply', (rule) => {
            if (rule.parent?.type !== 'rule') return;
            for (let node = rule.parent.parent; node; node = node.parent) {
                if (node.type === 'atrule' && node.name !== 'layer') return;
            }
            const tokens = rule.params.replace(/!important/g, '').split(/\s+/).filter(Boolean);
            for (const selector of rule.parent.selectors) {
                const match = selector.trim().match(/^\.([\w-]+)$/);
                if (!match) continue;
                if (!direct.has(match[1])) direct.set(match[1], new Set());
                tokens.forEach((token) => direct.get(match[1]).add(token));
            }
        });
    }
    const closed = new Map();
    const close = (name, stack) => {
        if (closed.has(name)) return closed.get(name);
        const out = new Set();
        stack.add(name);
        for (const token of direct.get(name) ?? []) {
            out.add(token);
            if (!direct.has(token) || stack.has(token)) continue;
            close(token, stack).forEach((applied) => {
                if (direct.has(applied)) out.add(applied);
            });
        }
        stack.delete(name);
        closed.set(name, out);
        return out;
    };
    for (const name of direct.keys()) close(name, new Set());
    return closed;
}

function parse(postcss, plugins, file) {
    try {
        return postcss(plugins).process(fs.readFileSync(file, 'utf8'), { from: file }).root;
    } catch (error) {
        throw new Error(`tailwind-lint: cannot parse ${file}: ${error.reason ?? error.message}`);
    }
}

function declaredClasses(files, postcss, nesting) {
    const names = new Set();
    for (const file of files) {
        parse(postcss, [nesting], file).walkRules((rule) => {
            for (const match of rule.selector.matchAll(/\.((?:\\.|[\w-])+)/g)) names.add(match[1].replace(/\\(.)/g, '$1'));
        });
    }
    return names;
}

function layerRoot(files, postcss, nesting) {
    const root = postcss.root();
    for (const file of files) {
        parse(postcss, [nesting], file).walkAtRules(/^(layer|responsive|variants)$/, (rule) => {
            if (rule.name === 'layer' ? !['components', 'utilities'].includes(rule.params) : rule.parent.type !== 'root') return;
            root.append(postcss.atRule({ name: 'layer', params: rule.name === 'layer' ? rule.params : 'utilities', nodes: rule.nodes.map((node) => node.clone()) }));
        });
    }
    return root;
}

// Tailwind warns on stderr, which the Claude hook forwards to Claude as if it were a violation.
function muteTailwindLog(req) {
    const log = req('tailwindcss/lib/util/log').default;
    Object.keys(log).forEach((key) => { log[key] = () => {}; });
}

function markers(resolved) {
    const found = new Set(['group', 'peer']);
    const [mode] = [].concat(resolved.darkMode ?? []);
    if (mode === 'class' || mode === 'selector') found.add('dark');
    return found;
}

// hyva-modules reads app/etc/hyva-themes.json, found from process.cwd(), as soon as it is required.
function withHyvaEnvironment(req, configFile, root, modules, area, load) {
    const themeDir = path.dirname(configFile);
    const basePath = assertMagentoRoot(configFile, root);
    const hyvaDir = path.dirname(req.resolve('@hyva-themes/hyva-modules/package.json'));
    const stale = new Set(modules.map(({ src }) => path.join(basePath, src, 'view', area, 'tailwind/tailwind.config.js')));
    for (const key of Object.keys(req.cache)) {
        if (key.startsWith(hyvaDir + path.sep) || key.startsWith(realpath(hyvaDir) + path.sep) || stale.has(key)) delete req.cache[key];
    }
    const themesJson = path.join(basePath, 'app/etc/hyva-themes.json');
    const content = JSON.stringify({ extensions: modules.filter((m) => !m.cssExcluded).map(({ src }) => ({ src })) });
    const cwd = process.cwd();
    const { readFileSync } = fs;
    fs.readFileSync = function (file, ...rest) {
        if (typeof file === 'string' && path.resolve(file) === themesJson) return content;
        return readFileSync.call(this, file, ...rest);
    };
    try {
        process.chdir(themeDir);
        return load();
    } finally {
        fs.readFileSync = readFileSync;
        process.chdir(cwd);
    }
}

function loadSite({ name, config: configFile, css }, req, root) {
    const configDir = path.dirname(configFile);
    const hyvaTheme = isHyvaTheme(configDir, fs.readFileSync(configFile, 'utf8'));
    assertLocked(req, ['tailwindcss', 'postcss', 'micromatch', ...(hyvaTheme ? ['@hyva-themes/hyva-modules'] : [])]);
    if (hyvaTheme && !root) throw new Error(`tailwind-lint: site ${name} is a Hyvä theme, the Magento root is required`);
    const hyvaConfig = hyvaTheme ? readHyvaConfig(configDir) : null;
    const area = hyvaConfig?.tailwind?.area ?? 'frontend';
    const modules = hyvaTheme ? hyvaModules(root, hyvaConfig) : [];
    const config = hyvaTheme
        ? withHyvaEnvironment(req, configFile, root, modules, area, () => {
            delete req.cache[configFile];
            return req(configFile);
        })
        : req(configFile);
    muteTailwindLog(req);
    const resolved = req('tailwindcss/resolveConfig')(config);
    const defaultColors = req('tailwindcss/colors');
    const micromatch = req('micromatch');
    const postcss = req('postcss');
    const cssDir = path.dirname(css);
    const themeColorNames = new Set();
    COLOR_THEME_KEYS.forEach((key) => flattenKeys(config.theme?.extend?.[key], '', themeColorNames));
    const globs = { include: [], ignore: [] };
    for (const entry of resolved.content.files.filter((file) => typeof file === 'string')) {
        const glob = entry.replace(/^!/, '');
        globs[entry.startsWith('!') ? 'ignore' : 'include'].push(path.isAbsolute(glob) ? glob : path.resolve(configDir, glob));
    }
    const nesting = req('tailwindcss/nesting');
    const components = buildComponentIndex(css, postcss, nesting);
    const signatures = new Map();
    const generated = new Map();
    let declared = null;
    let context = null;
    // One candidate at a time: Tailwind drops a whole batch's variants when one candidate in it is invalid.
    const generate = (candidate) => {
        context ??= req('tailwindcss/lib/lib/setupContextUtils').createContext(resolved, [], layerRoot(cssFiles(), postcss, nesting));
        return req('tailwindcss/lib/lib/generateRules').generateRules(new Set([candidate]), context);
    };
    const cssFiles = () => [
        ...collectImports(css),
        ...(hyvaTheme ? hyvaModuleCssFiles(root, modules, area) : []),
    ].sort();

    return {
        name,
        version: 3,
        markers: markers(resolved),
        postcss,
        covers(absFile) {
            if (absFile.endsWith('.css')) return absFile.startsWith(cssDir + path.sep);
            return micromatch.isMatch(absFile, globs.include, { ignore: globs.ignore });
        },
        isDefaultShade(color) {
            const match = color.match(/^([a-z]+)-(\d+)$/);
            if (!match || themeColorNames.has(color)) return false;
            const fallback = defaultColors[match[1]]?.[match[2]];
            return fallback !== undefined && resolved.theme.colors[match[1]]?.[match[2]] === fallback;
        },
        scale(key) {
            return resolved.theme[key] ?? {};
        },
        closure(className) {
            return components.get(className) ?? null;
        },
        async loadSignatures(classNames) {
            for (const className of classNames) {
                if (signatures.has(className)) continue;
                const rules = generate(className).filter(([meta, rule]) => meta.layer === 'utilities' && rule.type === 'rule');
                const declarations = rules.flatMap(([, rule]) => rule.nodes.filter((node) => node.type === 'decl').map((node) => [node.prop, node.value]));
                signatures.set(className, rules.length ? declarations : null);
            }
        },
        signature(className) {
            return signatures.get(className) ?? null;
        },
        async loadClasses(raws) {
            declared ??= declaredClasses(cssFiles(), postcss, nesting);
            for (const raw of raws) {
                if (!generated.has(raw)) generated.set(raw, generate(raw).length > 0);
            }
        },
        generates(raw) {
            if (!generated.has(raw)) throw new Error(`tailwind-lint: generates(${raw}) called before loadClasses`);
            return generated.get(raw);
        },
        declares(className) {
            if (!declared) throw new Error('tailwind-lint: declares() called before loadClasses');
            return declared.has(className);
        },
    };
}

module.exports = { loadSite };
