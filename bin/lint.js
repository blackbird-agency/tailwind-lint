#!/usr/bin/env node
'use strict';

const { loadConfig } = require('../src/config');
const { loadSites } = require('../src/sites');
const { lintFile } = require('../src/lint');
const { format } = require('../src/report');

function parseArguments(argv) {
    const options = { all: false, config: 'tailwind-lint.config.json', files: [] };
    for (let index = 0; index < argv.length; index++) {
        if (argv[index] === '--all') options.all = true;
        else if (argv[index] === '--config') options.config = argv[++index];
        else options.files.push(argv[index]);
    }
    return options;
}

async function main(argv) {
    const options = parseArguments(argv);
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
    process.stderr.write(`tailwind-lint: ${error.stack || error.message}\n`);
    process.exitCode = 1;
});
