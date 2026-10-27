'use strict';

module.exports = {
    id: 'no-inline-svg',
    siteDependent: false,
    check({ svg }) {
        return svg ? [{ token: '<svg', message: 'inline SVG: use the icon system instead' }] : [];
    },
};
