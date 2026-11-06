#!/usr/bin/env bash
# Prints the next release tag (vMAJOR.MINOR.PATCH) for a bump. Existing tags
# are read from stdin, one per line, or from origin with --remote. Without any
# release tag yet, the first release is v1.0.0. See RELEASE.md.
set -euo pipefail

first_release=v1.0.0
usage() {
  printf 'Usage: scripts/next-version.sh major|minor|patch [--remote]\n' >&2
  exit 2
}

bump=${1:-}
case "$bump" in major|minor|patch) ;; *) usage ;; esac
case "${2:-}" in
  --remote) tags=$(git ls-remote --tags --refs origin 'v*' | sed 's#.*refs/tags/##') ;;
  '') tags=$(cat) ;;
  *) usage ;;
esac
[[ $# -le 2 ]] || usage

latest=$(printf '%s\n' "$tags" | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -n 1 || true)
if [[ -z "$latest" ]]; then
  printf '%s\n' "$first_release"
  exit 0
fi

IFS=. read -r major minor patch <<<"${latest#v}"
case "$bump" in
  major) major=$((major + 1)); minor=0; patch=0 ;;
  minor) minor=$((minor + 1)); patch=0 ;;
  patch) patch=$((patch + 1)) ;;
esac
printf 'v%s.%s.%s\n' "$major" "$minor" "$patch"
