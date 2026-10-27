#!/bin/sh
# GrumPHP already runs inside the php-fpm container: call node directly, not through warden.
set -u

config=${TAILWIND_LINT_CONFIG:-dev/quality/tailwind-lint.config.json}
lint="$(cd "$(dirname "$0")/.." && pwd)/dist/tailwind-lint.js"

if [ "$#" -gt 0 ]; then
    exec node "$lint" --config "$config" "$@"
fi

git diff --cached --relative --name-only --diff-filter=ACMR -z -- '*.phtml' '*.css' \
    | xargs -0 -r node "$lint" --config "$config"
