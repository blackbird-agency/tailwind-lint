'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseToken } = require('../src/token');
const hardcoded = require('../src/rules/no-hardcoded-color');
const duplicate = require('../src/rules/no-duplicate-classes');
const { analyseTemplate } = require('../src/extract');
const { parseEntry } = require('../src/lint');

const entry = (tokens, groups = [tokens], staticGroups = groups) => ({
    tokens: tokens.map(parseToken),
    groups: groups.map((group) => group.map(parseToken)),
    staticGroups: staticGroups.map((group) => group.map(parseToken)),
});
const flagged = (rule, e) => rule.check(e).map((v) => v.token.raw);

test('no-hardcoded-color flags colour values', () => {
    assert.deepEqual(flagged(hardcoded, entry(['bg-[#F5F5F5]', 'hover:text-[rgb(0,0,0)]', '[color:#fff]', 'border-[hsl(0,0%,0%)]'])),
        ['bg-[#F5F5F5]', 'hover:text-[rgb(0,0,0)]', '[color:#fff]', 'border-[hsl(0,0%,0%)]']);
});

test('no-hardcoded-color lets other arbitrary values pass', () => {
    assert.deepEqual(flagged(hardcoded, entry(['w-[488px]', 'bg-[url(/a.png)]', 'text-[10px]', 'bg-primary/25', 'grid-cols-[1fr_2fr]'])), []);
});

test('no-duplicate-classes flags repeats with the same variants', () => {
    const e = { staticGroups: [['p-4', 'md:p-4', 'p-4', '!p-4', 'md:p-4'].map(parseToken)] };
    assert.deepEqual(duplicate.check(e).map((v) => v.token.raw), ['p-4', 'md:p-4']);
    assert.equal(duplicate.check(e)[0].message, '`p-4` is duplicated');
});

test('no-duplicate-classes ignores alternatives', () => {
    const { groups } = analyseTemplate(`<i class="<?= $a ? 'p-4' : 'p-4 m-2' ?>">`, { php: true });
    const e = parseEntry({ looseTokens: [], groups });
    assert.deepEqual(duplicate.check(e), []);
});

test('no-duplicate-classes treats both important syntaxes as one class', () => {
    const e = { staticGroups: [['!p-4', 'p-4!'].map(parseToken)] };
    assert.deepEqual(duplicate.check(e).map((v) => v.token.raw), ['p-4!']);
});
