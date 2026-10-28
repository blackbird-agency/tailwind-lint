'use strict';

// Never read web/tailwind/generated or app/etc/hyva-themes.json: they may be stale.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const MAX_DEPTH = 7;

function realpath(file) {
    try { return fs.realpathSync(file); } catch { return file; }
}

// Same lookup as hyva-modules: if it found another root, it would merge other modules than the ones discovered here.
function assertMagentoRoot(configFile, root) {
    let basePath = null;
    for (let dir = realpath(path.dirname(configFile)); ; dir = path.dirname(dir)) {
        if (fs.existsSync(path.join(dir, 'app')) && fs.existsSync(path.join(dir, 'vendor'))) {
            basePath = dir;
            break;
        }
        if (path.dirname(dir) === dir) break;
    }
    if (basePath !== root && basePath !== realpath(root)) {
        throw new Error(`tailwind-lint: ${configFile} resolves the Magento root to ${basePath}, but tailwind-lint runs with root ${root}`);
    }
    return basePath;
}

function readHyvaConfig(themeDir) {
    const file = path.join(themeDir, 'hyva.config.json');
    if (!fs.existsSync(file)) return null;
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        throw new Error(`tailwind-lint: cannot parse ${file}: ${error.message}`);
    }
}

// Resolving @hyva-themes/hyva-modules is not enough: a plain theme may have it installed.
function isHyvaTheme(themeDir, sourceText) {
    return fs.existsSync(path.join(themeDir, 'hyva.config.json')) || String(sourceText ?? '').includes('@hyva-themes/hyva-modules');
}

function isDir(file) {
    try { return fs.statSync(file).isDirectory(); } catch { return false; }
}

function discover(root, area) {
    const found = [];
    const walk = (dir, depth) => {
        if (isDir(path.join(dir, 'view', area, 'tailwind'))) {
            found.push(path.relative(root, dir).split(path.sep).join('/'));
        }
        // A Magento module never contains another one: stop at its root.
        if (depth >= MAX_DEPTH || fs.existsSync(path.join(dir, 'registration.php'))) return;
        let entries;
        try { entries = fs.readdirSync(dir); } catch { return; }
        for (const name of entries) {
            if (name === 'node_modules' || name === 'view' || name.startsWith('.')) continue;
            const child = path.join(dir, name);
            if (isDir(child)) walk(child, depth + 1);
        }
    };
    for (const base of ['app/code', 'vendor']) {
        const dir = path.join(root, base);
        if (isDir(dir)) walk(dir, 1);
    }
    return found.sort();
}

const discovered = new Map();

function discoverOnce(root, area) {
    const key = `${root}\0${area}`;
    if (!discovered.has(key)) discovered.set(key, discover(root, area));
    return discovered.get(key);
}

function hyvaModules(root, hyvaConfig) {
    const tailwind = (hyvaConfig && hyvaConfig.tailwind) || {};
    const area = tailwind.area ?? 'frontend';
    const exclude = tailwind.exclude || [];
    const discovered = tailwind.includeExternalModules === false ? [] : discoverOnce(root, area)
        .map((src) => {
            const entry = exclude.find((e) => e.src === src);
            if (!entry) return { src, cssExcluded: false };
            return entry.keepSource ? { src, cssExcluded: true } : null;
        })
        .filter(Boolean);
    const included = (tailwind.include || []).map((m) => ({ src: m.src, cssExcluded: Boolean(m.cssExcluded) }));
    return [...discovered, ...included];
}

// Same classification as hyva-modules/bin/generate-sources.js, in three ordered buckets.
function classify(root, modules, area) {
    const sources = [], sourceCss = [], moduleCss = [];
    for (const m of modules) {
        if (!m.src) continue;
        const dir = path.resolve(root, m.src);
        const tw = path.join(dir, 'view', area, 'tailwind');
        if (m.cssExcluded) sources.push(dir);
        else if (fs.existsSync(path.join(tw, 'module.css'))) moduleCss.push(path.join(tw, 'module.css'));
        else {
            sources.push(dir);
            if (fs.existsSync(path.join(tw, 'tailwind-source.css'))) sourceCss.push(path.join(tw, 'tailwind-source.css'));
        }
    }
    return { sources, sourceCss, moduleCss };
}

function hyvaSourceCss(root, modules, area) {
    const { sources, sourceCss, moduleCss } = classify(root, modules, area);
    const lines = (list, fmt) => list.map(fmt).join('');
    return `${lines(sources, (d) => `@source "${d}";\n`)}\n${lines(sourceCss, (f) => `@import "${f}";\n`)}\n${lines(moduleCss, (f) => `@import "${f}";\n`)}\n`;
}

function hyvaModuleCssFiles(root, modules, area) {
    const { sourceCss, moduleCss } = classify(root, modules, area);
    return [...sourceCss, ...moduleCss];
}

function packageDir(startDir, name) {
    let dir = startDir;
    for (;;) {
        const candidate = path.join(dir, 'node_modules', ...name.split('/'));
        if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

function hyvaPackageDir(req) {
    let dir = path.dirname(req.resolve('@hyva-themes/hyva-modules'));
    for (;;) {
        const file = path.join(dir, 'package.json');
        if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).name === '@hyva-themes/hyva-modules') return dir;
        const parent = path.dirname(dir);
        if (parent === dir) throw new Error('tailwind-lint: cannot locate @hyva-themes/hyva-modules');
        dir = parent;
    }
}

async function hyvaTokensCss(themeDir, hyvaConfig, req) {
    const tokens = (hyvaConfig && hyvaConfig.tokens) || {};
    const { src } = tokens;
    if (src && (src.startsWith('http') || !src.trim().toLowerCase().endsWith('.json'))) {
        throw new Error(`tailwind-lint: design tokens src must be a local JSON file: ${src}`);
    }
    let design = tokens.values;
    if (!design) {
        const file = path.resolve(themeDir, src || 'design.tokens.json');
        if (!fs.existsSync(file)) {
            if (src) throw new Error(`tailwind-lint: design tokens file not found: ${file}`);
            return null;
        }
        try {
            design = JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch (error) {
            throw new Error(`tailwind-lint: cannot parse ${file}: ${error.message}`);
        }
    }
    if (typeof design !== 'object') throw new Error('tailwind-lint: invalid design tokens (expected a JSON object)');

    const hyvaDir = hyvaPackageDir(req);
    const fylgja = packageDir(hyvaDir, '@fylgja/props-builder');
    if (!fylgja) throw new Error('tailwind-lint: @fylgja/props-builder not found next to @hyva-themes/hyva-modules');
    const load = async (name) => (await import(pathToFileURL(path.join(fylgja, 'src', name)).href)).default;
    const fromTokens = await load('from-tokens.js');
    const toStyle = await load('to-style.js');
    const style = toStyle(fromTokens(design, tokens.format || 'default'), {
        selector: tokens.cssSelector || '@theme',
        mediaDark: tokens.mediaDark || '@media (prefers-color-scheme: dark)',
    });
    return `${style}\n`;
}

module.exports = { realpath, assertMagentoRoot, readHyvaConfig, isHyvaTheme, hyvaModules, hyvaSourceCss, hyvaModuleCssFiles, hyvaTokensCss };
