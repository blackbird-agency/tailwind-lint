'use strict';

module.exports = {
    id: 'redundant-with-component',
    siteDependent: true,
    check({ groups }, site) {
        const violations = [];
        for (const group of groups) {
            const components = group.filter((token) => !token.variants.length && site.closure(token.raw));
            for (const token of group) {
                const owner = components.find((component) => component !== token && site.closure(component.raw).has(token.raw));
                if (owner) violations.push({ token: token.raw, message: `\`${token.raw}\` is already applied by \`${owner.raw}\`` });
            }
        }
        return violations;
    },
};
