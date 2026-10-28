#!/usr/bin/env node
'use strict';

const { loadConfig } = require('../src/config');
const { loadSites } = require('../src/sites');
const { lintFile } = require('../src/lint');
const { format } = require('../src/report');

function parseArguments(argv) {
    const options = { all: false, config: 'tailwind-lint.config.json', files: [] };
    for (let index = 0; index < argv.length; index++) {
        const argument = argv[index];
        if (argument === '--all') options.all = true;
        else if (argument === '--config' && index + 1 < argv.length) options.config = argv[++index];
        else if (argument.startsWith('--')) throw new Error(`tailwind-lint: unknown option ${argument}`);
        else options.files.push(argument);
    }
    return options;
}

async function main(argv) {
    const options = parseArguments(argv);
    if (!options.files.length) return 0;
    const config = loadConfig(options.config);
    const sites = loadSites(config);
    const violations = [];
    for (const file of options.files) violations.push(...await lintFile(process.cwd(), file, sites, config, { all: options.all }));
    if (!violations.length) return 0;
    process.stdout.write(`${format(violations)}\n`);
    return 2;
}

main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
}, (error) => {
    const known = error.message?.startsWith('tailwind-lint');
    process.stderr.write(`${known ? error.message : `tailwind-lint: ${error.stack || error.message}`}\n`);
    process.exitCode = 1;
});
