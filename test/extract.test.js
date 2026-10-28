'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { tokenize, stripPhp, analyseTemplate, analyseCss, parseDiff, addedLineNumbers, originalOf, diffFiles } = require('../src/extract');

const lines = (tokens) => tokens.map((t) => `${t.line}:${t.raw}`);

test('tokenize respects brackets', () => {
    assert.deepEqual(tokenize('class="bg-[rgb(1,2,3)] w-4"'), ['class', 'bg-[rgb(1,2,3)]', 'w-4']);
});

test('stripPhp keeps string literals only', () => {
    const text = stripPhp('<div class="p-4 <?= $a ? \'bg-red\' : "bg-blue-100" ?> m-2">');
    assert.deepEqual(tokenize(text).filter((t) => t !== 'div' && t !== 'class'), ['p-4', 'bg-red', 'bg-blue-100', 'm-2']);
});

test('analyseCss catches a multi-line @apply touched in the middle', () => {
    const postcss = require('postcss');
    const css = '.a {\n    @apply\n    block\n    bg-blue-100;\n}\n.b { @apply p-4; }\n';
    const { looseTokens, groups } = analyseCss(css, new Set([4]), postcss);
    assert.deepEqual(lines(looseTokens), ['2:block', '2:bg-blue-100']);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].kind, 'apply');
    assert.deepEqual(lines(groups[0].tokens), ['2:block', '2:bg-blue-100']);
    assert.deepEqual(lines(groups[0].staticTokens), ['2:block', '2:bg-blue-100']);
    assert.deepEqual(groups[0].fragments, []);
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

test('analyseTemplate leaves PHP alone outside PHP templates', () => {
    const raws = (options) => analyseTemplate('<p class="a <?= foo ?>">', options).looseTokens.map((t) => t.raw);
    assert.ok(raws({ php: false }).includes('foo'));
    assert.equal(raws({ php: true }).includes('foo'), false);
});

test('diffFiles returns the lines changed against the original', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailwind-lint-'));
    fs.writeFileSync(path.join(dir, 'original.phtml'), 'a\nb\nc\n');
    fs.writeFileSync(path.join(dir, 'override.phtml'), 'a\nB\nc\nd\n');
    assert.deepEqual([...diffFiles(path.join(dir, 'original.phtml'), path.join(dir, 'override.phtml'), dir)], [2, 4]);
    fs.writeFileSync(path.join(dir, 'same.phtml'), 'a\nb\nc\n');
    assert.deepEqual([...diffFiles(path.join(dir, 'original.phtml'), path.join(dir, 'same.phtml'), dir)], []);
});

test('analyseTemplate reads a class attribute spread over several lines', () => {
    const { groups } = analyseTemplate('<div\n  class="p-4\n    md:p-6 p-4"\n>', { php: true });
    assert.deepEqual(lines(groups[0].tokens), ['2:p-4', '3:md:p-6', '3:p-4']);
    assert.deepEqual(lines(groups[0].staticTokens), ['2:p-4', '3:md:p-6', '3:p-4']);
});

test('analyseTemplate keeps only string literals of an Alpine binding', () => {
    const { groups } = analyseTemplate('<a :class="{\n  \'w-4 h-4\': open,\n  \'block\': !open }">', { php: true });
    assert.equal(groups[0].kind, 'binding');
    assert.deepEqual(lines(groups[0].tokens), ['2:w-4', '2:h-4', '3:block']);
    assert.deepEqual(groups[0].staticTokens, []);
});

test('analyseTemplate ignores literals compared in a binding', () => {
    const src = `<a :class="{ 'font-bold': activeTab === '<?= $escaper->escapeJs($name) ?>' }">`;
    assert.deepEqual(analyseTemplate(src, { php: true }).groups[0].tokens.map((t) => t.raw), ['font-bold']);
});

test('analyseTemplate turns a value glued to PHP into a fragment', () => {
    const { groups } = analyseTemplate('<i class="p-4 bg-<?= $c ?>-500 badge-<?= $s ?>">', { php: true });
    assert.deepEqual(groups[0].tokens.map((t) => t.raw), ['p-4']);
    assert.deepEqual(groups[0].fragments.map((t) => t.raw), ['bg-…-500', 'badge-…']);
});

test('analyseTemplate does not glue across a PHP output that always starts with a space', () => {
    const { groups } = analyseTemplate(`<i class="field-name<?= $r ? ' required' : '' ?>">`, { php: true });
    assert.deepEqual(groups[0].tokens.map((t) => t.raw), ['field-name', 'required']);
    assert.deepEqual(groups[0].fragments, []);
    assert.deepEqual(groups[0].staticTokens.map((t) => t.raw), ['field-name']);
});

test('analyseTemplate glues an Alpine concatenation', () => {
    const { groups } = analyseTemplate(`<i :class="'bg-' + color">`, { php: true });
    assert.deepEqual(groups[0].fragments.map((t) => t.raw), ['bg-…']);
});

test('analyseTemplate reads PHP variables and keys named after class', () => {
    const src = [
        '<?php',
        "$thumbnailClass = 'shrink-0 max-xl:col-start-1';",
        "$cssClasses = $block->getCssClass() ?? 'bg-black text-white';",
        '$badgeClass = match ($s) {',
        "    1 => 'bg-red',",
        "    default => 'bg-gray',",
        '};',
        "$attrs = ['class' => 'p-4', 'title' => 'Not classes'];",
        "$label = __('Add to cart');",
        "$dyn = 'x'; $iconClass = 'size-' . $size;",
        '?>',
    ].join('\n');
    const groups = analyseTemplate(src, { php: true }).groups;
    assert.deepEqual(groups.map((g) => [g.kind, g.tokens.map((t) => `${t.line}:${t.raw}`), g.staticTokens.length]), [
        ['php', ['2:shrink-0', '2:max-xl:col-start-1'], 2],
        ['php', ['3:bg-black', '3:text-white'], 0],
        ['php', ['5:bg-red', '6:bg-gray'], 0],
        ['php', ['8:p-4'], 1],
        ['php', [], 0],
    ]);
    assert.deepEqual(groups[4].fragments.map((t) => t.raw), ['size-…']);
});

test('analyseTemplate keeps loose tokens line by line', () => {
    const { looseTokens } = analyseTemplate("<?= $icons->chevronRightHtml('bg-blue-100') ?>\n<p>", { php: true });
    assert.ok(looseTokens.some((t) => t.raw === 'bg-blue-100' && t.line === 1));
});

test('analyseTemplate tolerates a concatenated literal that ends with a space', () => {
    const { groups } = analyseTemplate(`<?php $iconClass = 'w-4 ' . $size; ?><i :class="'p-4 ' + extra">`, { php: true });
    assert.deepEqual(groups.map((g) => g.tokens.map((t) => t.raw)), [['w-4'], ['p-4']]);
    assert.deepEqual(groups.flatMap((g) => g.fragments), []);
});

test('analyseTemplate ignores array subscripts in PHP expressions', () => {
    const src = "<?php $badgeClass = match ($item['status']) { 1 => 'badge-warning', default => ['p-4'] }; ?>";
    assert.deepEqual(analyseTemplate(src, { php: true }).groups[0].tokens.map((t) => t.raw), ['badge-warning', 'p-4']);
});

test('analyseTemplate ignores literals passed as call arguments, except to escapeHtmlAttr', () => {
    const raws = (src) => analyseTemplate(src, { php: true }).groups[0].tokens.map((t) => t.raw);
    assert.deepEqual(raws(`<i class="form-select <?= $escaper->escapeHtmlAttr($block->getAttributeValidationClass('prefix')) ?>">`), ['form-select']);
    assert.deepEqual(raws(`<i class="<?= $escaper->escapeHtmlAttr('p-4 m-2') ?>">`), ['p-4', 'm-2']);
    assert.deepEqual(raws(`<?php $labelClasses = (string) ($block->getData('label_class') ?: 'text-xs text-gray'); ?>`), ['text-xs', 'text-gray']);
});

test('analyseTemplate ignores literals passed as call arguments in a binding', () => {
    const { groups } = analyseTemplate(`<a :class="{'a': tabs.includes('foo'), 'b': $store.x.get('bar')}">`, { php: true });
    assert.deepEqual(groups[0].tokens.map((t) => t.raw), ['a', 'b']);
});

test('analyseTemplate reads x-bind:class and ignores literals compared with !=', () => {
    const { groups } = analyseTemplate(`<a x-bind:class="{ 'hidden': tab != 'one' }">`, { php: true });
    assert.equal(groups[0].kind, 'binding');
    assert.deepEqual(groups[0].tokens.map((t) => t.raw), ['hidden']);
});

test('analyseTemplate never glues to a PHP block without output', () => {
    const active = analyseTemplate('<a class="btn<?php if ($x): ?> active<?php endif ?>">', { php: true }).groups[0];
    assert.deepEqual(active.tokens.map((t) => t.raw), ['btn', 'active']);
    assert.deepEqual(active.fragments, []);
    const hidden = analyseTemplate("<a class=\"text-sm<?php if ($x === 'y'): ?> hidden<?php endif; ?>\">", { php: true }).groups[0];
    assert.deepEqual(hidden.tokens.map((t) => t.raw), ['text-sm', 'hidden']);
    assert.deepEqual(hidden.fragments, []);
});

test('analyseTemplate reads PHP :class / x-bind:class keys as Alpine expressions', () => {
    const tokens = (key, value) => analyseTemplate(`<?php $attrs = ['${key}' => ${value}, 'title' => 'x']; ?>`, { php: true })
        .groups.flatMap((g) => g.tokens.map((t) => t.raw));
    assert.deepEqual(tokens(':class', "'chevronClass'"), []);
    assert.deepEqual(tokens(':class', `"{ 'rotate-180': menuOpen }"`), ['rotate-180']);
    assert.deepEqual(tokens('x-bind:class', `"open ? 'block' : 'hidden'"`), ['block', 'hidden']);
    assert.deepEqual(tokens(':class', `"{ 'hidden': tab != 'one' }"`), ['hidden']);
    assert.deepEqual(tokens('class', "'p-4'"), ['p-4']);
});

test('analyseTemplate keeps v4 parentheses inside a class', () => {
    const { groups, looseTokens } = analyseTemplate('<i class="bg-(--color) p-4! supports-(display:grid):grid bg-red/(--alpha)"><?= foo(\'x\') ?>', { php: true });
    const expected = ['bg-(--color)', 'p-4!', 'supports-(display:grid):grid', 'bg-red/(--alpha)'];
    assert.deepEqual(groups[0].tokens.map((t) => t.raw), expected);
    assert.deepEqual(looseTokens.map((t) => t.raw).filter((raw) => expected.includes(raw)), expected);
});

test('analyseTemplate ignores PHP literals that are compared or used as keys', () => {
    const raws = (src) => analyseTemplate(src, { php: true }).groups.flatMap((g) => g.tokens.map((t) => t.raw));
    assert.deepEqual(raws(`<i class="<?= $type === '0' ? 'mt-8' : 'mt-16' ?> <?= $t != 'a' ? 'p-4' : '' ?>">`), ['mt-8', 'mt-16', 'p-4']);
    assert.deepEqual(raws(`<?php $badgeClass = match ($s) { 'pending' => 'bg-yellow', default => 'bg-gray' }; ?>`), ['bg-yellow', 'bg-gray']);
});

test('analyseTemplate never treats classes inside PHP control flow as always applied', () => {
    const { groups } = analyseTemplate('<i class="p-4 <?php if ($a): ?>block<?php else: ?>hidden<?php endif ?> m-2">', { php: true });
    assert.deepEqual(groups[0].tokens.map((t) => t.raw), ['p-4', 'block', 'hidden', 'm-2']);
    assert.deepEqual(groups[0].staticTokens.map((t) => t.raw), ['p-4', 'm-2']);
});
