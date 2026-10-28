'use strict';

module.exports = {
    id: 'redundant-with-component',
    siteDependent: true,
    // Static groups only: tokens of a binding or a PHP expression may be alternatives that never meet.
    check({ staticGroups = [] }, site) {
        const violations = [];
        for (const group of staticGroups) {
            const components = group.filter((token) => !token.variants.length && site.closure(token.raw));
            for (const token of group) {
                const owner = components.find((component) => component.raw !== token.raw && site.closure(component.raw).has(token.raw));
                if (owner) violations.push({ token, message: `\`${token.raw}\` is already applied by \`${owner.raw}\`` });
            }
        }
        return violations;
    },
};
