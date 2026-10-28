'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRequire } = require('module');
const { readHyvaConfig, isHyvaTheme, hyvaModules, hyvaSourceCss, hyvaTokensCss } = require('../src/hyva');

const root = path.join(__dirname, 'fixtures', 'hyva-v4');
const themeDir = path.join(root, 'app/design/frontend/Acme/default/web/tailwind');
const req = require;

test('hyvaModules discovers module folders, sorted, with Hyvä exclusions', () => {
    assert.deepEqual(hyvaModules(root, readHyvaConfig(themeDir)), [
        { src: 'app/code/Acme/Widget', cssExcluded: false },
        { src: 'vendor/acme/kept', cssExcluded: true },
        { src: 'vendor/acme/source-only', cssExcluded: false },
    ]);
});

test('hyvaModules honours includeExternalModules false and include', () => {
    const config = { tailwind: { includeExternalModules: false, include: [{ src: 'vendor/hyva-themes/magento2-default-theme' }] } };
    assert.deepEqual(hyvaModules(root, config), [{ src: 'vendor/hyva-themes/magento2-default-theme', cssExcluded: false }]);
});

test('hyvaSourceCss mirrors the generator layout', () => {
    const css = hyvaSourceCss(root, hyvaModules(root, readHyvaConfig(themeDir)), 'frontend');
    assert.match(css, /@source "[^"]*vendor\/acme\/kept";[\s\S]*@source "[^"]*vendor\/acme\/source-only";[\s\S]*@import "[^"]*source-only\/view\/frontend\/tailwind\/tailwind-source\.css";[\s\S]*@import "[^"]*Widget\/view\/frontend\/tailwind\/module\.css";/);
    assert.doesNotMatch(css, /excluded/);
});

test('hyvaTokensCss rejects remote sources', async () => {
    await assert.rejects(hyvaTokensCss(themeDir, { tokens: { src: 'https://x/tokens.json' } }, req), /must be a local JSON file/);
});

test('hyvaTokensCss converts the configured token values with the theme packages', async () => {
    const themeReq = createRequire(path.join(themeDir, 'package.json'));
    assert.match(await hyvaTokensCss(themeDir, readHyvaConfig(themeDir), themeReq), /--color-brand-500: #123456;/);
});

test('hyvaTokensCss: a missing explicit tokens file is an error, a missing default file is not', async () => {
    const file = path.join(themeDir, 'missing.tokens.json');
    await assert.rejects(hyvaTokensCss(themeDir, { tokens: { src: 'missing.tokens.json' } }, req), { message: `tailwind-lint: design tokens file not found: ${file}` });
    assert.equal(await hyvaTokensCss(themeDir, { tokens: {} }, req), null);
});

test('readHyvaConfig reports invalid JSON with the file name', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyva-config-'));
    try {
        fs.writeFileSync(path.join(dir, 'hyva.config.json'), '{ nope');
        assert.throws(() => readHyvaConfig(dir), (error) => error.message.startsWith(`tailwind-lint: cannot parse ${path.join(dir, 'hyva.config.json')}: `));
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('isHyvaTheme: hyva.config.json or a hyva-modules reference, not a resolvable package', () => {
    const read = (file) => fs.readFileSync(file, 'utf8');
    const plain = path.join(__dirname, 'fixtures', 'project');
    assert.equal(isHyvaTheme(plain, read(path.join(plain, 'tailwind.config.js'))), false);
    const v3 = path.join(__dirname, 'fixtures', 'hyva-v3', 'app/design/frontend/Acme/default/web/tailwind');
    assert.equal(fs.existsSync(path.join(v3, 'hyva.config.json')), false);
    assert.equal(isHyvaTheme(v3, read(path.join(v3, 'tailwind.config.js'))), true);
    assert.equal(isHyvaTheme(themeDir, read(path.join(themeDir, 'tailwind-source.css'))), true);
});

test('hyvaModules does not look for modules inside a module', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailwind-lint-'));
    for (const module of ['vendor/acme/outer', 'vendor/acme/outer/sub']) fs.mkdirSync(path.join(dir, module, 'view/frontend/tailwind'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'vendor/acme/outer/registration.php'), '<?php\n');
    assert.deepEqual(hyvaModules(dir, null).map((m) => m.src), ['vendor/acme/outer']);
});
