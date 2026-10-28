const { mergeTailwindConfig } = require('@hyva-themes/hyva-modules');

module.exports = mergeTailwindConfig({
    content: ['./templates/**/*.phtml'],
    darkMode: 'class',
});
