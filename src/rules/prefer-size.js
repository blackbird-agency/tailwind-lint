'use strict';

const SIZE_VALUE = /^(\d+(\.\d+)?|\d+\/\d+|px|full|auto|min|max|fit|\[.+\])$/;

module.exports = {
    id: 'prefer-size',
    siteDependent: false,
    check({ groups }) {
        const violations = [];
        for (const group of groups) {
            const key = (token, value) => [token.variants.join(':'), token.important, value].join('|');
            const heights = new Set(group
                .filter((token) => token.core.startsWith('h-') && !token.negative)
                .map((token) => key(token, token.core.slice(2))));
            for (const token of group) {
                if (!token.core.startsWith('w-') || token.negative) continue;
                const value = token.core.slice(2);
                if (!SIZE_VALUE.test(value) || !heights.has(key(token, value))) continue;
                const size = [...token.variants, `${token.important ? '!' : ''}size-${value}`].join(':');
                violations.push({ token: token.raw, message: `\`${token.raw}\` + matching height: use \`${size}\`` });
            }
        }
        return violations;
    },
};
