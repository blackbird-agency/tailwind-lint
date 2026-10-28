'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SEPARATORS = new Set([' ', '\t', '\n', '"', "'", '`', '<', '>', '=', ',', '{', '}', '(', ')', ';']);
const CLASS_ATTRIBUTE = /(?:^|\s)(?:x-bind:class|:class|class)\s*=\s*(["'])([\s\S]*?)\1/g;
const PHP_BLOCK = /<\?(?:php|=)?([\s\S]*?)(?:\?>|$)/g;
const STRING_LITERAL = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g;
const JS_LITERAL = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
const PHP_CLASS_VARIABLE = /\$(\w*class\w*)\s*=(?![=>])/gi;
const PHP_CLASS_KEY = /(['"])([^'"\n]*class[^'"\n]*)\1\s*=>/gi;
const MARK = '…';
const GLUE = { tokens: [] };
const OPENERS = new Set(['(', '[', '{']);

function split(text) {
    const tokens = [];
    let depth = 0;
    let current = '';
    let start = 0;
    for (let at = 0; at < text.length; at++) {
        const char = text[at];
        // Brackets always nest; a parenthesis only right after `-` or `/` (v4 `bg-(--color)`, `bg-red/(--alpha)`).
        const opens = char === '[' || (char === '(' && (depth > 0 || /[-/]$/.test(current)));
        const closes = (char === ']' || char === ')') && depth > 0;
        depth += opens - closes;
        if (depth === 0 && !closes && SEPARATORS.has(char)) {
            if (current) tokens.push({ raw: current, start });
            current = '';
            continue;
        }
        if (!current) start = at;
        current += char;
    }
    if (current) tokens.push({ raw: current, start });
    return tokens;
}

const isClassLike = (raw) => /[a-z0-9]/i.test(raw) && !raw.includes('$');

function tokenize(text) {
    return split(text).map((token) => token.raw).filter(isClassLike);
}

function stripPhp(line) {
    return line.replace(PHP_BLOCK, (_, code) => {
        const literals = [...code.matchAll(STRING_LITERAL)].map((match) => match[1] ?? match[2]);
        return ` ${literals.join(' ')} `;
    });
}

function lineLocator(content) {
    const starts = [0];
    for (let at = 0; at < content.length; at++) if (content[at] === '\n') starts.push(at + 1);
    const lineOf = (index) => {
        let low = 0;
        let high = starts.length - 1;
        while (low < high) {
            const middle = (low + high + 1) >> 1;
            if (starts[middle] <= index) low = middle;
            else high = middle - 1;
        }
        return low + 1;
    };
    return { starts, lineOf };
}

function skipString(text, at) {
    const quote = text[at];
    let cursor = at + 1;
    while (cursor < text.length && text[cursor] !== quote) cursor += text[cursor] === '\\' ? 2 : 1;
    return cursor;
}

function topLevel(text, from, test) {
    let depth = 0;
    for (let at = from; at < text.length; at++) {
        const char = text[at];
        if (char === "'" || char === '"') {
            at = skipString(text, at);
            continue;
        }
        if (depth === 0 && test(text, at)) return at;
        if (OPENERS.has(char)) depth++;
        else if (char === ')' || char === ']' || char === '}') depth--;
        if (depth < 0) return at;
    }
    return text.length;
}

function unwrap(expression) {
    let text = expression.trim();
    while (text.startsWith('(') && topLevel(text, 1, () => false) === text.length - 1) text = text.slice(1, -1).trim();
    return text;
}

function literalValue(expression) {
    const match = expression.match(/^(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")$/);
    return match ? match[1] ?? match[2] : null;
}

function outputsOf(expression) {
    const text = unwrap(expression);
    const literal = literalValue(text);
    if (literal !== null) return [literal];
    const coalesce = topLevel(text, 0, (code, at) => code.startsWith('??', at));
    if (coalesce < text.length) return mergeOutputs([text.slice(0, coalesce), text.slice(coalesce + 2)]);
    const question = topLevel(text, 0, (code, at) => code[at] === '?' && code[at + 1] !== '-');
    if (question === text.length) return null;
    const colon = topLevel(text, question + 1, (code, at) => code[at] === ':' && code[at + 1] !== ':' && code[at - 1] !== ':');
    if (colon === text.length) return null;
    return mergeOutputs([text.slice(question + 1, colon), text.slice(colon + 1)]);
}

function mergeOutputs(branches) {
    const outputs = branches.map(outputsOf);
    return outputs.every(Boolean) ? outputs.flat() : null;
}

function phpBlocks(content) {
    return [...content.matchAll(PHP_BLOCK)].map((match) => ({
        start: match.index,
        end: match.index + match[0].length,
        code: match[1],
        codeStart: match.index + match[0].match(/^<\?(?:php|=)?/)[0].length,
        silent: !match[0].startsWith('<?=') && !/\b(?:echo|print|printf|vprintf)\b/.test(match[1]),
    }));
}

function mask(content, blocks) {
    let masked = '';
    let cursor = 0;
    for (const { start, end } of blocks) {
        masked += content.slice(cursor, start) + content.slice(start, end).replace(/[^\n]/g, '\0');
        cursor = end;
    }
    return masked + content.slice(cursor);
}

function neighbour(text, at, step, from = 0, to = text.length) {
    for (let cursor = at; cursor >= from && cursor < to; cursor += step) {
        if (!/\s/.test(text[cursor])) return cursor;
    }
    return -1;
}

function rendering() {
    const built = { text: '', origins: [], owners: [] };
    built.add = (char, origin, owner = null) => {
        built.text += char;
        built.origins.push(origin);
        built.owners.push(owner);
    };
    return built;
}

function classify(built, lineOf) {
    const result = { tokens: [], fragments: [], plain: [] };
    for (const { raw, start } of split(built.text)) {
        const owners = built.owners.slice(start, start + raw.length).filter(Boolean);
        const token = { raw, line: lineOf(built.origins[start]), index: built.origins[start] };
        if (!owners.length) {
            if (!isClassLike(raw)) continue;
            result.tokens.push(token);
            result.plain.push(token);
        } else if ([...raw].every((char) => char === MARK)) {
            for (const owner of new Set(owners)) result.tokens.push(...owner.tokens);
        } else if (isClassLike(raw)) {
            result.fragments.push(token);
        }
    }
    return result;
}

function enclosingOpeners(code) {
    const openers = new Map();
    const stack = [];
    for (let at = 0; at < code.length; at++) {
        const char = code[at];
        if (char === "'" || char === '"' || char === '`') {
            openers.set(at, stack.at(-1) ?? -1);
            at = skipString(code, at);
        } else if (OPENERS.has(char)) {
            stack.push(at);
        } else if (char === ')' || char === ']' || char === '}') {
            stack.pop();
        }
    }
    return openers;
}

const isOperator = (text, at) => at >= 0 && /^[=!]=$/.test(text.slice(at, at + 2));

function isOperand(text, before, after) {
    return isOperator(text, before - 1) || isOperator(text, after) || (after >= 0 && text.startsWith('=>', after));
}

function isCallArgument(code, opener, before, after) {
    if (code[opener] !== '(' || !'(,'.includes(code[before]) || !'),'.includes(code[after] ?? '')) return false;
    const name = code.slice(0, opener).match(/(\w+)\s*$/)?.[1];
    return Boolean(name) && name !== 'escapeHtmlAttr';
}

function phpLiterals(code, codeStart, lineOf) {
    const result = { tokens: [], fragments: [] };
    const openers = enclosingOpeners(code);
    for (const match of code.matchAll(STRING_LITERAL)) {
        const built = rendering();
        const value = match[1] ?? match[2];
        const valueStart = codeStart + match.index + 1;
        const before = neighbour(code, match.index - 1, -1);
        const after = neighbour(code, match.index + match[0].length, 1);
        const subscript = code[before] === '[' && code[after] === ']' && /[\w\])}]/.test(code[neighbour(code, before - 1, -1)] ?? '');
        if (subscript || isOperand(code, before, after) || isCallArgument(code, openers.get(match.index) ?? -1, before, after)) continue;
        if (code[before] === '.') built.add(MARK, valueStart, GLUE);
        for (let at = 0; at < value.length; at++) built.add(value[at], valueStart + at);
        if (code[after] === '.') built.add(MARK, valueStart + value.length, GLUE);
        const { tokens, fragments } = classify(built, lineOf);
        result.tokens.push(...tokens);
        result.fragments.push(...fragments);
    }
    return result;
}

function blockSpan(block, lineOf) {
    if (block.silent) return { ...block, tokens: [], fragments: [], glueLeft: false, glueRight: false };
    const outputs = outputsOf(block.code.replace(/^\s*echo\s+/, '').replace(/;\s*$/, ''));
    return {
        ...block,
        ...phpLiterals(block.code, block.codeStart, lineOf),
        glueLeft: !outputs?.every((output) => /^(\s|$)/.test(output)),
        glueRight: !outputs?.every((output) => /(^|\s)$/.test(output)),
    };
}

function addSpan(built, span) {
    if (!span.glueLeft) built.add(' ', span.start);
    built.add(MARK, span.start, span);
    if (!span.glueRight) built.add(' ', span.start);
}

function group(kind, found, staticTokens = []) {
    const byIndex = (list) => list.sort((a, b) => a.index - b.index);
    return { kind, tokens: byIndex(found.tokens), staticTokens: byIndex(staticTokens), fragments: byIndex(found.fragments) };
}

function classAttribute(content, start, end, spans, lineOf) {
    const built = rendering();
    let cursor = start;
    for (const span of spans.filter((candidate) => candidate.start >= start && candidate.end <= end)) {
        for (; cursor < span.start; cursor++) built.add(content[cursor], cursor);
        addSpan(built, span);
        cursor = span.end;
    }
    for (; cursor < end; cursor++) built.add(content[cursor], cursor);
    const found = classify(built, lineOf);
    // Classes inside PHP control flow may be `if` / `else` alternatives.
    const silent = spans.filter((span) => span.silent && span.start >= start && span.end <= end);
    const always = silent.length
        ? found.plain.filter((token) => token.index < silent[0].start || token.index >= silent.at(-1).end)
        : found.plain;
    return group('class', found, always);
}

function binding(content, masked, start, end, spans, lineOf) {
    const found = { tokens: [], fragments: [] };
    const spanAt = new Map(spans.map((span) => [span.start, span]));
    const value = masked.slice(start, end);
    const openers = enclosingOpeners(value);
    for (const match of value.matchAll(JS_LITERAL)) {
        const from = start + match.index;
        const to = from + match[0].length;
        const before = neighbour(masked, from - 1, -1, start, end);
        const after = neighbour(masked, to, 1, start, end);
        if (isOperand(masked, before, after)) continue;
        if (isCallArgument(value, openers.get(match.index) ?? -1, before - start, after - start)) continue;
        const built = rendering();
        if (masked[before] === '+') built.add(MARK, from, GLUE);
        for (let at = from + 1; at < to - 1; at++) {
            const span = spanAt.get(at);
            if (span) {
                addSpan(built, span);
                at = span.end - 1;
            } else if (match[0][0] === '`' && masked.startsWith('${', at)) {
                built.add(MARK, at, GLUE);
                at = topLevel(masked, at + 2, (text, index) => text[index] === '}');
            } else {
                built.add(content[at], at);
            }
        }
        if (masked[after] === '+') built.add(MARK, to - 1, GLUE);
        const { tokens, fragments } = classify(built, lineOf);
        found.tokens.push(...tokens);
        found.fragments.push(...fragments);
    }
    return group('binding', found);
}

function expressionEnd(code, from, stops) {
    return topLevel(code, from, (text, at) => stops.includes(text[at]));
}

function phpVariables(content, blocks, lineOf) {
    const groups = [];
    const read = (block, from, to) => {
        const expression = block.code.slice(from, to);
        const found = phpLiterals(expression, block.codeStart + from, lineOf);
        const single = literalValue(expression.trim()) !== null;
        groups.push({ at: block.codeStart + from, ...group('php', found, single ? [...found.tokens] : []) });
    };
    for (const block of blocks) {
        for (const match of block.code.matchAll(PHP_CLASS_VARIABLE)) {
            const from = match.index + match[0].length;
            read(block, from, expressionEnd(block.code, from, [';']));
        }
        for (const match of block.code.matchAll(PHP_CLASS_KEY)) {
            const from = match.index + match[0].length;
            const to = expressionEnd(block.code, from, [',', ';']);
            if (!/^(?::|x-bind:)/.test(match[2])) {
                read(block, from, to);
                continue;
            }
            // `':class' => "{ 'rotate-180': open }"`: the PHP string is an Alpine expression, read like a binding.
            const literal = block.code.slice(from, to).match(/^\s*(['"])[\s\S]*\1\s*$/);
            if (!literal || literalValue(literal[0].trim()) === null) continue;
            const start = block.codeStart + from + literal[0].indexOf(literal[1]) + 1;
            const end = block.codeStart + from + literal[0].lastIndexOf(literal[1]);
            groups.push({ at: start, ...binding(content, content, start, end, [], lineOf) });
        }
    }
    return groups;
}

function looseTokensOf(content, starts, php) {
    return content.split('\n').flatMap((text, row) => {
        let cursor = 0;
        return tokenize(php ? stripPhp(text) : text).map((raw) => {
            const found = text.indexOf(raw, cursor);
            if (found >= 0) cursor = found + raw.length;
            return { raw, line: row + 1, index: starts[row] + (found >= 0 ? found : cursor) };
        });
    });
}

function analyseTemplate(content, { php = false } = {}) {
    const { starts, lineOf } = lineLocator(content);
    const blocks = php ? phpBlocks(content) : [];
    const spans = blocks.map((block) => blockSpan(block, lineOf));
    const masked = mask(content, blocks);
    const groups = phpVariables(content, blocks, lineOf);
    for (const match of masked.matchAll(CLASS_ATTRIBUTE)) {
        const end = match.index + match[0].length - 1;
        const start = end - match[2].length;
        groups.push({
            at: match.index,
            ...(/^\s*class/.test(match[0])
                ? classAttribute(content, start, end, spans, lineOf)
                : binding(content, masked, start, end, spans, lineOf)),
        });
    }
    return {
        looseTokens: looseTokensOf(content, starts, php),
        groups: groups.sort((a, b) => a.at - b.at).map(({ at, ...rest }) => rest),
    };
}

function analyseCss(content, addedLines, postcss) {
    const groups = [];
    postcss.parse(content).walkAtRules('apply', (rule) => {
        const start = rule.source.start.line;
        const end = rule.source.end?.line ?? start;
        const lines = Array.from({ length: end - start + 1 }, (_, index) => start + index);
        if (!lines.some((line) => addedLines.has(line))) return;
        const offset = rule.source.start.offset ?? 0;
        const tokens = split(rule.params.replace(/!important/g, ''))
            .filter(({ raw }) => isClassLike(raw))
            .map(({ raw, start: at }) => ({ raw, line: start, index: offset + at }));
        groups.push({ kind: 'apply', tokens, staticTokens: [...tokens], fragments: [] });
    });
    return { looseTokens: groups.flatMap((entry) => entry.tokens), groups };
}

function parseDiff(diff) {
    const lines = new Set();
    let current = 0;
    for (const row of diff.split('\n')) {
        const hunk = row.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (hunk) {
            current = Number(hunk[1]);
            continue;
        }
        if (row.startsWith('+++')) continue;
        if (row.startsWith('+')) {
            lines.add(current);
            current++;
        }
    }
    return lines;
}

function originalOf(root, file, baselines) {
    for (const { match, original } of baselines) {
        const found = file.match(match);
        if (!found) continue;
        const candidate = path.resolve(root, original.replace(/\$(\d)/g, (_, index) => found[index] ?? ''));
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

function diffFiles(original, file, cwd) {
    try {
        execFileSync('git', ['diff', '--no-index', '-U0', '--no-color', original, file], { cwd, encoding: 'utf8' });
        return new Set();
    } catch (error) {
        if (error.status === 1) return parseDiff(error.stdout);
        throw error;
    }
}

function addedLineNumbers(root, file, lineCount, { all = false, baselines = [] } = {}) {
    const every = () => new Set(Array.from({ length: lineCount }, (_, index) => index + 1));
    if (all) return every();
    try {
        execFileSync('git', ['ls-files', '--error-unmatch', file], { cwd: root, stdio: 'pipe' });
    } catch (error) {
        if (error.status !== 1) throw error;
        const original = originalOf(root, file, baselines);
        return original ? diffFiles(original, path.resolve(root, file), root) : every();
    }
    return parseDiff(execFileSync('git', ['diff', '-U0', '--no-color', 'HEAD', '--', file], { cwd: root, encoding: 'utf8' }));
}

module.exports = { tokenize, stripPhp, analyseTemplate, analyseCss, parseDiff, addedLineNumbers, originalOf, diffFiles };
