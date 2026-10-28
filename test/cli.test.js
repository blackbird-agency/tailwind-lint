'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const directory = path.join(__dirname, 'fixtures/project');
const configFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tailwind-lint-')), 'config.json');
fs.writeFileSync(configFile, JSON.stringify({
    sites: [{ name: 'fixture', config: 'tailwind.config.js', css: 'styles.css' }],
    include: ['**/*.phtml', '**/*.css'],
}));

const run = (...args) => spawnSync(process.execPath, [path.join(__dirname, '../bin/lint.js'), '--config', configFile, ...args], { cwd: directory, encoding: 'utf8' });

test('cli: exit 0 when clean, 2 with violations on stdout, 1 on errors', () => {
    assert.equal(run('--all', 'templates/good.phtml').status, 0);
    const bad = run('--all', 'templates/bad.phtml');
    assert.equal(bad.status, 2);
    assert.match(bad.stdout, /^templates\/bad\.phtml:9 \[no-unknown-class\] `flx`/m);
    const missing = run('templates/missing.phtml');
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /templates\/missing\.phtml does not exist/);
    const option = run('--al', 'templates/good.phtml');
    assert.equal(option.status, 1);
    assert.equal(option.stderr, 'tailwind-lint: unknown option --al\n');
    assert.equal(run().status, 0);
});

test('cli: without --all, only the lines added since HEAD are reported', () => {
    const repo = fs.mkdtempSync(path.join(__dirname, 'fixtures', 'git-'));
    try {
        const git = (...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo, encoding: 'utf8' });
        const config = path.join(repo, 'config.json');
        fs.writeFileSync(config, JSON.stringify({ sites: [], include: ['**/*.phtml'] }));
        fs.writeFileSync(path.join(repo, 'a.phtml'), '<i class="p-4 p-4">\n');
        git('init', '-q');
        git('add', 'a.phtml');
        git('commit', '-qm', 'init');
        fs.appendFileSync(path.join(repo, 'a.phtml'), '<i class="m-2 m-2">\n');
        const result = spawnSync(process.execPath, [path.join(__dirname, '../bin/lint.js'), '--config', config, 'a.phtml'], { cwd: repo, encoding: 'utf8' });
        assert.equal(result.status, 2);
        assert.equal(result.stdout, 'a.phtml:2 [no-duplicate-classes] `m-2` is duplicated\n');
    } finally {
        fs.rmSync(repo, { recursive: true, force: true });
    }
});
