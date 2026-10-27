'use strict';

function format(violations) {
    return violations.map((v) => `${v.file}:${v.line} [${v.rule}] ${v.message}`).join('\n');
}

module.exports = { format };
