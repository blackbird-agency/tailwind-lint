'use strict';

const fs = require('fs');
const path = require('path');
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

const DYNAMIC_VALUE = /^(\d+(\.(0|25|5|75))?|\d+\/\d+|px)$/;

function collectImports(file, seen = new Set()) {
    if (seen.has(file) || !fs.existsSync(file)) return seen;
    seen.add(file);
    const css = fs.readFileSync(file, 'utf8');
    for (const match of css.matchAll(/@import\s+(?:url\()?\s*["']([^"']+)["']/g)) {
        if (!match[1].startsWith('.')) continue;
        const target = path.resolve(path.dirname(file), match[1]);
        const resolved = target.endsWith('.css') ? target : [`${target}.css`, path.join(target, 'index.css')].find(fs.existsSync);
        if (resolved) collectImports(resolved, seen);
    }
    return seen;
}

function themeVariables(files) {
    const variables = new Map();
    for (const file of files) {
        postcss.parse(fs.readFileSync(file, 'utf8')).walkAtRules('theme', (theme) => {
            theme.walkDecls(/^--/, (decl) => variables.set(decl.prop, decl.value));
        });
    }
    return variables;
}

function sourceGlobs(files) {
    const globs = [];
    for (const file of files) {
        for (const match of fs.readFileSync(file, 'utf8').matchAll(/@source\s+(not\s+)?["']([^"']+)["']/g)) {
            if (match[1]) continue;
            const target = path.resolve(path.dirname(file), match[2]);
            globs.push(/[*{]/.test(match[2]) || path.extname(target) ? target : `${target}/**`);
        }
    }
    return globs;
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
    for (const file of files) {
        const root = postcss.parse(fs.readFileSync(file, 'utf8'));
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

function loadSite({ name, config: configFile, css }, req) {
    const cssDir = path.dirname(css);
    const files = [...collectImports(css)];
    const defaults = themeVariables([req.resolve('tailwindcss/theme.css')]);
    const project = themeVariables(files);
    const variables = new Map([...defaults, ...project]);
    const globs = sourceGlobs(files);
    const components = buildComponentIndex(files);
    const signatures = new Map();
    let compiler = null;

    const resolve = (value) => {
        let out = value;
        for (let pass = 0; pass < 4 && out.includes('var(--'); pass++) {
            out = out.replace(/var\((--[\w-]+)\)/g, (whole, variable) => variables.get(variable) ?? whole);
        }
        return out.replace(/\s+/g, ' ').trim();
    };

    const spacing = parseFloat(variables.get('--spacing')) || 0.25;
    const grid = { px: '1px' };
    for (let step = 0; step <= 1600; step++) grid[String(step / 4)] = `${(step / 4) * spacing}rem`;

    const buildScale = (key) => {
        const named = { ...(STATIC_KEYS[key] ?? {}) };
        for (const namespace of NAMED_NAMESPACES[key] ?? []) {
            for (const [variable, value] of variables) {
                const suffix = variable.startsWith(`${namespace}-`) ? variable.slice(namespace.length + 1) : '';
                if (suffix && !suffix.includes('--')) named[suffix] = resolve(value);
            }
        }
        if (!SPACING_KEYS.has(key)) return named;
        return new Proxy({ ...grid, ...named }, { has: (object, value) => value in object || DYNAMIC_VALUE.test(value) });
    };
    const scales = new Map();
    const scale = (key) => {
        if (!scales.has(key)) scales.set(key, buildScale(key));
        return scales.get(key);
    };

    return {
        name,
        postcss,
        covers(absFile) {
            if (absFile.endsWith('.css')) return absFile.startsWith(cssDir + path.sep);
            return micromatch.isMatch(absFile, globs);
        },
        isDefaultShade(color) {
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
            const missing = new Set(classNames.filter((className) => !signatures.has(className)));
            if (!missing.size) return;
            compiler ??= await req('@tailwindcss/node').compile(fs.readFileSync(css, 'utf8'), {
                base: cssDir,
                from: css,
                onDependency: () => {},
            });
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
        signature(className) {
            return signatures.get(className) ?? null;
        },
    };
}

module.exports = { loadSite };
