'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { globToRegExp, normalizeConfig } = require('../src/config');

test('globToRegExp', () => {
    assert.ok(globToRegExp('**/*.phtml').test('a/b/c.phtml'));
    assert.ok(globToRegExp('**/*.phtml').test('c.phtml'));
    assert.equal(globToRegExp('*.phtml').test('a/c.phtml'), false);
    assert.ok(globToRegExp('vendor/**').test('vendor/a/b.css'));
    assert.equal(globToRegExp('vendor/**').test('app/vendor/b.css'), false);
    assert.ok(globToRegExp('**/web/css/**').test('app/design/x/web/css/styles.css'));
    assert.equal(globToRegExp('a.css').test('aXcss'), false);
});

test('normalizeConfig resolves paths against the base and fills defaults', () => {
    const config = normalizeConfig({ sites: [{ config: 'a/tailwind.config.js', css: 'a/styles.css' }] }, '/project');
    assert.deepEqual(config.sites, [{ name: 'site-1', config: path.resolve('/project/a/tailwind.config.js'), css: path.resolve('/project/a/styles.css') }]);
    assert.ok(config.include.some((pattern) => pattern.test('x/y.phtml')));
    assert.ok(config.ignore.some((pattern) => pattern.test('x/node_modules/y.css')));
    assert.deepEqual(config.baselines, []);
    assert.deepEqual(config.rules, {});
});

test('normalizeConfig rejects incomplete sites', () => {
    assert.throws(() => normalizeConfig({}, '/project'), /"sites" must be an array/);
    assert.throws(() => normalizeConfig({ sites: [{ config: 'a.js' }] }, '/project'), /site #1 needs "config" and "css"/);
});
