'use strict';

const { matchPrefix } = require('../token');
const { COLOR_PREFIXES } = require('../utilities');

const COLOR_VALUE = /^(#|rgba?\(|hsla?\()/i;
const COLOR_PROPERTIES = /(^|-)(color|fill|stroke)$|^background$/;

module.exports = {
    id: 'no-hardcoded-color',
    siteDependent: false,
    check({ tokens }) {
        return tokens
            .filter((token) => token.arbitrary && COLOR_VALUE.test(token.arbitrary)
                && (token.property ? COLOR_PROPERTIES.test(token.property) : matchPrefix(token.core, COLOR_PREFIXES)))
            .map((token) => ({ token, message: `hardcoded colour in \`${token.raw}\`: use a theme colour alias` }));
    },
};
