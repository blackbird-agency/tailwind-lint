'use strict';

const fs = require('fs');
const path = require('path');
const { analyseTemplate, analyseCss, addedLineNumbers } = require('./extract');
const { parseToken, bare } = require('./token');
const RULES = require('./rules');

const PHP_EXTENSIONS = new Set(['.php', '.phtml']);

function activeRules(options = {}) {
    return RULES
        .filter((rule) => options[rule.id] !== false)
        .map((rule) => ({ rule, hint: options[rule.id]?.hint }));
}

function lintEntries(entry, reportable, sites, rules) {
    const position = ({ token }) => `${token.line}|${token.index}`;
    const found = new Map();
    for (const { rule, hint } of rules) {
        let violations;
        if (!rule.siteDependent) {
            violations = rule.check(entry);
        } else if (!sites.length) {
            continue;
        } else {
            const perSite = sites.map((site) => rule.check(entry, site));
            violations = perSite[0].filter((violation) => perSite.every((list) => list.some((other) => position(other) === position(violation))));
        }
        const seen = new Map();
        for (const violation of violations) {
            if (!reportable.has(violation.token.line) || seen.has(position(violation))) continue;
            seen.set(position(violation), hint ? { ...violation, message: `${violation.message} (${hint})` } : violation);
        }
        found.set(rule, seen);
    }
    const order = rules.map(({ rule }) => rule);
    const violations = [];
    for (const [rule, seen] of found) {
        const superseding = order.filter((other) => other.supersedes?.includes(rule.id));
        for (const [key, { token, message }] of seen) {
            if (superseding.some((other) => found.get(other)?.has(key))) continue;
            violations.push({ line: token.line, index: token.index, order: order.indexOf(rule), rule: rule.id, token: token.raw, message });
        }
    }
    return violations
        .sort((a, b) => a.line - b.line || a.index - b.index || a.order - b.order)
        .map(({ line, rule, token, message }) => ({ line, rule, token, message }));
}

async function prepareSites(entry, sites) {
    const classNames = [...new Set(entry.groups.flat().map(bare))];
    const raws = [...new Set([
        ...[...entry.tokens, ...entry.groups.flat()].map((token) => token.raw),
        ...RULES.flatMap((rule) => rule.candidates?.(entry) ?? []),
    ])];
    await Promise.all(sites.map(async (site) => {
        await site.loadSignatures(classNames);
        await site.loadClasses(raws);
    }));
}

function parseEntry({ looseTokens, groups }) {
    const parse = (token) => ({ ...parseToken(token.raw), line: token.line, index: token.index });
    return {
        tokens: looseTokens.map(parse),
        groups: groups.map((group) => group.tokens.map(parse)),
        staticGroups: groups.filter((group) => group.staticTokens.length).map((group) => group.staticTokens.map(parse)),
        fragments: groups.flatMap((group) => group.fragments.map(parse)),
    };
}

async function lintFile(root, file, sites, config, { all = false } = {}) {
    const relative = path.relative(root, path.resolve(root, file)).split(path.sep).join('/');
    const absolute = path.resolve(root, relative);
    const included = config.include.some((pattern) => pattern.test(relative));
    if (!included || config.ignore.some((pattern) => pattern.test(relative))) return [];
    if (!fs.existsSync(absolute)) throw new Error(`tailwind-lint: ${relative} does not exist`);
    const fileSites = sites.filter((site) => site.covers(absolute));
    const content = fs.readFileSync(absolute, 'utf8');
    const added = addedLineNumbers(root, relative, content.split('\n').length, { all, baselines: config.baselines });
    if (!added.size) return [];
    let analysis;
    let reportable = added;
    if (relative.endsWith('.css')) {
        if (!fileSites.length) return [];
        analysis = analyseCss(content, added, fileSites[0].postcss);
        reportable = new Set(analysis.groups.flatMap((group) => group.tokens.map((token) => token.line)));
    } else {
        analysis = analyseTemplate(content, { php: PHP_EXTENSIONS.has(path.extname(relative)) });
    }
    const entry = parseEntry(analysis);
    await prepareSites(entry, fileSites);
    return lintEntries(entry, reportable, fileSites, activeRules(config.rules)).map((violation) => ({ file: relative, ...violation }));
}

module.exports = { activeRules, lintEntries, lintFile, parseEntry, prepareSites };
