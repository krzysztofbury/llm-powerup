#!/usr/bin/env bash
set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  printf '%s\n' 'auto-lint: jq is unavailable; skipped.' >&2
  exit 0
fi

input=$(cat)
file_path=$(printf '%s' "$input" | jq -er '.tool_input.file_path // empty') || exit 0
[[ -n "$file_path" && -f "$file_path" ]] || exit 0

findings=""

record() {
  local output=$1
  [[ -n "$output" ]] || return 0
  if [[ -n "$findings" ]]; then
    findings+=$'\n'"$output"
  else
    findings=$output
  fi
}

case "$file_path" in
  *.py)
    if command -v ruff >/dev/null 2>&1; then
      output=$(ruff format --check "$file_path" 2>&1) || record "$output"
      output=$(ruff check "$file_path" 2>&1) || record "$output"
    fi
    ;;
  *.sql)
    if command -v sqlfluff >/dev/null 2>&1; then
      output=$(sqlfluff lint "$file_path" 2>&1) || record "$output"
    fi
    ;;
  *.sh)
    if command -v shellcheck >/dev/null 2>&1; then
      output=$(shellcheck "$file_path" 2>&1) || record "$output"
    fi
    ;;
esac

if [[ -n "$findings" ]]; then
  printf '%s\n' "$findings" >&2
  exit 2
fi

exit 0
