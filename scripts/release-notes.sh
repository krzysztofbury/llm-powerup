#!/usr/bin/env bash
# Prints the CHANGELOG.md section for one version (without its heading), or
# nothing when the changelog has no section for it. Headings look like
# "## [1.2.0] - 2026-11-06". See RELEASE.md.
set -euo pipefail

[[ $# -ge 1 && $# -le 2 ]] || { printf 'Usage: scripts/release-notes.sh VERSION [CHANGELOG]\n' >&2; exit 2; }
version=${1#v}
changelog=${2:-CHANGELOG.md}
[[ -r "$changelog" ]] || exit 0

awk -v version="$version" '
  /^## / {
    if (inside) exit
    heading = $0
    sub(/^## \[?/, "", heading)
    sub(/[] ].*$/, "", heading)
    if (heading == version) { inside = 1; next }
  }
  inside { print }
' "$changelog" | sed -e '/./,$!d' | sed -e ':a' -e '/^\n*$/{$d;N;ba' -e '}'
