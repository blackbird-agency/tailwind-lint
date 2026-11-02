'use strict';

const fs = require('fs');
const path = require('path');
const micromatch = require('micromatch');
const postcss = require('postcss');

const CLASS = /\.((?:\\.|[\w-])+)/g;
const cache = new Map();

function walk(dir, files) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file, files);
        else files.push(file);
    }
}

function expand(pattern) {
    const { base, isGlob } = micromatch.scan(pattern);
    if (!isGlob) return fs.existsSync(pattern) ? [pattern] : [];
    const files = [];
    walk(base, files);
    return files.filter((file) => micromatch.isMatch(file, pattern));
}

function classesOf(file, classes) {
    let root;
    try {
        root = postcss.parse(fs.readFileSync(file, 'utf8'), { from: file });
    } catch (error) {
        throw new Error(`tailwind-lint: cannot parse ${file}: ${error.reason ?? error.message}`);
    }
    root.walkRules((rule) => {
        if (rule.parent?.type === 'atrule' && /keyframes$/.test(rule.parent.name)) return;
        // Attribute values may contain dots: `[href$=".pdf"]`.
        for (const match of rule.selector.replace(/\[[^\]]*\]/g, '').matchAll(CLASS)) classes.add(match[1].replace(/\\(.)/g, '$1'));
    });
}

function cssFileClasses(patterns = []) {
    const key = patterns.join('\0');
    if (!cache.has(key)) {
        const classes = new Set();
        for (const pattern of patterns) {
            const files = expand(pattern);
            if (!files.length) throw new Error(`tailwind-lint: cssFiles ${pattern} matches no file`);
            files.forEach((file) => classesOf(file, classes));
        }
        cache.set(key, classes);
    }
    return cache.get(key);
}

module.exports = { cssFileClasses };
