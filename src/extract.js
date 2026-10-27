'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SEPARATORS = new Set([' ', '\t', '\n', '"', "'", '`', '<', '>', '=', ',', '{', '}', '(', ')', ';']);
const CLASS_ATTRIBUTE = /(?:^|\s)(?:x-bind:class|:class|class)\s*=\s*(["'])([\s\S]*?)\1/g;
const STATIC_CLASS_ATTRIBUTE = /(?:^|\s)class\s*=\s*(["'])([\s\S]*?)\1/g;
const PHP_BLOCK = /<\?(?:php|=)?([\s\S]*?)(?:\?>|$)/g;
const STRING_LITERAL = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g;

function tokenize(text) {
    const tokens = [];
    let depth = 0;
    let current = '';
    for (const char of text) {
        if (char === '[') depth++;
        if (char === ']') depth = Math.max(0, depth - 1);
        if (depth === 0 && SEPARATORS.has(char)) {
            if (current) tokens.push(current);
            current = '';
            continue;
        }
        current += char;
    }
    if (current) tokens.push(current);
    return tokens.filter((token) => /[a-z0-9]/i.test(token) && !token.includes('$'));
}

function stripPhp(line) {
    return line.replace(PHP_BLOCK, (_, code) => {
        const literals = [...code.matchAll(STRING_LITERAL)].map((match) => match[1] ?? match[2]);
        return ` ${literals.join(' ')} `;
    });
}

function analyseLine(text, { php = false } = {}) {
    const stripped = php ? stripPhp(text) : text;
    const staticText = php ? text.replace(PHP_BLOCK, ' ') : text;
    return {
        tokens: tokenize(stripped),
        groups: [...stripped.matchAll(CLASS_ATTRIBUTE)].map((match) => tokenize(match[2])),
        staticGroups: [...staticText.matchAll(STATIC_CLASS_ATTRIBUTE)].map((match) => tokenize(match[2])),
        svg: /<svg[\s>]/i.test(text),
    };
}

function analyseCss(content, addedLines, postcss) {
    const entries = [];
    postcss.parse(content).walkAtRules('apply', (rule) => {
        const start = rule.source.start.line;
        const end = rule.source.end?.line ?? start;
        for (let line = start; line <= end; line++) {
            if (!addedLines.has(line)) continue;
            const tokens = tokenize(rule.params.replace(/!important/g, ''));
            entries.push({ line: start, tokens, groups: [tokens], staticGroups: [tokens], svg: false });
            break;
        }
    });
    return entries;
}

function parseDiff(diff) {
    const lines = new Set();
    let current = 0;
    for (const row of diff.split('\n')) {
        const hunk = row.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (hunk) {
            current = Number(hunk[1]);
            continue;
        }
        if (row.startsWith('+++')) continue;
        if (row.startsWith('+')) {
            lines.add(current);
            current++;
        }
    }
    return lines;
}

function originalOf(root, file, baselines) {
    for (const { match, original } of baselines) {
        const found = file.match(match);
        if (!found) continue;
        const candidate = path.resolve(root, original.replace(/\$(\d)/g, (_, index) => found[index] ?? ''));
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

function diffFiles(original, file, cwd) {
    try {
        execFileSync('git', ['diff', '--no-index', '-U0', '--no-color', original, file], { cwd, encoding: 'utf8' });
        return new Set();
    } catch (error) {
        if (error.status === 1) return parseDiff(error.stdout);
        throw error;
    }
}

function addedLineNumbers(root, file, lineCount, { all = false, baselines = [] } = {}) {
    const every = () => new Set(Array.from({ length: lineCount }, (_, index) => index + 1));
    if (all) return every();
    try {
        execFileSync('git', ['ls-files', '--error-unmatch', file], { cwd: root, stdio: 'pipe' });
    } catch (error) {
        if (error.status !== 1) throw error;
        const original = originalOf(root, file, baselines);
        return original ? diffFiles(original, path.resolve(root, file), root) : every();
    }
    return parseDiff(execFileSync('git', ['diff', '-U0', '--no-color', 'HEAD', '--', file], { cwd: root, encoding: 'utf8' }));
}

module.exports = { tokenize, stripPhp, analyseLine, analyseCss, parseDiff, addedLineNumbers, originalOf, diffFiles };
