'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { adapterFor } = require('../src/sites');
const { directory, site } = require('./helpers/fixture');

test('adapterFor picks the adapter from the Tailwind major version', () => {
    assert.equal(typeof adapterFor('3.4.19').loadSite, 'function');
    assert.equal(typeof adapterFor('4.1.17').loadSite, 'function');
    assert.throws(() => adapterFor('5.0.0'), /Tailwind CSS v5 is not supported yet/);
});

test('covers follows content globs, and the css entry folder for stylesheets', () => {
    assert.equal(site.covers(path.join(directory, 'templates/bad.phtml')), true);
    assert.equal(site.covers(path.join(directory, 'tailwind.config.js')), false);
    assert.equal(site.covers(path.join(directory, 'components/button.css')), true);
    assert.equal(site.covers(path.join(directory, '../other.css')), false);
});

test('isDefaultShade', () => {
    assert.equal(site.isDefaultShade('blue-100'), true);
    assert.equal(site.isDefaultShade('gray-200'), true);
    assert.equal(site.isDefaultShade('blue-dark'), false);
    assert.equal(site.isDefaultShade('primary'), false);
});

test('scale comes from the resolved config', () => {
    assert.equal(site.scale('width')['18'], '4.5rem');
    assert.equal(site.scale('width')['122'], undefined);
});

test('closure reads nested @apply and keeps inherited component names, not their utilities', () => {
    assert.ok(site.closure('btn-primary').has('btn'));
    assert.ok(site.closure('title-font').has('uppercase'));
    const small = site.closure('btn-primary-small');
    assert.ok(small.has('btn-primary'));
    assert.ok(small.has('btn'));
    assert.equal(small.has('px-8'), false);
    assert.equal(site.closure('btn-primary').has('bg-transparent'), false);
    assert.equal(site.closure('not-a-component'), null);
});

test('closure ignores @apply under @screen / @media', () => {
    assert.ok(site.closure('step').has('w-full'));
    assert.equal(site.closure('step').has('px-10'), false);
    assert.equal(site.closure('step').has('w-1/2'), false);
});

test('signatures come from Tailwind itself', async () => {
    await site.loadSignatures(['p-4', 'text-xl', 'not-a-class']);
    assert.deepEqual(site.signature('p-4'), [['padding', '1rem']]);
    assert.deepEqual(site.signature('text-xl').map(([prop]) => prop), ['font-size', 'line-height']);
    assert.equal(site.signature('not-a-class'), null);
});
