'use strict';

const fs = require('fs');
const path = require('path');
const micromatch = require('micromatch');
const RULES = require('./rules');

const DEFAULT_IGNORE = ['**/node_modules/**'];

function globToRegExp(glob) {
    return micromatch.makeRe(glob, { dot: true });
}

function normalizeConfig(raw, base) {
    if (!Array.isArray(raw.sites)) throw new Error('tailwind-lint config: "sites" must be an array');
    const sites = raw.sites.map((site, index) => {
        if (!site.config || !site.css) throw new Error(`tailwind-lint config: site #${index + 1} needs "config" and "css"`);
        return {
            name: site.name ?? `site-${index + 1}`,
            config: path.resolve(base, site.config),
            css: path.resolve(base, site.css),
        };
    });
    const ids = new Set(RULES.map((rule) => rule.id));
    for (const [id, options] of Object.entries(raw.rules ?? {})) {
        if (!ids.has(id)) throw new Error(`tailwind-lint config: unknown rule "${id}"`);
        if (options !== false && (typeof options !== 'object' || options === null || (options.hint !== undefined && typeof options.hint !== 'string'))) {
            throw new Error(`tailwind-lint config: rule "${id}" takes false or { "hint": "…" }`);
        }
    }
    return {
        root: base,
        sites,
        include: (raw.include ?? ['**/*.html', '**/*.php', '**/*.phtml', '**/*.css']).map(globToRegExp),
        ignore: [...DEFAULT_IGNORE, ...(raw.ignore ?? [])].map(globToRegExp),
        baselines: (raw.baselines ?? []).map((baseline) => ({ match: new RegExp(baseline.match), original: baseline.original })),
        rules: raw.rules ?? {},
    };
}

function loadConfig(file) {
    const absolute = path.resolve(file);
    if (!fs.existsSync(absolute)) throw new Error(`tailwind-lint: config file ${file} not found`);
    return normalizeConfig(JSON.parse(fs.readFileSync(absolute, 'utf8')), process.cwd());
}

module.exports = { globToRegExp, normalizeConfig, loadConfig };
