'use strict';

const fs = require('fs');
const path = require('path');

function packageRoot(req, name) {
    let entry;
    try {
        entry = req.resolve(name);
    } catch (error) {
        if (error.code === 'MODULE_NOT_FOUND') return null;
        throw error;
    }
    let dir = path.dirname(entry);
    for (;;) {
        const file = path.join(dir, 'package.json');
        if (fs.existsSync(file)) {
            try {
                const json = JSON.parse(fs.readFileSync(file, 'utf8'));
                if (json.name === name) return { dir, version: json.version };
            } catch { /* keep walking up */ }
        }
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

// Project = parent of the outermost node_modules (nested ones belong to the package path).
function projectDirOf(packageDir) {
    const outer = packageDir.indexOf(`${path.sep}node_modules${path.sep}`);
    return outer === -1 ? path.dirname(packageDir) : packageDir.slice(0, outer);
}

function readLock(lockFile) {
    if (!fs.existsSync(lockFile)) return null;
    try {
        return JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    } catch (error) {
        throw new Error(`tailwind-lint: cannot parse ${lockFile}: ${error.message}`);
    }
}

function assertLocked(req, names) {
    const locks = new Map();
    for (const name of names) {
        const pkg = packageRoot(req, name);
        if (!pkg) throw new Error(`tailwind-lint: ${name} is not installed for ${path.dirname((req.resolve.paths(name) || ['.'])[0])}`);
        const projectDir = projectDirOf(pkg.dir);
        if (!locks.has(projectDir)) {
            const lockFile = path.join(projectDir, 'package-lock.json');
            locks.set(projectDir, readLock(lockFile));
        }
        const lock = locks.get(projectDir);
        if (!lock) throw new Error(`tailwind-lint: no package-lock.json in ${projectDir}, required to pin ${name}`);
        const key = path.relative(projectDir, pkg.dir).split(path.sep).join('/');
        const locked = lock.packages?.[key]?.version;
        if (locked !== pkg.version) {
            throw new Error(`tailwind-lint: ${name} ${pkg.version} is installed in ${projectDir} but its package-lock.json pins ${locked ?? 'nothing'}`);
        }
    }
}

module.exports = { assertLocked };
