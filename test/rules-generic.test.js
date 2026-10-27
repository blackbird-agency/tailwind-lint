'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseToken } = require('../src/token');
const hardcoded = require('../src/rules/no-hardcoded-color');
const preferSize = require('../src/rules/prefer-size');
const inlineSvg = require('../src/rules/no-inline-svg');

const entry = (tokens, groups = [tokens], svg = false) => ({
    tokens: tokens.map(parseToken),
    groups: groups.map((group) => group.map(parseToken)),
    svg,
});
const flagged = (rule, e) => rule.check(e).map((v) => v.token);

test('no-hardcoded-color flags colour values', () => {
    assert.deepEqual(flagged(hardcoded, entry(['bg-[#F5F5F5]', 'hover:text-[rgb(0,0,0)]', '[color:#fff]', 'border-[hsl(0,0%,0%)]'])),
        ['bg-[#F5F5F5]', 'hover:text-[rgb(0,0,0)]', '[color:#fff]', 'border-[hsl(0,0%,0%)]']);
});

test('no-hardcoded-color lets other arbitrary values pass', () => {
    assert.deepEqual(flagged(hardcoded, entry(['w-[488px]', 'bg-[url(/a.png)]', 'text-[10px]', 'bg-primary/25', 'grid-cols-[1fr_2fr]'])), []);
});

test('prefer-size flags matching w/h with same variants', () => {
    const result = preferSize.check(entry(['md:w-11', 'md:h-11', 'p-4']));
    assert.deepEqual(result.map((v) => v.token), ['md:w-11']);
    assert.match(result[0].message, /md:size-11/);
});

test('prefer-size lets differing variants, values and screen pass', () => {
    assert.deepEqual(flagged(preferSize, entry(['md:w-11', 'h-11'])), []);
    assert.deepEqual(flagged(preferSize, entry(['w-11', 'h-12'])), []);
    assert.deepEqual(flagged(preferSize, entry(['w-screen', 'h-screen'])), []);
    assert.deepEqual(flagged(preferSize, entry(['w-11', 'h-11'], [['w-11'], ['h-11']])), []);
});

test('no-inline-svg', () => {
    assert.equal(inlineSvg.check(entry([], [], true)).length, 1);
    assert.equal(inlineSvg.check(entry([], [], false)).length, 0);
});
