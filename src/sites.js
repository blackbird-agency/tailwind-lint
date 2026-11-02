'use strict';

const { createRequire } = require('module');

const ADAPTERS = {
    3: require('./adapters/tailwind-v3'),
    4: require('./adapters/tailwind-v4'),
};

function adapterFor(version) {
    const major = Number(String(version).split('.')[0]);
    const adapter = ADAPTERS[major];
    if (!adapter) throw new Error(`tailwind-lint: Tailwind CSS v${major} is not supported yet`);
    return adapter;
}

function loadSites(config) {
    return config.sites.map((site) => {
        const req = createRequire(site.config);
        return adapterFor(req('tailwindcss/package.json').version).loadSite(site, req);
    });
}

module.exports = { adapterFor, loadSites };
