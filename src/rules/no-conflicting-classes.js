'use strict';

const { bare } = require('../token');

module.exports = {
    id: 'no-conflicting-classes',
    siteDependent: true,
    check({ staticGroups = [] }, site) {
        const violations = [];
        for (const group of staticGroups) {
            const seen = new Map();
            for (const token of group) {
                const declarations = site.signature(bare(token));
                if (!declarations?.length) continue;
                const properties = [...new Set(declarations.map(([property]) => property))].sort();
                const value = declarations.map(([property, val]) => `${property}:${val}`).sort().join(';');
                const key = [token.variants.join(':'), token.important, properties.join(',')].join('|');
                const previous = seen.get(key);
                if (!previous) {
                    seen.set(key, { token, value });
                    continue;
                }
                if (previous.value === value) continue;
                const shown = properties.filter((property) => !property.startsWith('--'));
                const list = (shown.length ? shown : properties).map((property) => `\`${property}\``).join(', ');
                violations.push({ token: token.raw, message: `\`${token.raw}\` conflicts with \`${previous.token.raw}\`: both set ${list}` });
            }
        }
        return violations;
    },
};
