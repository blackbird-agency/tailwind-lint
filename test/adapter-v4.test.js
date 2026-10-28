'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { normalizeConfig } = require('../src/config');
const { loadSites } = require('../src/sites');

const root = path.join(__dirname, 'fixtures', 'hyva-v4');
const theme = 'app/design/frontend/Acme/default/web/tailwind';
const themeDir = path.join(root, theme);

const hyvaSite = (css = 'tailwind-source.css') => loadSites(normalizeConfig({
    sites: [{ name: 'hyva', config: `${theme}/package.json`, css: `${theme}/${css}` }],
}, root))[0];

const CLASSES = ['bg-brand-500', 'hover:bg-brand-500', 'bg-(--color)', 'bg-black/50', 'grow', 'flx', 'hovr:p-4'];

async function snapshot(site) {
    await site.loadClasses(CLASSES);
    const names = ['acme-widget', 'acme-source', 'card', 'card-title', 'acme-excluded', 'acme-kept'];
    return {
        generates: CLASSES.map((raw) => site.generates(raw)),
        declares: names.map((name) => site.declares(name)),
        markers: [...site.markers].sort(),
    };
}

test('v4: classes from modules, theme CSS and tokens are known without generated files', async () => {
    const site = hyvaSite();
    await site.loadClasses(CLASSES);
    assert.equal(site.version, 4);
    assert.ok(site.generates('bg-brand-500'));
    assert.ok(site.generates('hover:bg-brand-500'));
    assert.ok(site.generates('bg-(--color)'));
    assert.ok(site.generates('bg-black/50'));
    assert.ok(site.generates('grow'));
    assert.equal(site.generates('flx'), false);
    assert.equal(site.generates('hovr:p-4'), false);
    for (const name of ['acme-widget', 'acme-source', 'card', 'card-title']) assert.ok(site.declares(name), name);
    for (const name of ['acme-excluded', 'acme-kept']) assert.equal(site.declares(name), false, name);
    assert.deepEqual([...site.markers].sort(), ['dark', 'group', 'peer']);
});

test('v4: theme tokens feed the scales and default shades', async () => {
    const site = hyvaSite();
    await site.loadClasses([]);
    assert.equal(site.isDefaultShade('brand-500'), false);
    assert.equal(site.isDefaultShade('blue-500'), true);
});

test('v4: covers the theme templates and the module sources', () => {
    const site = hyvaSite();
    assert.ok(site.covers(path.join(themeDir, 'templates/page.phtml')));
    assert.ok(site.covers(path.join(root, 'vendor/acme/kept/view/frontend/templates/a.phtml')));
    assert.equal(site.covers(path.join(root, 'vendor/acme/excluded/view/frontend/templates/a.phtml')), false);
});

test('v4: @source not excludes templates from covers', () => {
    const entry = path.join(themeDir, 'source-not-entry.css');
    fs.writeFileSync(entry, '@import "tailwindcss" source(none);\n@source "./templates";\n@source not "./templates/legacy";\n');
    try {
        const site = hyvaSite('source-not-entry.css');
        assert.ok(site.covers(path.join(themeDir, 'templates/page.phtml')));
        assert.equal(site.covers(path.join(themeDir, 'templates/legacy/old.phtml')), false);
    } finally {
        fs.rmSync(entry, { force: true });
    }
});

test('v4: a stale generated folder does not change the result', async () => {
    const expected = await snapshot(hyvaSite());
    const generated = path.join(themeDir, 'generated');
    fs.mkdirSync(generated);
    try {
        const excluded = path.join(root, 'vendor/acme/excluded/view/frontend/tailwind/module.css');
        fs.writeFileSync(path.join(generated, 'hyva-source.css'), `@source "${path.join(root, 'vendor/acme/excluded')}";\n@import "${excluded}";\n`);
        fs.writeFileSync(path.join(generated, 'hyva-tokens.css'), '@theme {\n    --color-stale-500: #654321;\n}\n');
        const site = hyvaSite();
        assert.deepEqual(await snapshot(site), expected);
        assert.equal(site.declares('acme-excluded'), false);
        assert.equal(site.covers(path.join(root, 'vendor/acme/excluded/view/frontend/templates/a.phtml')), false);
        await site.loadClasses(['bg-stale-500']);
        assert.equal(site.generates('bg-stale-500'), false);
    } finally {
        fs.rmSync(generated, { recursive: true, force: true });
    }
});

test('v4: an unknown generated import is an explicit error', () => {
    const entry = path.join(themeDir, 'other-entry.css');
    fs.writeFileSync(entry, '@import "tailwindcss" source(none);\n@import "./generated/other.css";\n');
    try {
        assert.throws(() => hyvaSite('other-entry.css'), (error) => error.message
            === `tailwind-lint: ${entry} imports ${path.join(themeDir, 'generated/other.css')}, a generated file tailwind-lint cannot rebuild`);
    } finally {
        fs.rmSync(entry, { force: true });
    }
});

test('v4: a CSS syntax error names the file', () => {
    const entry = path.join(themeDir, 'broken-entry.css');
    fs.writeFileSync(entry, '@import "tailwindcss" source(none);\n.broken { color: red;\n');
    try {
        assert.throws(() => hyvaSite('broken-entry.css'), new RegExp(`^Error: tailwind-lint: cannot parse ${entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: Unclosed block$`));
    } finally {
        fs.rmSync(entry, { force: true });
    }
});

async function withEntry(name, css, run) {
    const entry = path.join(themeDir, name);
    fs.writeFileSync(entry, css);
    try {
        return await run(entry);
    } finally {
        fs.rmSync(entry, { force: true });
    }
}

test('v4: an extensionless generated import does not depend on a stale generated file', async () => {
    const css = '@import "tailwindcss" source(none);\n@import "./generated/hyva-source";\n@import "./generated/hyva-tokens";\n';
    await withEntry('extensionless-entry.css', css, async () => {
        const expected = await snapshot(hyvaSite('extensionless-entry.css'));
        assert.equal(expected.declares[0], true);
        const generated = path.join(themeDir, 'generated');
        fs.mkdirSync(generated);
        try {
            const excluded = path.join(root, 'vendor/acme/excluded/view/frontend/tailwind/module.css');
            fs.writeFileSync(path.join(generated, 'hyva-source.css'), `@import "${excluded}";\n`);
            fs.writeFileSync(path.join(generated, 'hyva-tokens.css'), '@theme {\n    --color-stale-500: #654321;\n}\n');
            assert.deepEqual(await snapshot(hyvaSite('extensionless-entry.css')), expected);
        } finally {
            fs.rmSync(generated, { recursive: true, force: true });
        }
    });
});

test('v4: generated imports inside CSS comments are ignored', async () => {
    const css = '@import "tailwindcss" source(none);\n/* @import "./generated/other.css"; */\n@import "./generated/hyva-source.css";\n';
    await withEntry('commented-entry.css', css, async () => {
        const site = hyvaSite('commented-entry.css');
        await site.loadClasses([]);
        assert.ok(site.declares('acme-widget'));
    });
});

test('v4: a non-rem --spacing gives pixel keys, an unreadable one none', async () => {
    const write = (name, spacing) => {
        const entry = path.join(themeDir, name);
        fs.writeFileSync(entry, `@import "tailwindcss" source(none);\n@theme { --spacing: ${spacing}; }\n`);
        return entry;
    };
    const px = write('px-entry.css', '4px');
    const calc = write('calc-entry.css', 'calc(1rem / 4)');
    try {
        const pxSite = hyvaSite('px-entry.css');
        await pxSite.loadClasses([]);
        assert.equal(pxSite.scale('width')['4'], '16px');
        const calcSite = hyvaSite('calc-entry.css');
        await calcSite.loadClasses([]);
        assert.equal(calcSite.scale('width')['4'], undefined);
    } finally {
        fs.rmSync(px, { force: true });
        fs.rmSync(calc, { force: true });
    }
});

test('v4: every public method is ready after loadSignatures, and guarded before', async () => {
    const site = hyvaSite();
    assert.throws(() => site.isDefaultShade('brand-500'), /called before loadClasses/);
    assert.throws(() => site.scale('width'), /called before loadClasses/);
    await site.loadSignatures([]);
    assert.equal(site.isDefaultShade('brand-500'), false);
    assert.equal(site.scale('width')['4'], '16px');
    assert.equal(site.scale('width')['9.25'], undefined);
    assert.deepEqual(site.scale('fontSize').base, ['1rem', 'calc(1.5 / 1)']);
    assert.ok(site.declares('acme-widget'));
});

test('v4 Hyvä: a root that is not the Magento root of the theme is an explicit error', () => {
    const wrongRoot = path.join(root, 'app/design/frontend/Acme');
    const configFile = path.join(wrongRoot, 'default/web/tailwind/package.json');
    const config = normalizeConfig({
        sites: [{ name: 'hyva', config: 'default/web/tailwind/package.json', css: 'default/web/tailwind/tailwind-source.css' }],
    }, wrongRoot);
    assert.throws(() => loadSites(config), { message: `tailwind-lint: ${configFile} resolves the Magento root to ${root}, but tailwind-lint runs with root ${wrongRoot}` });
});
