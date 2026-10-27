'use strict';

const fs = require('fs');
const path = require('path');
const { analyseLine, analyseCss, addedLineNumbers } = require('./extract');
const { parseToken, bare } = require('./token');
const RULES = require('./rules');

const PHP_EXTENSIONS = new Set(['.php', '.phtml']);

function activeRules(options = {}) {
    return RULES
        .filter((rule) => options[rule.id] !== false)
        .map((rule) => ({ rule, hint: options[rule.id]?.hint }));
}

function lintEntries(entries, sites, rules) {
    const violations = [];
    for (const entry of entries) {
        const seen = new Set();
        for (const { rule, hint } of rules) {
            let found;
            if (!rule.siteDependent) {
                found = rule.check(entry);
            } else if (!sites.length) {
                continue;
            } else {
                const perSite = sites.map((site) => rule.check(entry, site));
                found = perSite[0].filter((violation) => perSite.every((list) => list.some((other) => other.token === violation.token)));
            }
            for (const violation of found) {
                const key = `${rule.id}|${violation.token}`;
                if (seen.has(key)) continue;
                seen.add(key);
                const message = hint ? `${violation.message} (${hint})` : violation.message;
                violations.push({ line: entry.line, rule: rule.id, token: violation.token, message });
            }
        }
    }
    return violations;
}

async function prepareSites(entries, sites) {
    const classNames = [...new Set(entries.flatMap((entry) => entry.groups.flat().map(bare)))];
    await Promise.all(sites.map((site) => site.loadSignatures(classNames)));
}

function parseEntries(entries) {
    return entries.map((entry) => ({
        ...entry,
        tokens: entry.tokens.map(parseToken),
        groups: entry.groups.map((group) => group.map(parseToken)),
        staticGroups: entry.staticGroups.map((group) => group.map(parseToken)),
    }));
}

async function lintFile(root, file, sites, config, { all = false } = {}) {
    const relative = path.relative(root, path.resolve(root, file)).split(path.sep).join('/');
    const absolute = path.resolve(root, relative);
    const included = config.include.some((pattern) => pattern.test(relative));
    if (!included || config.ignore.some((pattern) => pattern.test(relative)) || !fs.existsSync(absolute)) return [];
    const fileSites = sites.filter((site) => site.covers(absolute));
    const content = fs.readFileSync(absolute, 'utf8');
    const lines = content.split('\n');
    const added = addedLineNumbers(root, relative, lines.length, { all, baselines: config.baselines });
    if (!added.size) return [];
    let entries;
    if (relative.endsWith('.css')) {
        if (!fileSites.length) return [];
        entries = analyseCss(content, added, fileSites[0].postcss);
    } else {
        const php = PHP_EXTENSIONS.has(path.extname(relative));
        entries = [...added].sort((a, b) => a - b).map((line) => ({ line, ...analyseLine(lines[line - 1] ?? '', { php }) }));
    }
    const parsed = parseEntries(entries);
    await prepareSites(parsed, fileSites);
    return lintEntries(parsed, fileSites, activeRules(config.rules)).map((violation) => ({ file: relative, ...violation }));
}

module.exports = { activeRules, lintEntries, lintFile, parseEntries, prepareSites };
