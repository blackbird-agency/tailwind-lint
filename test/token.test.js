'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseToken, matchPrefix, rebuild, bare } = require('../src/token');
const { COLOR_PREFIXES } = require('../src/utilities');

test('variants, important, negative', () => {
    const t = parseToken('md:hover:!-mt-4');
    assert.deepEqual(t.variants, ['md', 'hover']);
    assert.equal(t.important, true);
    assert.equal(t.negative, true);
    assert.equal(t.core, 'mt-4');
});

test('brackets protect colons in variants and values', () => {
    const t = parseToken('[&>*]:bg-[url(a:b)]');
    assert.deepEqual(t.variants, ['[&>*]']);
    assert.equal(t.core, 'bg-[url(a:b)]');
    assert.equal(t.arbitrary, 'url(a:b)');
});

test('opacity is split off, fractions are kept', () => {
    assert.equal(parseToken('bg-blue-100/50').core, 'bg-blue-100');
    assert.equal(parseToken('bg-blue-100/50').opacity, '50');
    assert.equal(parseToken('bg-primary/[0.3]').opacity, '[0.3]');
    assert.equal(parseToken('w-1/2').core, 'w-1/2');
    assert.equal(parseToken('w-1/2').opacity, null);
    assert.equal(parseToken('-translate-x-1/2').core, 'translate-x-1/2');
});

test('arbitrary property', () => {
    const t = parseToken('[color:#fff]');
    assert.equal(t.property, 'color');
    assert.equal(t.arbitrary, '#fff');
});

test('matchPrefix takes the longest prefix', () => {
    assert.deepEqual(matchPrefix('border-t-blue-100', COLOR_PREFIXES), { prefix: 'border-t', value: 'blue-100' });
    assert.deepEqual(matchPrefix('ring-offset-blue-100', COLOR_PREFIXES), { prefix: 'ring-offset', value: 'blue-100' });
    assert.equal(matchPrefix('flex', COLOR_PREFIXES), null);
});

test('rebuild keeps variants, important, negative and opacity', () => {
    assert.equal(rebuild(parseToken('md:!bg-gray-blue/50'), 'bg-slate-dark'), 'md:!bg-slate-dark/50');
    assert.equal(rebuild(parseToken('-mt-[16px]'), 'mt-4'), '-mt-4');
});

test('bare drops variants and important, keeps negative and opacity', () => {
    assert.equal(bare(parseToken('md:!-mt-4')), '-mt-4');
    assert.equal(bare(parseToken('hover:bg-primary/50')), 'bg-primary/50');
});
