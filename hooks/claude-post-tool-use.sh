#!/usr/bin/env bash
# PostToolUse exit codes: 2 feeds stderr back to Claude, 1 only shows it to the user.
set -uo pipefail

file=$(jq -r '.tool_input.file_path // empty')
case "$file" in
    *.phtml|*.css) ;;
    *) exit 0 ;;
esac

root=${CLAUDE_PROJECT_DIR:-$PWD}
case "$file" in
    "$root"/*) relative=${file#"$root"/} ;;
    /*) exit 0 ;;
    *) relative=$file ;;
esac

config=${TAILWIND_LINT_CONFIG:-dev/quality/tailwind-lint.config.json}
[ -f "$root/$config" ] || exit 0

package_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
lint=${package_dir#"$root"/}/dist/tailwind-lint.js

cd "$root" || exit 1
output=$(warden env exec -T php-fpm node "$lint" --config "$config" "$relative" 2>&1)
status=$?

case $status in
    0) exit 0 ;;
    2) printf 'tailwind-lint: fix these before going on\n%s\n' "$output" >&2; exit 2 ;;
    *) printf 'tailwind-lint not run: %s\n' "${output:-exit $status}" >&2; exit 1 ;;
esac
