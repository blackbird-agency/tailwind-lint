'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseToken } = require('../src/token');
const fakeSite = require('./helpers/fake-site');
const shade = require('../src/rules/no-default-palette-shade');
const unknown = require('../src/rules/unknown-scale-value');
const arbitrary = require('../src/rules/no-arbitrary-on-scale');
const redundant = require('../src/rules/redundant-with-component');
const unknownClass = require('../src/rules/no-unknown-class');
const removed = require('../src/rules/no-removed-v3-class');
const { analyseTemplate } = require('../src/extract');
const { parseEntry } = require('../src/lint');
const conflicting = require('../src/rules/no-conflicting-classes');
const shorthand = require('../src/rules/enforces-shorthand');

const site = fakeSite();
const entry = (tokens, groups = [tokens], staticGroups = groups) => ({
    tokens: tokens.map(parseToken),
    groups: groups.map((g) => g.map(parseToken)),
    staticGroups: staticGroups.map((g) => g.map(parseToken)),
});
const run = (rule, tokens, groups, staticGroups) => rule.check(entry(tokens, groups, staticGroups), site);
const flagged = (rule, tokens, groups, staticGroups) => run(rule, tokens, groups, staticGroups).map((v) => v.token.raw);

test('no-default-palette-shade', () => {
    assert.deepEqual(flagged(shade, ['bg-blue-100', 'hover:text-gray-200/50', 'border-t-red-500']), ['bg-blue-100', 'hover:text-gray-200/50', 'border-t-red-500']);
    assert.deepEqual(flagged(shade, ['bg-primary/25', 'hover:bg-blue-dark', 'text-secondary', 'border-2', 'ring-offset-2', 'text-xl']), []);
});

test('unknown-scale-value', () => {
    assert.deepEqual(flagged(unknown, ['w-122', 'gap-31', 'text-9xl', 'rounded-3xl', '-mt-7']), ['w-122', 'gap-31', 'text-9xl', 'rounded-3xl', '-mt-7']);
    assert.deepEqual(flagged(unknown, ['w-1/2', 'w-full', 'w-screen', '-mt-4', 'w-4.5', 'text-center', 'text-primary', 'text-xl', 'rounded', 'rounded-full', 'w-[488px]', 'p-px']), []);
});

test('no-arbitrary-on-scale suggests the key, never a font size that also sets line-height', () => {
    const result = run(arbitrary, ['w-[72px]', 'text-[18px]', '-mt-[1rem]', 'w-[73px]', 'w-[50%]', 'bg-[#fff]', 'text-[24px]']);
    assert.deepEqual(result.map((v) => v.token.raw), ['w-[72px]', 'text-[18px]', '-mt-[1rem]']);
    assert.match(result[0].message, /`w-18`/);
    assert.match(result[1].message, /`text-lg`/);
    assert.match(result[2].message, /`-mt-4`/);
});

test('redundant-with-component', () => {
    assert.deepEqual(flagged(redundant, ['btn', 'btn-primary', 'rounded-full', 'text-white']), ['btn', 'rounded-full']);
    assert.deepEqual(flagged(redundant, ['title-font', 'uppercase']), ['uppercase']);
    assert.deepEqual(flagged(redundant, ['font-title', 'uppercase']), []);
    assert.deepEqual(flagged(redundant, ['btn-primary', 'md:rounded-full']), []);
    assert.deepEqual(flagged(redundant, ['btn-primary', 'rounded-full'], [['btn-primary'], ['rounded-full']]), []);
});

test('no-conflicting-classes flags same properties with different values', () => {
    const result = run(conflicting, ['p-4', 'p-6']);
    assert.deepEqual(result.map((v) => v.token.raw), ['p-6']);
    assert.match(result[0].message, /`p-6` conflicts with `p-4`: both set `padding`/);
    assert.deepEqual(flagged(conflicting, ['block', 'hidden']), ['hidden']);
    assert.deepEqual(flagged(conflicting, ['md:translate-x-4', 'md:translate-x-6']), ['md:translate-x-6']);
});

test('no-conflicting-classes lets overrides, responsive and unknown classes pass', () => {
    assert.deepEqual(flagged(conflicting, ['p-4', 'pt-2']), []);
    assert.deepEqual(flagged(conflicting, ['text-xl', 'leading-none']), []);
    assert.deepEqual(flagged(conflicting, ['bg-primary', 'bg-opacity-50']), []);
    assert.deepEqual(flagged(conflicting, ['translate-x-4', 'translate-y-4']), []);
    assert.deepEqual(flagged(conflicting, ['p-4', 'md:p-6']), []);
    assert.deepEqual(flagged(conflicting, ['hidden', 'md:block']), []);
    assert.deepEqual(flagged(conflicting, ['p-4', 'p-4']), []);
    assert.deepEqual(flagged(conflicting, ['p-4', 'p-6'], [['p-4'], ['p-6']]), []);
    assert.deepEqual(flagged(conflicting, ['js-hook', 'other-hook']), []);
});

test('no-conflicting-classes ignores conditional classes', () => {
    assert.deepEqual(flagged(conflicting, ['text-xl', 'block', 'hidden'], [['block', 'hidden']], []), []);
});

test('no-unknown-class', () => {
    assert.deepEqual(flagged(unknownClass, [], [['p-4', 'flx', 'btn', 'md:btn', 'group', 'group/item', 'hovr:p-4']]), ['flx', 'md:btn', 'hovr:p-4']);
});

test('no-unknown-class reports Tailwind fragments only, with a version-specific hint', () => {
    const { groups } = analyseTemplate('<i class="bg-<?= $c ?>-500 md:text-<?= $s ?> badge-<?= $s ?>">', { php: true });
    const result = unknownClass.check(parseEntry({ looseTokens: [], groups }), site);
    assert.deepEqual(result.map((v) => v.token.raw), ['bg-…-500', 'md:text-…']);
    assert.match(result[0].message, /built at runtime: Tailwind cannot generate it, use a CSS variable \(`bg-\[--color\]`/);
    const v4 = unknownClass.check(parseEntry({ looseTokens: [], groups }), { ...site, version: 4 });
    assert.match(v4[0].message, /\(`bg-\(--color\)` \+ `style="--color: …"`\)/);
});

test('no-removed-v3-class only on v4, with the exact fix', () => {
    const v4 = { ...site, version: 4, generates: () => false };
    const result = removed.check(entry([], [['md:flex-grow', '!flex-shrink-0', 'bg-opacity-50', 'grow']]), v4);
    assert.deepEqual(result.map((v) => v.message), [
        '`md:flex-grow` was removed in Tailwind v4: use `md:grow`',
        '`!flex-shrink-0` was removed in Tailwind v4: use `!shrink-0`',
        '`bg-opacity-50` was removed in Tailwind v4: use an opacity modifier (`bg-black/50`)',
    ]);
    assert.deepEqual(removed.check(entry([], [['flex-grow']]), { ...site, version: 3 }), []);
});

test('no-removed-v3-class ignores deprecated aliases that Tailwind v4 still generates', () => {
    const groups = [['flex-grow', 'overflow-ellipsis']];
    const generating = { ...site, version: 4, generates: (raw) => raw === 'flex-grow' };
    assert.deepEqual(removed.check(entry([], groups), generating).map((v) => v.token.raw), ['overflow-ellipsis']);
    const alias = removed.check(entry([], [['flex-grow']]), { ...site, version: 4, generates: () => false });
    assert.equal(alias[0].message, '`flex-grow` was removed in Tailwind v4: use `grow`');
});

test('redundant-with-component never reports a token as applied by itself', () => {
    const selfApplied = { closure: (raw) => (raw === 'bg-white' ? new Set(['bg-white']) : null) };
    assert.deepEqual(redundant.check(entry(['bg-white', 'p-4', 'bg-white']), selfApplied), []);
});

test('no-unknown-class reads a fragment like a class: important, negative and bracketed variants', () => {
    const { groups } = analyseTemplate('<i class="!bg-<?= $c ?> -mt-<?= $n ?> [&:hover]:bg-<?= $c ?> bg-[color:<?= $c ?>] !badge-<?= $s ?>">', { php: true });
    const result = unknownClass.check(parseEntry({ looseTokens: [], groups }), site);
    assert.deepEqual(result.map((v) => v.token.raw), ['!bg-…', '-mt-…', '[&:hover]:bg-…', 'bg-[color:…]']);
});

test('no-unknown-class accepts declared classes that start with a dash', () => {
    const declaring = { ...site, declares: (name) => name === '--dashed' };
    assert.deepEqual(flagged(unknownClass, [], [['--dashed', '-dashed']]).length, 2);
    assert.deepEqual(unknownClass.check(entry([], [['--dashed', '-dashed']]), declaring).map((v) => v.token.raw), ['-dashed']);
});

test('no-removed-v3-class flags the v3 variable shorthand on v4 only', () => {
    const v4 = { ...site, version: 4, generates: () => true };
    const result = removed.check(entry([], [['bg-[--color]', 'md:w-[--size]!', 'bg-(--color)', '[--x:1px]']]), v4);
    assert.deepEqual(result.map((v) => v.message), [
        '`bg-[--color]` is the v3 CSS variable shorthand, invalid in Tailwind v4: use `bg-(--color)`',
        '`md:w-[--size]!` is the v3 CSS variable shorthand, invalid in Tailwind v4: use `md:w-(--size)!`',
    ]);
    assert.deepEqual(removed.check(entry([], [['bg-[--color]']]), site), []);
});

test('unknown-scale-value trusts what Tailwind generates', () => {
    const generating = { ...site, generates: (raw) => raw === 'leading-tight' };
    assert.deepEqual(unknown.check(entry(['leading-tight', 'leading-snug']), generating).map((v) => v.token.raw), ['leading-snug']);
});

test('enforces-shorthand replaces the longest set of matching classes', () => {
    const all = { ...site, generates: () => true };
    const check = (tokens) => shorthand.check(entry(tokens), all).map((v) => v.message);
    assert.deepEqual(check(['pt-4', 'pr-4', 'pb-4', 'pl-4']), ['`pt-4` + `pr-4` + `pb-4` + `pl-4`: use `p-4`']);
    assert.deepEqual(check(['md:pl-2', 'md:pr-2', 'pt-1', 'pb-1']), ['`md:pl-2` + `md:pr-2`: use `md:px-2`', '`pt-1` + `pb-1`: use `py-1`']);
    assert.deepEqual(check(['-mt-4', '-mb-4']), ['`-mt-4` + `-mb-4`: use `-my-4`']);
    assert.deepEqual(check(['w-11', 'h-11']), ['`w-11` + `h-11`: use `size-11`']);
    assert.deepEqual(check(['rounded-t', 'rounded-b']), ['`rounded-t` + `rounded-b`: use `rounded`']);
    assert.deepEqual(check(['border-t-red/50', 'border-b-red/50']), ['`border-t-red/50` + `border-b-red/50`: use `border-y-red/50`']);
    assert.deepEqual(check(['top-0', 'right-0', 'bottom-0', 'left-0']), ['`top-0` + `right-0` + `bottom-0` + `left-0`: use `inset-0`']);
    assert.deepEqual(check(['overflow-x-hidden', 'overflow-y-hidden', 'gap-x-2!', 'gap-y-2!']), [
        '`gap-x-2!` + `gap-y-2!`: use `gap-2!`',
        '`overflow-x-hidden` + `overflow-y-hidden`: use `overflow-hidden`',
    ]);
});

test('enforces-shorthand needs the same variants and value, and a shorthand the site generates', () => {
    const all = { ...site, generates: () => true };
    const flaggedBy = (tokens, target = all, groups = [tokens]) => shorthand.check(entry(tokens, groups), target).map((v) => v.token.raw);
    assert.deepEqual(flaggedBy(['md:w-11', 'h-11']), []);
    assert.deepEqual(flaggedBy(['w-11', 'h-12']), []);
    assert.deepEqual(flaggedBy(['pl-4', '!pr-4']), []);
    assert.deepEqual(flaggedBy(['mt-4', '-mb-4']), []);
    assert.deepEqual(flaggedBy(['w-11', 'h-11'], all, [['w-11'], ['h-11']]), []);
    const v3 = { ...site, generates: (raw) => raw !== 'translate-4' && raw !== 'size-screen' };
    assert.deepEqual(flaggedBy(['translate-x-4', 'translate-y-4'], v3), []);
    assert.deepEqual(flaggedBy(['w-screen', 'h-screen'], v3), []);
});

test('enforces-shorthand asks the site to load the shorthands it may propose', () => {
    assert.deepEqual(shorthand.candidates(entry(['w-4', 'h-4', 'pl-2', 'pr-2', 'p-1'])), ['px-2', 'size-4']);
});
