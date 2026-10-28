'use strict';

const { RUNTIME_PREFIXES } = require('../utilities');
const { parseToken, bare } = require('../token');

module.exports = {
    id: 'no-unknown-class',
    siteDependent: true,
    // A class Tailwind does not generate is not a palette shade either (`--color-*: initial`).
    supersedes: ['no-default-palette-shade'],
    check({ groups, fragments = [] }, site) {
        const violations = [];
        const variable = site.version === 4 ? 'bg-(--color)' : 'bg-[--color]';
        for (const token of groups.flat()) {
            const { raw, core, variants } = token;
            if (site.generates(raw) || (!variants.length && site.declares(bare(token))) || site.markers.has(core) || /^(group|peer)\/[\w-]+$/.test(core)) continue;
            violations.push({ token, message: `\`${raw}\` is neither a Tailwind class nor a class declared in the site CSS` });
        }
        for (const token of fragments) {
            const { core } = parseToken(token.raw);
            if (!RUNTIME_PREFIXES.some((prefix) => core.startsWith(`${prefix}-`))) continue;
            violations.push({ token, message: `\`${token.raw}\` is built at runtime: Tailwind cannot generate it, use a CSS variable (\`${variable}\` + \`style="--color: …"\`)` });
        }
        return violations;
    },
};
