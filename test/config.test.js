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

test('normalizeConfig rejects unknown rules and malformed rule options', () => {
    const sites = [{ config: 'a.js', css: 'a.css' }];
    assert.throws(() => normalizeConfig({ sites, rules: { 'no-inline-svg': false } }, '/project'), /unknown rule "no-inline-svg"/);
    assert.throws(() => normalizeConfig({ sites, rules: { 'enforces-shorthand': true } }, '/project'), /rule "enforces-shorthand" takes false/);
    assert.deepEqual(normalizeConfig({ sites, rules: { 'enforces-shorthand': false, 'no-hardcoded-color': { hint: 'x' } } }, '/project').rules,
        { 'enforces-shorthand': false, 'no-hardcoded-color': { hint: 'x' } });
});

test('normalizeConfig checks rule-specific options and resolves cssFiles against the base', () => {
    const sites = [{ config: 'a.js', css: 'a.css' }];
    assert.throws(() => normalizeConfig({ sites, rules: { 'no-hardcoded-color': { cssFiles: ['a.css'] } } }, '/project'), /rule "no-hardcoded-color" has no option "cssFiles"/);
    assert.throws(() => normalizeConfig({ sites, rules: { 'no-unknown-class': { cssFile: ['a.css'] } } }, '/project'), /rule "no-unknown-class" has no option "cssFile"/);
    assert.throws(() => normalizeConfig({ sites, rules: { 'no-unknown-class': { cssFiles: 'a.css' } } }, '/project'), /invalid option "cssFiles" of rule "no-unknown-class"/);
    assert.deepEqual(normalizeConfig({ sites, rules: { 'no-unknown-class': { cssFiles: ['vendor/x/web/css/*.css'], hint: 'h' } } }, '/project').rules,
        { 'no-unknown-class': { cssFiles: [path.resolve('/project/vendor/x/web/css/*.css')], hint: 'h' } });
});

test('globToRegExp supports braces', () => {
    assert.ok(globToRegExp('**/{dist,build}/**').test('a/build/x.css'));
    assert.equal(globToRegExp('**/{dist,build}/**').test('a/src/x.css'), false);
});
