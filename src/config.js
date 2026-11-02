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
    const rules = {};
    for (const [id, options] of Object.entries(raw.rules ?? {})) {
        const rule = RULES.find((candidate) => candidate.id === id);
        if (!rule) throw new Error(`tailwind-lint config: unknown rule "${id}"`);
        if (options !== false && (typeof options !== 'object' || options === null || (options.hint !== undefined && typeof options.hint !== 'string'))) {
            throw new Error(`tailwind-lint config: rule "${id}" takes false or { "hint": "…" }`);
        }
        rules[id] = options && { ...options };
        for (const [name, value] of Object.entries(options || {})) {
            if (name === 'hint') continue;
            const option = rule.options?.[name];
            if (!option) throw new Error(`tailwind-lint config: rule "${id}" has no option "${name}"`);
            if (!option.valid(value)) throw new Error(`tailwind-lint config: invalid option "${name}" of rule "${id}"`);
            if (option.resolve) rules[id][name] = option.resolve(value, base);
        }
    }
    return {
        sites,
        include: (raw.include ?? ['**/*.html', '**/*.php', '**/*.phtml', '**/*.css']).map(globToRegExp),
        ignore: [...DEFAULT_IGNORE, ...(raw.ignore ?? [])].map(globToRegExp),
        baselines: (raw.baselines ?? []).map((baseline) => ({ match: new RegExp(baseline.match), original: baseline.original })),
        rules,
    };
}

function loadConfig(file) {
    const absolute = path.resolve(file);
    if (!fs.existsSync(absolute)) throw new Error(`tailwind-lint: config file ${file} not found`);
    return normalizeConfig(JSON.parse(fs.readFileSync(absolute, 'utf8')), process.cwd());
}

module.exports = { globToRegExp, normalizeConfig, loadConfig };
