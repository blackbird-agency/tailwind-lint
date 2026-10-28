'use strict';

const FRACTION = /^(w|h|size|min-w|max-w|min-h|max-h|inset|inset-x|inset-y|top|right|bottom|left|start|end|translate-x|translate-y|basis)-\d+\/\d+$/;

function splitTopLevel(raw, separator) {
    const parts = [];
    let depth = 0;
    let current = '';
    for (const char of raw) {
        if (char === '[' || char === '(') depth++;
        if (char === ']' || char === ')') depth = Math.max(0, depth - 1);
        if (char === separator && depth === 0) {
            parts.push(current);
            current = '';
            continue;
        }
        current += char;
    }
    parts.push(current);
    return parts;
}

function parseToken(raw) {
    const parts = splitTopLevel(raw, ':');
    let core = parts.pop();
    const variants = parts;
    let important = false;
    let importantSuffix = false;
    if (core.startsWith('!')) {
        important = true;
        core = core.slice(1);
    } else if (core.endsWith('!')) {
        important = true;
        importantSuffix = true;
        core = core.slice(0, -1);
    }
    let negative = false;
    if (core.startsWith('-')) {
        negative = true;
        core = core.slice(1);
    }
    let opacity = null;
    if (!FRACTION.test(core)) {
        const match = core.match(/^(.+)\/(\d+|\[[^\]]+\]|\([^)]+\))$/);
        if (match) {
            core = match[1];
            opacity = match[2];
        }
    }
    let arbitrary = null;
    let property = null;
    const propertyMatch = core.match(/^\[([a-z-]+):(.+)\]$/);
    if (propertyMatch) {
        property = propertyMatch[1];
        arbitrary = propertyMatch[2];
    } else {
        const valueMatch = core.match(/^.+?-(?:\[(.+)\]|\((--.+)\))$/);
        if (valueMatch) arbitrary = valueMatch[1] ?? valueMatch[2];
    }
    return { raw, variants, important, importantSuffix, negative, core, opacity, arbitrary, property };
}

function matchPrefix(core, prefixes) {
    for (const prefix of prefixes) {
        if (core.startsWith(`${prefix}-`)) return { prefix, value: core.slice(prefix.length + 1) };
    }
    return null;
}

function rebuild(token, core) {
    const [before, after] = token.important ? (token.importantSuffix ? ['', '!'] : ['!', '']) : ['', ''];
    const base = `${before}${token.negative ? '-' : ''}${core}${token.opacity ? `/${token.opacity}` : ''}${after}`;
    return [...token.variants, base].join(':');
}

function bare(token) {
    return rebuild({ ...token, variants: [], important: false }, token.core);
}

module.exports = { parseToken, matchPrefix, rebuild, bare };
