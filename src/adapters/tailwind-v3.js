'use strict';

const fs = require('fs');
const path = require('path');

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
    const css = fs.readFileSync(file, 'utf8');
    for (const match of css.matchAll(/@import\s+(?:url\()?\s*["']?([^"')\s;]+)["']?\s*\)?/g)) {
        const target = path.resolve(path.dirname(file), match[1]);
        if (target.endsWith('.css') && !target.includes(`${path.sep}node_modules${path.sep}`)) collectImports(target, seen);
    }
    return seen;
}

function buildComponentIndex(entry, postcss, nesting) {
    const direct = new Map();
    for (const file of collectImports(entry)) {
        const root = postcss([nesting]).process(fs.readFileSync(file, 'utf8'), { from: file }).root;
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

function loadSite({ name, config: configFile, css }, req) {
    const config = req(configFile);
    const resolved = req('tailwindcss/resolveConfig')(config);
    const defaultColors = req('tailwindcss/colors');
    const micromatch = req('micromatch');
    const postcss = req('postcss');
    const configDir = path.dirname(configFile);
    const cssDir = path.dirname(css);
    const themeColorNames = new Set();
    COLOR_THEME_KEYS.forEach((key) => flattenKeys(config.theme?.extend?.[key], '', themeColorNames));
    const globs = resolved.content.files
        .filter((entry) => typeof entry === 'string')
        .map((entry) => (path.isAbsolute(entry) ? entry : path.resolve(configDir, entry)));
    const components = buildComponentIndex(css, postcss, req('tailwindcss/nesting'));
    const signatures = new Map();

    return {
        name,
        postcss,
        covers(absFile) {
            if (absFile.endsWith('.css')) return absFile.startsWith(cssDir + path.sep);
            return micromatch.isMatch(absFile, globs);
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
            const missing = new Set(classNames.filter((className) => !signatures.has(className)));
            if (!missing.size) return;
            const tailwind = req('tailwindcss')({ ...config, content: [{ raw: [...missing].join(' ') }] });
            const result = await postcss([tailwind]).process('@tailwind utilities;', { from: undefined });
            const found = new Map();
            result.root.each((rule) => {
                const meta = rule.raws.tailwind;
                if (rule.type !== 'rule' || meta?.layer !== 'utilities' || !missing.has(meta.candidate)) return;
                const declarations = found.get(meta.candidate) ?? [];
                rule.each((node) => node.type === 'decl' && declarations.push([node.prop, node.value]));
                found.set(meta.candidate, declarations);
            });
            missing.forEach((className) => signatures.set(className, found.get(className) ?? null));
        },
        signature(className) {
            return signatures.get(className) ?? null;
        },
    };
}

module.exports = { loadSite };
