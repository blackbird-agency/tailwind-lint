'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { tokenize, stripPhp, analyseLine, analyseCss, parseDiff, addedLineNumbers, originalOf, diffFiles } = require('../src/extract');

test('tokenize respects brackets', () => {
    assert.deepEqual(tokenize('class="bg-[rgb(1,2,3)] w-4"'), ['class', 'bg-[rgb(1,2,3)]', 'w-4']);
});

test('stripPhp keeps string literals only', () => {
    const text = stripPhp('<div class="p-4 <?= $a ? \'bg-red\' : "bg-blue-100" ?> m-2">');
    assert.deepEqual(tokenize(text).filter((t) => t !== 'div' && t !== 'class'), ['p-4', 'bg-red', 'bg-blue-100', 'm-2']);
});

test('analyseLine groups class attributes', () => {
    const result = analyseLine('<a class="btn btn-primary" :class="{ \'w-4 h-4\': open }"><svg></svg></a>', { php: true });
    assert.deepEqual(result.groups, [['btn', 'btn-primary'], ['w-4', 'h-4', 'open']]);
    assert.equal(result.svg, true);
    assert.ok(result.tokens.includes('btn-primary'));
});

test('analyseLine without svg', () => {
    assert.equal(analyseLine('<span class="size-4"></span>').svg, false);
});

test('analyseCss catches a multi-line @apply touched in the middle', () => {
    const postcss = require('postcss');
    const css = '.a {\n    @apply\n    block\n    bg-blue-100;\n}\n.b { @apply p-4; }\n';
    const entries = analyseCss(css, new Set([4]), postcss);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].line, 2);
    assert.deepEqual(entries[0].tokens, ['block', 'bg-blue-100']);
    assert.deepEqual(entries[0].groups, [['block', 'bg-blue-100']]);
});

test('parseDiff reads added lines of several hunks', () => {
    const diff = [
        'diff --git a/x b/x', '--- a/x', '+++ b/x',
        '@@ -3 +3 @@', '-old', '+new',
        '@@ -10,0 +11,2 @@', '+a', '+b',
        '@@ -20,2 +22,0 @@', '-gone', '-gone',
    ].join('\n');
    assert.deepEqual([...parseDiff(diff)], [3, 11, 12]);
});

test('git failures are not mistaken for an untracked file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailwind-lint-'));
    fs.writeFileSync(path.join(dir, 'a.phtml'), 'x\n');
    assert.throws(() => addedLineNumbers(dir, 'a.phtml', 1));
});

test('originalOf maps an override to its original through the configured baselines', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailwind-lint-'));
    fs.mkdirSync(path.join(dir, 'parent/templates'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'parent/templates/a.phtml'), 'x\n');
    const baselines = [{ match: /^theme\/(.+\.phtml)$/, original: 'parent/$1' }];
    assert.equal(originalOf(dir, 'theme/templates/a.phtml', baselines), path.join(dir, 'parent/templates/a.phtml'));
    assert.equal(originalOf(dir, 'theme/templates/b.phtml', baselines), null);
    assert.equal(originalOf(dir, 'other/templates/a.phtml', baselines), null);
});

test('analyseLine leaves PHP alone outside PHP templates', () => {
    assert.ok(analyseLine('<p class="a <?= foo ?>">').tokens.includes('foo'));
    assert.equal(analyseLine('<p class="a <?= foo ?>">', { php: true }).tokens.includes('foo'), false);
});

test('diffFiles returns the lines changed against the original', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailwind-lint-'));
    fs.writeFileSync(path.join(dir, 'original.phtml'), 'a\nb\nc\n');
    fs.writeFileSync(path.join(dir, 'override.phtml'), 'a\nB\nc\nd\n');
    assert.deepEqual([...diffFiles(path.join(dir, 'original.phtml'), path.join(dir, 'override.phtml'), dir)], [2, 4]);
    fs.writeFileSync(path.join(dir, 'same.phtml'), 'a\nb\nc\n');
    assert.deepEqual([...diffFiles(path.join(dir, 'original.phtml'), path.join(dir, 'same.phtml'), dir)], []);
});

test('analyseLine exposes static class groups without PHP or Alpine bindings', () => {
    const result = analyseLine('<div class="flex <?= $a ? \'hidden\' : \'\' ?> p-4" :class="{ \'block\': open }">', { php: true });
    assert.deepEqual(result.staticGroups, [['flex', 'p-4']]);
    assert.deepEqual(result.groups, [['flex', 'hidden', 'p-4'], ['block', 'open']]);
});
