'use strict';

const { matchPrefix } = require('../token');
const { COLOR_PREFIXES } = require('../utilities');

module.exports = {
    id: 'no-default-palette-shade',
    siteDependent: true,
    check({ tokens }, site) {
        return tokens
            .filter((token) => !token.arbitrary)
            .filter((token) => {
                const match = matchPrefix(token.core, COLOR_PREFIXES);
                return match && site.isDefaultShade(match.value);
            })
            .map((token) => ({ token: token.raw, message: `\`${token.raw}\` is a default Tailwind palette shade, not a theme colour: use a theme alias` }));
    },
};
