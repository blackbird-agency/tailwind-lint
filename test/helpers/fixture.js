'use strict';

const path = require('path');
const { normalizeConfig } = require('../../src/config');
const { loadSites } = require('../../src/sites');

const directory = path.join(__dirname, '../fixtures/project');

function fixtureConfig(overrides = {}) {
    return normalizeConfig({
        sites: [{ name: 'fixture', config: 'tailwind.config.js', css: 'styles.css' }],
        include: ['**/*.phtml', '**/*.css'],
        ...overrides,
    }, directory);
}

const config = fixtureConfig();
const [site] = loadSites(config);

module.exports = { directory, config, fixtureConfig, site };
