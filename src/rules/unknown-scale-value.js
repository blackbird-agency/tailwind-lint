'use strict';

const { matchPrefix } = require('../token');
const { SCALES, SCALE_PREFIXES } = require('../utilities');

module.exports = {
    id: 'unknown-scale-value',
    siteDependent: true,
    check({ tokens }, site) {
        const violations = [];
        for (const token of tokens) {
            if (token.arbitrary) continue;
            const match = matchPrefix(token.core, SCALE_PREFIXES);
            if (!match) continue;
            const { key, named } = SCALES[match.prefix];
            if (!named.test(match.value) || match.value in site.scale(key)) continue;
            violations.push({
                token: token.raw,
                message: `\`${token.raw}\` is not in the theme \`${key}\` scale: Tailwind does not generate it, use an existing key or an arbitrary value`,
            });
        }
        return violations;
    },
};
