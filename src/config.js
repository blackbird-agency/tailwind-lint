'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_IGNORE = ['**/node_modules/**'];

function globToRegExp(glob) {
    let source = '';
    for (let index = 0; index < glob.length; index++) {
        const char = glob[index];
        if (char === '*' && glob[index + 1] === '*') {
            const slash = glob[index + 2] === '/';
            source += slash ? '(?:.*/)?' : '.*';
            index += slash ? 2 : 1;
        } else if (char === '*') {
            source += '[^/]*';
        } else if (char === '?') {
            source += '[^/]';
        } else {
            source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
        }
    }
    return new RegExp(`^${source}$`);
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
    return {
        sites,
        include: (raw.include ?? ['**/*.html', '**/*.php', '**/*.phtml', '**/*.css']).map(globToRegExp),
        ignore: [...DEFAULT_IGNORE, ...(raw.ignore ?? [])].map(globToRegExp),
        baselines: (raw.baselines ?? []).map((baseline) => ({ match: new RegExp(baseline.match), original: baseline.original })),
        rules: raw.rules ?? {},
    };
}

function loadConfig(file) {
    const absolute = path.resolve(file);
    return normalizeConfig(JSON.parse(fs.readFileSync(absolute, 'utf8')), process.cwd());
}

module.exports = { globToRegExp, normalizeConfig, loadConfig };
