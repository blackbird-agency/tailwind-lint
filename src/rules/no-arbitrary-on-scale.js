'use strict';

const { matchPrefix, rebuild } = require('../token');
const { SCALES, SCALE_PREFIXES } = require('../utilities');

const toPixels = (value) => {
    const match = String(value).match(/^(-?\d*\.?\d+)(px|rem)$/);
    if (!match) return null;
    return match[2] === 'rem' ? Number(match[1]) * 16 : Number(match[1]);
};

module.exports = {
    id: 'no-arbitrary-on-scale',
    siteDependent: true,
    check({ tokens }, site) {
        const violations = [];
        for (const token of tokens) {
            if (!token.arbitrary || token.property) continue;
            const pixels = toPixels(token.arbitrary);
            const match = matchPrefix(token.core, SCALE_PREFIXES);
            if (pixels === null || !match) continue;
            const entry = Object.entries(site.scale(SCALES[match.prefix].key))
                .filter(([name, value]) => name !== 'DEFAULT' && !(Array.isArray(value) && value.length > 1))
                .find(([, value]) => toPixels(Array.isArray(value) ? value[0] : value) === pixels);
            if (!entry) continue;
            const fixed = rebuild(token, `${match.prefix}-${entry[0]}`);
            violations.push({ token, message: `\`${token.raw}\` matches a scale key: use \`${fixed}\`` });
        }
        return violations;
    },
};
