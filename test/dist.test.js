'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const esbuild = require('esbuild');

// Composer ships dist/ as committed: it must be the build of the current sources (`npm run build`).
test('dist/tailwind-lint.js is up to date', () => {
    const outfile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tailwind-lint-')), 'tailwind-lint.js');
    esbuild.buildSync({ entryPoints: [path.join(__dirname, '../bin/lint.js')], bundle: true, platform: 'node', target: 'node18', outfile, logLevel: 'silent' });
    const strip = (file) => fs.readFileSync(file, 'utf8').replace(/^\/\/ .*$/gm, '');
    assert.ok(strip(outfile) === strip(path.join(__dirname, '../dist/tailwind-lint.js')), 'dist/ is stale: run npm run build');
});
