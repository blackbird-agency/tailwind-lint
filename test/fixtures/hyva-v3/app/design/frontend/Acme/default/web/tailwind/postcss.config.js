const { postcssImportHyvaModules } = require('@hyva-themes/hyva-modules');

module.exports = {
    plugins: [
        postcssImportHyvaModules,
        require('tailwindcss/nesting'),
        require('tailwindcss'),
    ],
};
