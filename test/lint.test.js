'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { activeRules, lintEntries, lintFile, parseEntry, prepareSites } = require('../src/lint');
const { analyseTemplate } = require('../src/extract');
const { format } = require('../src/report');
const { directory, config, fixtureConfig, site } = require('./helpers/fixture');

const lint = (file, options = config) => lintFile(directory, file, [site], options, { all: true });
const summary = (violations) => violations.map((v) => `${v.line} ${v.rule} ${v.token}`);

test('bad fixture yields exactly the expected violations', async () => {
    assert.deepEqual(summary(await lint('templates/bad.phtml')), [
        '1 no-default-palette-shade bg-blue-100',
        '2 unknown-scale-value w-122',
        '3 redundant-with-component btn',
        '4 redundant-with-component uppercase',
        '5 no-hardcoded-color bg-[#f5f5f5]',
        '6 no-conflicting-classes p-6',
        '8 no-conflicting-classes p-6',
        '9 no-unknown-class flx',
    ]);
});

test('good fixture yields nothing', async () => {
    assert.deepEqual(await lint('templates/good.phtml'), []);
});

test('a rule set to false is skipped, a hint is appended', async () => {
    const options = fixtureConfig({ rules: { 'no-hardcoded-color': { hint: 'use a theme alias' }, 'unknown-scale-value': false } });
    const result = await lint('templates/bad.phtml', options);
    assert.equal(result.some((v) => v.rule === 'unknown-scale-value'), false);
    assert.match(result.find((v) => v.rule === 'no-hardcoded-color').message, /\(use a theme alias\)$/);
});

test('include and ignore are honoured', async () => {
    assert.deepEqual(await lint('templates/bad.phtml', fixtureConfig({ ignore: ['templates/**'] })), []);
    assert.deepEqual(await lint('templates/bad.phtml', fixtureConfig({ include: ['**/*.css'] })), []);
});

test('a missing file is an error, not a clean result', async () => {
    await assert.rejects(lint('missing.phtml'), /missing\.phtml does not exist/);
});

test('stylesheets are linted through their @apply', async () => {
    assert.deepEqual(await lint('components/button.css'), []);
});

test('site rules only fire when every covering site agrees', async () => {
    const fakeA = { ...site, isDefaultShade: () => true };
    const fakeB = { ...site, isDefaultShade: () => false };
    const entry = parseEntry(analyseTemplate('<i class="bg-blue-100">', { php: true }));
    await prepareSites(entry, [site]);
    assert.equal(lintEntries(entry, new Set([1]), [fakeA, fakeB], activeRules()).length, 0);
    assert.equal(lintEntries(entry, new Set([1]), [fakeA, fakeA], activeRules()).length, 1);
});

test('only classes on added lines are reported, but the whole attribute is compared', async () => {
    const entry = parseEntry(analyseTemplate('<div class="p-4\n  p-6">', { php: true }));
    await prepareSites(entry, [site]);
    assert.deepEqual(lintEntries(entry, new Set([2]), [site], activeRules()).map((v) => `${v.line} ${v.rule} ${v.token}`),
        ['2 no-conflicting-classes p-6']);
    assert.deepEqual(lintEntries(entry, new Set([1]), [site], activeRules()), []);
});

test('violations come out in line, column, rule order', async () => {
    const entry = parseEntry(analyseTemplate('<i class="w-122 bg-[#fff]">\n<i class="bg-blue-100">', { php: true }));
    await prepareSites(entry, [site]);
    assert.deepEqual(lintEntries(entry, new Set([1, 2]), [site], activeRules()).map((v) => v.token),
        ['w-122', 'bg-[#fff]', 'bg-blue-100']);
});

test('a superseding rule hides the superseded violation on the same token', () => {
    const entry = parseEntry(analyseTemplate('<i class="x">', { php: true }));
    const flag = (id, extra = {}) => ({ rule: { id, siteDependent: false, ...extra, check: (e) => e.tokens.filter((t) => t.raw === 'x').map((token) => ({ token, message: id })) } });
    const rules = [flag('a'), flag('b', { supersedes: ['a'] })];
    assert.deepEqual(lintEntries(entry, new Set([1]), [], rules).map((v) => v.rule), ['b']);
    assert.deepEqual(lintEntries(entry, new Set([1]), [], [flag('a')]).map((v) => v.rule), ['a']);
});

test('no covering site: only generic rules run', async () => {
    const result = await lintFile(directory, 'templates/bad.phtml', [], config, { all: true });
    assert.deepEqual(result.map((v) => v.rule), ['no-hardcoded-color']);
});

test('format', () => {
    assert.equal(format([{ file: 'a.phtml', line: 3, rule: 'r', message: 'm' }]), 'a.phtml:3 [r] m');
});

test('a removed v3 class is reported once, by the specific rule', () => {
    const entry = parseEntry(analyseTemplate('<i class="flex-grow">', { php: true }));
    const v4 = { ...site, version: 4, generates: () => false, declares: () => false };
    assert.deepEqual(lintEntries(entry, new Set([1]), [v4], activeRules()).map((v) => v.rule), ['no-removed-v3-class']);
    assert.deepEqual(lintEntries(entry, new Set([1]), [v4], activeRules({ 'no-removed-v3-class': false })).map((v) => v.rule), ['no-unknown-class']);
});

test('redundant-with-component and enforces-shorthand ignore combinations across binding or PHP alternatives', async () => {
    const check = async (src) => {
        const entry = parseEntry(analyseTemplate(src, { php: true }));
        await prepareSites(entry, [site]);
        return lintEntries(entry, new Set([1]), [site], activeRules()).map((v) => `${v.rule} ${v.token}`);
    };
    assert.deepEqual(await check(`<a :class="{ 'w-4 btn': open, 'h-4 btn-primary': !open }">`), []);
    assert.deepEqual(await check(`<?php $linkClass = $open ? 'w-4 btn' : 'h-4 btn-primary'; ?>`), []);
    assert.deepEqual(await check(`<a class="<?= $open ? 'w-4 btn' : 'h-4 btn-primary' ?>">`), []);
    assert.deepEqual(await check('<a class="w-4 h-4 btn btn-primary">'), ['enforces-shorthand w-4', 'redundant-with-component btn']);
});

test('an unknown class is not also reported as a default palette shade', () => {
    const entry = parseEntry(analyseTemplate('<i class="bg-blue-100">', { php: true }));
    const unknown = { ...site, generates: () => false, declares: () => false, isDefaultShade: () => true };
    assert.deepEqual(lintEntries(entry, new Set([1]), [unknown], activeRules()).map((v) => v.rule), ['no-unknown-class']);
});
