# tailwind-lint

Checks the Tailwind classes written in templates and stylesheets against each site's own
Tailwind config.

## Why

Tailwind fails silently. A class that does not exist (`w-122`), a shade that falls back
to the default palette (`bg-blue-100` in a theme that defines its own blue), or two classes
fighting over the same property (`p-4 p-6`) all compile without a warning. The page just
looks wrong. Coding agents make these mistakes often, and humans copy them.

tailwind-lint catches them at write time. It is meant to run after every edit, for example
from a Claude Code `PostToolUse` hook, and only reports on what the edit added.

## What it reports

| Rule | Flags |
|---|---|
| `no-hardcoded-color` | a colour written as an arbitrary value (`bg-[#f5f5f5]`) |
| `no-default-palette-shade` | a numbered shade the theme does not define, so it comes from the default palette |
| `prefer-size` | matching `w-*` and `h-*` that should be `size-*` |
| `unknown-scale-value` | a value missing from the theme scale, which Tailwind does not generate |
| `no-arbitrary-on-scale` | an arbitrary value equal to an existing scale key (`w-[72px]` → `w-18`) |
| `redundant-with-component` | a class already applied by a component class on the same element |
| `no-conflicting-classes` | two classes with the same variants setting the same properties to different values |
| `no-inline-svg` | an inline `<svg>` in a template |

Nothing is hardcoded about the theme. Colours, scales, components and generated CSS are all
read from the site's config and stylesheets on each run.

## Requirements

- Node 18 or later.
- Tailwind CSS v3 or v4. On v3, `tailwindcss`, `postcss` and `micromatch` are resolved from
  each site's config directory, so the linter uses the exact versions the site builds with.
  On v4, `tailwindcss` and `@tailwindcss/node` come from the site, `postcss` and `micromatch`
  from the bundle: `dist/tailwind-lint.js` embeds them, so the package needs no `npm install`.
  A v4 site has no `tailwind.config.js`: point `config` at any file of the Tailwind folder
  (`hyva.config.json`).
- git, to find the lines added since `HEAD`.

Each Tailwind major version gets its own adapter in `src/adapters/`. The v4 adapter reads the
theme from the `@theme` blocks and `@source` globs of the CSS entry, and accepts the dynamic
spacing values v4 generates (`w-122`).

## Installation

The package is distributed through Composer, like the agency's PHPCS and PHPMD rulesets. It
ships a prebuilt, dependency-free Node bundle: nothing to install with npm.

```json
"repositories": [
    { "type": "vcs", "url": "git@github.com:blackbird-agency/tailwind-lint.git" }
]
```

```
composer require --dev blackbird/tailwind-lint
```

Then create the project config, by convention `dev/quality/tailwind-lint.config.json` (see
[Configuration](#configuration)).

### GrumPHP

`bin/lint-staged.sh` lints the files GrumPHP passes, or the staged `*.phtml` / `*.css` files. It
calls `node` directly: GrumPHP runs where node is available (the PHP container under Warden).

```yaml
grumphp:
    tasks:
        tailwind_lint:
            scripts:
                - vendor/blackbird/tailwind-lint/bin/lint-staged.sh
            triggered_by: [phtml, css]
            metadata:
                task: shell
```

### Claude Code

`hooks/claude-post-tool-use.sh` lints each `*.phtml` / `*.css` file Claude edits and sends the
violations back to it. It runs on the host and reaches node through `warden env exec -T php-fpm`.
It does nothing when the project config is absent. In the project's `.claude/settings.json`:

```json
"hooks": {
    "PostToolUse": [
        {
            "matcher": "Edit|Write|MultiEdit",
            "hooks": [
                {
                    "type": "command",
                    "command": "\"$CLAUDE_PROJECT_DIR\"/vendor/blackbird/tailwind-lint/hooks/claude-post-tool-use.sh",
                    "timeout": 30
                }
            ]
        }
    ]
}
```

Both scripts read the config path from `$TAILWIND_LINT_CONFIG`, default
`dev/quality/tailwind-lint.config.json`.

## Usage

```
vendor/bin/tailwind-lint [--config tailwind-lint.config.json] [--all] <file>...
```

| Exit code | Meaning |
|---|---|
| `0` | nothing to report |
| `2` | violations, one per line on stdout: `file:line [rule] message` |
| `1` | the linter could not run (message on stderr) |

By default, only lines added since `HEAD` are checked. Legacy code is not reported until
someone touches it. A file git does not track counts as entirely new, unless a `baselines`
entry maps it to an original. In that case, only the lines that differ from the original are
checked. `--all` checks every line.

## Configuration

Paths are relative to the directory the linter runs from.

```json
{
  "sites": [
    { "name": "shop", "config": "themes/shop/tailwind.config.js", "css": "themes/shop/styles.css" }
  ],
  "include": ["**/*.phtml", "**/*.css"],
  "ignore": ["vendor/**", "**/dist/**"],
  "baselines": [
    { "match": "^themes/shop/(.+\\.phtml)$", "original": "vendor/parent-theme/$1" }
  ],
  "rules": {
    "no-inline-svg": { "hint": "use the icon helper" },
    "prefer-size": false
  }
}
```

| Key | Purpose |
|---|---|
| `sites` | One entry per Tailwind build. `css` is the entry stylesheet: components are read from it and its imports, and stylesheets under its directory belong to that site. Templates belong to the sites whose `content` globs cover them. |
| `include` / `ignore` | Globs selecting the files to check. `node_modules` is always ignored. |
| `baselines` | Maps an override to the file it was copied from, so that the copied code is not reported. |
| `rules` | `false` disables a rule. `hint` appends project advice to its message. |

When a file belongs to several sites, a theme-dependent violation is only reported if it holds
for all of them.

## Known limits

- Classes are compared within a single `class` attribute on a single line.
- `no-conflicting-classes` ignores `:class` bindings and PHP output, which usually hold
  alternatives where only one applies.
- Component classes are not compared with each other, and component styles under a media
  query or a state selector are not counted as applied.

## Development

```
npm install
npm test
npm run build
```

The suite runs against a small fixture project in `test/fixtures/project/`. `npm run build`
regenerates `dist/tailwind-lint.js` with esbuild: commit it with the sources, since Composer
installs the repository as is. Tag releases (`v0.2.0`…) so projects can pin a version.
