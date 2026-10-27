module.exports = {
    content: ['./templates/**/*.phtml'],
    theme: {
        extend: {
            colors: {
                primary: '#002873',
                blue: { dark: '#002873' },
            },
            spacing: { 18: '4.5rem' },
            fontSize: { lg: '1.125rem', xl: ['1.5rem', '120%'] },
        },
    },
};
