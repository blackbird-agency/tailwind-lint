'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRequire } = require('module');
const { assertLocked } = require('../src/lockfile');

function sandbox(lockVersion, rawLock) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailwind-lint-'));
    const pkg = path.join(dir, 'node_modules', 'pkg');
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, 'package.json'), '{"name":"pkg","version":"1.0.0","main":"i.js"}');
    fs.writeFileSync(path.join(pkg, 'i.js'), 'module.exports = 1;');
    if (lockVersion !== null) {
        fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({
            lockfileVersion: 3,
            packages: { 'node_modules/pkg': { version: lockVersion } },
        }));
    }
    if (rawLock !== undefined) fs.writeFileSync(path.join(dir, 'package-lock.json'), rawLock);
    return createRequire(path.join(dir, 'x.js'));
}

test('assertLocked accepts the locked version', () => {
    assert.doesNotThrow(() => assertLocked(sandbox('1.0.0'), ['pkg']));
});

test('assertLocked rejects a version drift', () => {
    assert.throws(() => assertLocked(sandbox('1.0.1'), ['pkg']), /pkg 1\.0\.0 is installed in .* but its package-lock\.json pins 1\.0\.1/);
});

test('assertLocked rejects a missing lock', () => {
    assert.throws(() => assertLocked(sandbox(null), ['pkg']), /no package-lock\.json in .*, required to pin pkg/);
});

test('assertLocked rejects a missing package', () => {
    assert.throws(() => assertLocked(sandbox('1.0.0'), ['nope']), /nope is not installed for/);
});

test('assertLocked names a corrupt lock file', () => {
    assert.throws(() => assertLocked(sandbox(null, '{not json'), ['pkg']), /cannot parse .*package-lock\.json/);
});
