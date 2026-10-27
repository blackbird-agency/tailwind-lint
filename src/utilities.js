'use strict';

const byLength = (list) => [...list].sort((a, b) => b.length - a.length);

const COLOR_PREFIXES = byLength([
    'bg', 'text', 'border', 'border-x', 'border-y', 'border-t', 'border-r', 'border-b', 'border-l',
    'border-s', 'border-e', 'ring', 'ring-offset', 'outline', 'fill', 'stroke', 'from', 'via', 'to',
    'divide', 'placeholder', 'accent', 'caret', 'decoration', 'shadow',
]);

const NUMERIC = /^(\d+(\.\d+)?|\d+\/\d+)$/;

const SCALES = {
    w: { key: 'width', named: NUMERIC },
    h: { key: 'height', named: NUMERIC },
    size: { key: 'size', named: NUMERIC },
    'min-w': { key: 'minWidth', named: NUMERIC },
    'max-w': { key: 'maxWidth', named: NUMERIC },
    'min-h': { key: 'minHeight', named: NUMERIC },
    'max-h': { key: 'maxHeight', named: NUMERIC },
    basis: { key: 'flexBasis', named: NUMERIC },
    gap: { key: 'gap', named: NUMERIC },
    'gap-x': { key: 'gap', named: NUMERIC },
    'gap-y': { key: 'gap', named: NUMERIC },
    'space-x': { key: 'space', named: NUMERIC },
    'space-y': { key: 'space', named: NUMERIC },
    'translate-x': { key: 'translate', named: NUMERIC },
    'translate-y': { key: 'translate', named: NUMERIC },
    text: { key: 'fontSize', named: /^(\d*x+[sl]|sm|md|base|lg)$/ },
    leading: { key: 'lineHeight', named: /^(\d+(\.\d+)?|none|tight|snug|normal|relaxed|loose)$/ },
};
for (const prefix of ['inset', 'inset-x', 'inset-y', 'top', 'right', 'bottom', 'left', 'start', 'end']) {
    SCALES[prefix] = { key: 'inset', named: NUMERIC };
}
for (const side of ['', 'x', 'y', 't', 'r', 'b', 'l', 's', 'e']) {
    SCALES[`p${side}`] = { key: 'padding', named: NUMERIC };
    SCALES[`m${side}`] = { key: 'margin', named: NUMERIC };
}
for (const corner of ['', '-t', '-r', '-b', '-l', '-tl', '-tr', '-br', '-bl', '-s', '-e', '-ss', '-se', '-es', '-ee']) {
    SCALES[`rounded${corner}`] = { key: 'borderRadius', named: /^(none|sm|md|lg|full|\d*x+l)$/ };
}

module.exports = { COLOR_PREFIXES, SCALES, SCALE_PREFIXES: byLength(Object.keys(SCALES)) };
