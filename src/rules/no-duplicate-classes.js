'use strict';

const { rebuild } = require('../token');

module.exports = {
    id: 'no-duplicate-classes',
    siteDependent: false,
    check({ staticGroups = [] }) {
        const violations = [];
        for (const group of staticGroups) {
            const seen = new Set();
            for (const token of group) {
                // `!p-4` and `p-4!` are the same class.
                const key = rebuild({ ...token, importantSuffix: false }, token.core);
                if (seen.has(key)) {
                    violations.push({ token, message: `\`${token.raw}\` is duplicated` });
                    continue;
                }
                seen.add(key);
            }
        }
        return violations;
    },
};
