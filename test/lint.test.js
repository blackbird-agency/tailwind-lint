'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { activeRules, lintEntries, lintFile, parseEntries, prepareSites } = require('../src/lint');
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
        '5 no-inline-svg <svg',
        '6 no-conflicting-classes p-6',
    ]);
});

test('good fixture yields nothing', async () => {
    assert.deepEqual(await lint('templates/good.phtml'), []);
});

test('a rule set to false is skipped, a hint is appended', async () => {
    const options = fixtureConfig({ rules: { 'no-inline-svg': { hint: 'use the icon helper' }, 'unknown-scale-value': false } });
    const result = await lint('templates/bad.phtml', options);
    assert.equal(result.some((v) => v.rule === 'unknown-scale-value'), false);
    assert.match(result.find((v) => v.rule === 'no-inline-svg').message, /\(use the icon helper\)$/);
});

test('include and ignore are honoured', async () => {
    assert.deepEqual(await lint('templates/bad.phtml', fixtureConfig({ ignore: ['templates/**'] })), []);
    assert.deepEqual(await lint('templates/bad.phtml', fixtureConfig({ include: ['**/*.css'] })), []);
    assert.deepEqual(await lint('missing.phtml'), []);
});

test('stylesheets are linted through their @apply', async () => {
    assert.deepEqual(await lint('components/button.css'), []);
});

test('site rules only fire when every covering site agrees', async () => {
    const fakeA = { ...site, isDefaultShade: () => true };
    const fakeB = { ...site, isDefaultShade: () => false };
    const entries = parseEntries([{ line: 1, tokens: ['bg-blue-100'], groups: [], staticGroups: [], svg: false }]);
    await prepareSites(entries, [site]);
    assert.equal(lintEntries(entries, [fakeA, fakeB], activeRules()).length, 0);
    assert.equal(lintEntries(entries, [fakeA, fakeA], activeRules()).length, 1);
});

test('no covering site: only generic rules run', async () => {
    const result = await lintFile(directory, 'templates/bad.phtml', [], config, { all: true });
    assert.deepEqual(result.map((v) => v.rule), ['no-inline-svg']);
});

test('format', () => {
    assert.equal(format([{ file: 'a.phtml', line: 3, rule: 'r', message: 'm' }]), 'a.phtml:3 [r] m');
});
