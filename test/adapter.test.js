'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { normalizeConfig } = require('../src/config');
const { adapterFor, loadSites } = require('../src/sites');
const { directory, site } = require('./helpers/fixture');

const hyvaV3Theme = 'app/design/frontend/Acme/default/web/tailwind';
const hyvaV3Config = normalizeConfig({
    sites: [{ name: 'hyva-v3', config: `${hyvaV3Theme}/tailwind.config.js`, css: `${hyvaV3Theme}/tailwind-source.css` }],
}, path.join(__dirname, 'fixtures', 'hyva-v3'));

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

test('v3: existing fixture exposes generates/declares', async () => {
    await site.loadClasses(['p-4', 'md:p-4', 'container', 'flx', 'bg-[--color]', 'hovr:p-4']);
    assert.equal(site.version, 3);
    for (const raw of ['p-4', 'md:p-4', 'container', 'bg-[--color]']) assert.ok(site.generates(raw), raw);
    for (const raw of ['flx', 'hovr:p-4']) assert.equal(site.generates(raw), false, raw);
    for (const name of ['btn', 'btn-primary-small', 'title-font', 'step']) assert.ok(site.declares(name), name);
});

test('v3 Hyvä: module config and CSS are merged without hyva-themes.json, whatever the cwd', async () => {
    const before = process.cwd();
    process.chdir(os.tmpdir());
    try {
        const [hyva] = loadSites(hyvaV3Config);
        await hyva.loadClasses(['bg-widget']);
        assert.ok(hyva.generates('bg-widget'));
        assert.ok(hyva.declares('acme-v3'));
        assert.ok(hyva.markers.has('dark'));
    } finally {
        process.chdir(before);
    }
    assert.equal(process.cwd(), before);
});

test('v3 Hyvä: a root that is not the Magento root hyva-modules resolves is an explicit error', () => {
    const root = path.join(__dirname, 'fixtures', 'hyva-v3');
    const wrongRoot = path.join(root, 'app/design/frontend/Acme');
    const configFile = path.join(wrongRoot, 'default/web/tailwind/tailwind.config.js');
    const config = normalizeConfig({
        sites: [{ name: 'hyva-v3', config: 'default/web/tailwind/tailwind.config.js', css: 'default/web/tailwind/tailwind-source.css' }],
    }, wrongRoot);
    assert.throws(() => loadSites(config), { message: `tailwind-lint: ${configFile} resolves the Magento root to ${root}, but tailwind-lint runs with root ${wrongRoot}` });
});

test('v3 Hyvä: a theme config that throws still restores the cwd and fs.readFileSync', () => {
    const root = path.join(__dirname, 'fixtures', 'hyva-v3');
    const theme = 'app/design/frontend/Acme/broken/web/tailwind';
    const dir = path.join(root, theme);
    fs.mkdirSync(dir, { recursive: true });
    const before = process.cwd();
    const { readFileSync } = fs;
    try {
        fs.writeFileSync(path.join(dir, 'tailwind.config.js'), "require('@hyva-themes/hyva-modules');\nthrow new Error('boom');\n");
        fs.writeFileSync(path.join(dir, 'tailwind-source.css'), '@tailwind utilities;\n');
        const config = normalizeConfig({ sites: [{ name: 'broken', config: `${theme}/tailwind.config.js`, css: `${theme}/tailwind-source.css` }] }, root);
        assert.throws(() => loadSites(config), /boom/);
        assert.equal(process.cwd(), before);
        assert.equal(fs.readFileSync, readFileSync);
    } finally {
        fs.rmSync(path.join(root, 'app/design/frontend/Acme/broken'), { recursive: true, force: true });
        process.chdir(before);
    }
});

test('v3: classes sharing a screen variant in one batch are each generated', async () => {
    const raws = ['md:px-4', 'md:block', 'hover:p-2', 'hover:block', 'lg:flex-row', 'lg:w-1/2'];
    await site.loadClasses(raws);
    for (const raw of raws) assert.ok(site.generates(raw), raw);
});

test('v3: theme components from @layer components are generated with variants', async () => {
    await site.loadClasses(['md:btn', 'hover:btn-primary', 'md:step', 'md:not-a-component']);
    for (const raw of ['md:btn', 'hover:btn-primary', 'md:step']) assert.ok(site.generates(raw), raw);
    assert.equal(site.generates('md:not-a-component'), false);
});

test('v3: Tailwind warnings are muted, they would reach Claude through the hook stderr', async () => {
    const warnings = [];
    const { warn } = console;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
        require('tailwindcss/lib/util/log').default.warn('tailwind-lint-test', ['should not be printed']);
        await site.loadSignatures(['not-a-utility-at-all']);
    } finally {
        console.warn = warn;
    }
    assert.deepEqual(warnings, []);
});

test('v3: an @import tailwind-lint cannot resolve is an explicit error, package imports are skipped', () => {
    const dir = fs.mkdtempSync(path.join(__dirname, 'fixtures', 'imports-'));
    try {
        fs.writeFileSync(path.join(dir, 'tailwind.config.js'), "module.exports = { content: ['./*.phtml'] };\n");
        fs.writeFileSync(path.join(dir, 'present.css'), '.present { color: red; }\n');
        const load = (imports) => {
            fs.writeFileSync(path.join(dir, 'styles.css'), `${imports}\n@import url(present.css);\n@tailwind utilities;\n`);
            return loadSites(normalizeConfig({ sites: [{ name: 's', config: 'tailwind.config.js', css: 'styles.css' }] }, dir));
        };
        assert.doesNotThrow(() => load('@import "tailwindcss/base";\n@import "tailwindcss/components";'));
        for (const target of ['missing.css', './present', 'components/*.css']) {
            assert.throws(() => load(`@import "${target}";`), { message: `tailwind-lint: ${path.join(dir, 'styles.css')} imports ${target}, which tailwind-lint cannot resolve` });
        }
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('v3: a negated content glob is excluded from covers', () => {
    const dir = fs.mkdtempSync(path.join(__dirname, 'fixtures', 'negated-'));
    try {
        fs.writeFileSync(path.join(dir, 'tailwind.config.js'), "module.exports = { content: ['./**/*.phtml', '!./legacy/**'] };\n");
        fs.writeFileSync(path.join(dir, 'styles.css'), '@tailwind utilities;\n');
        const [negated] = loadSites(normalizeConfig({ sites: [{ name: 's', config: 'tailwind.config.js', css: 'styles.css' }] }, dir));
        assert.equal(negated.covers(path.join(dir, 'templates/a.phtml')), true);
        assert.equal(negated.covers(path.join(dir, 'legacy/b.phtml')), false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
