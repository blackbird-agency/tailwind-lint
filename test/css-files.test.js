'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { cssFileClasses } = require('../src/css-files');

function withStylesheets(files, run) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailwind-lint-css-'));
    try {
        for (const [name, css] of Object.entries(files)) {
            fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
            fs.writeFileSync(path.join(dir, name), css);
        }
        return run(dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test('cssFileClasses reads every class of every selector', () => {
    withStylesheets({
        'guide.css': '.uig-grid--icons .uig-icon-cell:hover, .uig-copy > .uig-copy-icon { color: red; }\n'
            + '@media (min-width: 40rem) { .uig-layout { display: grid; } }\n'
            + '.w-1\\/2 { width: 50%; }\n'
            + 'a[href$=".pdf"] { color: blue; }\n'
            + '@keyframes uig-pulse { 12.5% { opacity: 0; } }\n',
    }, (dir) => {
        assert.deepEqual([...cssFileClasses([path.join(dir, 'guide.css')])].sort(),
            ['uig-copy', 'uig-copy-icon', 'uig-grid--icons', 'uig-icon-cell', 'uig-layout', 'w-1/2']);
    });
});

test('cssFileClasses expands globs, skipping node_modules', () => {
    withStylesheets({
        'web/css/a.css': '.from-a { color: red; }',
        'web/css/sub/b.css': '.from-b { color: red; }',
        'web/css/node_modules/c.css': '.from-c { color: red; }',
        'web/css/d.less': '.from-d { color: red; }',
    }, (dir) => {
        assert.deepEqual([...cssFileClasses([path.join(dir, 'web/css/**/*.css')])].sort(), ['from-a', 'from-b']);
    });
});

test('cssFileClasses: a pattern that matches no file is an explicit error', () => {
    withStylesheets({}, (dir) => {
        const pattern = path.join(dir, 'missing/*.css');
        assert.throws(() => cssFileClasses([pattern]), { message: `tailwind-lint: cssFiles ${pattern} matches no file` });
    });
});

test('cssFileClasses without patterns is empty', () => {
    assert.equal(cssFileClasses().size, 0);
});
