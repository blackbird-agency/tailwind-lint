'use strict';

const { rebuild } = require('../token');

// Longest first: `pt-4 pr-4 pb-4 pl-4` is reported once as `p-4`, not as `px-4` + `py-4`.
const SHORTHANDS = [
    [['pt', 'pr', 'pb', 'pl'], 'p'],
    [['mt', 'mr', 'mb', 'ml'], 'm'],
    [['top', 'right', 'bottom', 'left'], 'inset'],
    [['border-t', 'border-r', 'border-b', 'border-l'], 'border'],
    [['rounded-tl', 'rounded-tr', 'rounded-br', 'rounded-bl'], 'rounded'],
    [['px', 'py'], 'p'],
    [['mx', 'my'], 'm'],
    [['inset-x', 'inset-y'], 'inset'],
    [['border-x', 'border-y'], 'border'],
    [['rounded-t', 'rounded-b'], 'rounded'],
    [['rounded-l', 'rounded-r'], 'rounded'],
    [['pl', 'pr'], 'px'],
    [['pt', 'pb'], 'py'],
    [['ml', 'mr'], 'mx'],
    [['mt', 'mb'], 'my'],
    [['left', 'right'], 'inset-x'],
    [['top', 'bottom'], 'inset-y'],
    [['border-l', 'border-r'], 'border-x'],
    [['border-t', 'border-b'], 'border-y'],
    [['rounded-tl', 'rounded-tr'], 'rounded-t'],
    [['rounded-bl', 'rounded-br'], 'rounded-b'],
    [['rounded-tl', 'rounded-bl'], 'rounded-l'],
    [['rounded-tr', 'rounded-br'], 'rounded-r'],
    [['w', 'h'], 'size'],
    [['gap-x', 'gap-y'], 'gap'],
    [['overflow-x', 'overflow-y'], 'overflow'],
    [['overscroll-x', 'overscroll-y'], 'overscroll'],
    [['scale-x', 'scale-y'], 'scale'],
    [['translate-x', 'translate-y'], 'translate'],
];

function valueOf(core, prefix) {
    if (core === prefix) return '';
    return core.startsWith(`${prefix}-`) ? core.slice(prefix.length + 1) : null;
}

function combinations(group) {
    const found = [];
    for (const [parts, shorthand] of SHORTHANDS) {
        const sets = new Map();
        for (const token of group) {
            for (const part of parts) {
                const value = valueOf(token.core, part);
                if (value === null) continue;
                const key = [token.variants.join(':'), Boolean(token.important), token.negative, token.opacity, value].join('|');
                if (!sets.has(key)) sets.set(key, { value, tokens: new Map() });
                if (!sets.get(key).tokens.has(part)) sets.get(key).tokens.set(part, token);
            }
        }
        for (const { value, tokens } of sets.values()) {
            if (tokens.size !== parts.length) continue;
            const ordered = [...tokens.values()].sort((a, b) => group.indexOf(a) - group.indexOf(b));
            found.push({ tokens: ordered, raw: rebuild(ordered[0], value ? `${shorthand}-${value}` : shorthand) });
        }
    }
    return found;
}

module.exports = {
    id: 'enforces-shorthand',
    siteDependent: true,
    candidates({ staticGroups = [] }) {
        return staticGroups.flatMap((group) => combinations(group).map(({ raw }) => raw));
    },
    // Static groups only: tokens of a binding or a PHP expression may be alternatives that never meet.
    check({ staticGroups = [] }, site) {
        const violations = [];
        for (const group of staticGroups) {
            const used = new Set();
            for (const { tokens, raw } of combinations(group)) {
                if (tokens.some((token) => used.has(token)) || !site.generates(raw)) continue;
                tokens.forEach((token) => used.add(token));
                violations.push({ token: tokens[0], message: `${tokens.map((token) => `\`${token.raw}\``).join(' + ')}: use \`${raw}\`` });
            }
        }
        return violations;
    },
};
