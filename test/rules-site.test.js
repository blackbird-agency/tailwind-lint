'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseToken } = require('../src/token');
const fakeSite = require('./helpers/fake-site');
const shade = require('../src/rules/no-default-palette-shade');
const unknown = require('../src/rules/unknown-scale-value');
const arbitrary = require('../src/rules/no-arbitrary-on-scale');
const redundant = require('../src/rules/redundant-with-component');
const conflicting = require('../src/rules/no-conflicting-classes');

const site = fakeSite();
const entry = (tokens, groups = [tokens], staticGroups = groups) => ({
    tokens: tokens.map(parseToken),
    groups: groups.map((g) => g.map(parseToken)),
    staticGroups: staticGroups.map((g) => g.map(parseToken)),
    svg: false,
});
const run = (rule, tokens, groups, staticGroups) => rule.check(entry(tokens, groups, staticGroups), site);
const flagged = (rule, tokens, groups, staticGroups) => run(rule, tokens, groups, staticGroups).map((v) => v.token);

test('no-default-palette-shade', () => {
    assert.deepEqual(flagged(shade, ['bg-blue-100', 'hover:text-gray-200/50', 'border-t-red-500']), ['bg-blue-100', 'hover:text-gray-200/50', 'border-t-red-500']);
    assert.deepEqual(flagged(shade, ['bg-primary/25', 'hover:bg-blue-dark', 'text-secondary', 'border-2', 'ring-offset-2', 'text-xl']), []);
});

test('unknown-scale-value', () => {
    assert.deepEqual(flagged(unknown, ['w-122', 'gap-31', 'text-9xl', 'rounded-3xl', '-mt-7']), ['w-122', 'gap-31', 'text-9xl', 'rounded-3xl', '-mt-7']);
    assert.deepEqual(flagged(unknown, ['w-1/2', 'w-full', 'w-screen', '-mt-4', 'w-4.5', 'text-center', 'text-primary', 'text-xl', 'rounded', 'rounded-full', 'w-[488px]', 'p-px']), []);
});

test('no-arbitrary-on-scale suggests the key, never a font size that also sets line-height', () => {
    const result = run(arbitrary, ['w-[72px]', 'text-[18px]', '-mt-[1rem]', 'w-[73px]', 'w-[50%]', 'bg-[#fff]', 'text-[24px]']);
    assert.deepEqual(result.map((v) => v.token), ['w-[72px]', 'text-[18px]', '-mt-[1rem]']);
    assert.match(result[0].message, /`w-18`/);
    assert.match(result[1].message, /`text-lg`/);
    assert.match(result[2].message, /`-mt-4`/);
});

test('redundant-with-component', () => {
    assert.deepEqual(flagged(redundant, ['btn', 'btn-primary', 'rounded-full', 'text-white']), ['btn', 'rounded-full']);
    assert.deepEqual(flagged(redundant, ['title-font', 'uppercase']), ['uppercase']);
    assert.deepEqual(flagged(redundant, ['font-title', 'uppercase']), []);
    assert.deepEqual(flagged(redundant, ['btn-primary', 'md:rounded-full']), []);
    assert.deepEqual(flagged(redundant, ['btn-primary', 'rounded-full'], [['btn-primary'], ['rounded-full']]), []);
});

test('no-conflicting-classes flags same properties with different values', () => {
    const result = run(conflicting, ['p-4', 'p-6']);
    assert.deepEqual(result.map((v) => v.token), ['p-6']);
    assert.match(result[0].message, /`p-6` conflicts with `p-4`: both set `padding`/);
    assert.deepEqual(flagged(conflicting, ['block', 'hidden']), ['hidden']);
    assert.deepEqual(flagged(conflicting, ['md:translate-x-4', 'md:translate-x-6']), ['md:translate-x-6']);
});

test('no-conflicting-classes lets overrides, responsive and unknown classes pass', () => {
    assert.deepEqual(flagged(conflicting, ['p-4', 'pt-2']), []);
    assert.deepEqual(flagged(conflicting, ['text-xl', 'leading-none']), []);
    assert.deepEqual(flagged(conflicting, ['bg-primary', 'bg-opacity-50']), []);
    assert.deepEqual(flagged(conflicting, ['translate-x-4', 'translate-y-4']), []);
    assert.deepEqual(flagged(conflicting, ['p-4', 'md:p-6']), []);
    assert.deepEqual(flagged(conflicting, ['hidden', 'md:block']), []);
    assert.deepEqual(flagged(conflicting, ['p-4', 'p-4']), []);
    assert.deepEqual(flagged(conflicting, ['p-4', 'p-6'], [['p-4'], ['p-6']]), []);
    assert.deepEqual(flagged(conflicting, ['js-hook', 'other-hook']), []);
});

test('no-conflicting-classes ignores conditional classes', () => {
    assert.deepEqual(flagged(conflicting, ['text-xl', 'block', 'hidden'], [['block', 'hidden']], []), []);
});
