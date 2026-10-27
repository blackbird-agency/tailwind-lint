'use strict';

const spacing = { 0: '0px', px: '1px', 4: '1rem', 4.5: '1.125rem', 11: '2.75rem', 18: '4.5rem', '1/2': '50%', full: '100%' };

module.exports = function fakeSite() {
    const scales = {
        width: spacing, height: spacing, size: spacing, padding: spacing, margin: spacing, gap: spacing, inset: spacing,
        fontSize: { base: ['1rem', '130%'], lg: '1.125rem', xl: ['1.5rem', '120%'] },
        borderRadius: { DEFAULT: '0.25rem', sm: '0.125rem', full: '9999px' },
        lineHeight: { none: '1' },
    };
    const components = {
        btn: new Set(['rounded-full', 'text-base']),
        'btn-primary': new Set(['btn', 'rounded-full', 'text-base', 'bg-red', 'text-secondary']),
        'title-font': new Set(['font-title', 'font-bold', 'uppercase']),
    };
    const T = 'translate(var(--tw-translate-x), var(--tw-translate-y))';
    const signatures = {
        'p-4': [['padding', '1rem']],
        'p-6': [['padding', '1.5rem']],
        'pt-2': [['padding-top', '0.5rem']],
        block: [['display', 'block']],
        hidden: [['display', 'none']],
        'text-xl': [['font-size', '1.5rem'], ['line-height', '120%']],
        'leading-none': [['line-height', '1']],
        'bg-primary': [['--tw-bg-opacity', '1'], ['background-color', 'rgb(0 40 115 / var(--tw-bg-opacity))']],
        'bg-opacity-50': [['--tw-bg-opacity', '0.5']],
        'translate-x-4': [['--tw-translate-x', '1rem'], ['transform', T]],
        'translate-x-6': [['--tw-translate-x', '1.5rem'], ['transform', T]],
        'translate-y-4': [['--tw-translate-y', '1rem'], ['transform', T]],
    };
    return {
        name: 'Fake',
        signature: (name) => signatures[name] ?? null,
        isDefaultShade: (color) => /^(blue|gray|red)-\d+$/.test(color),
        scale: (key) => scales[key] ?? {},
        closure: (name) => components[name] ?? null,
    };
};
