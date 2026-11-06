#!/usr/bin/env bash
# Exercises ledger.py add, list and search against a temporary database.
# No network; does not touch the user's real ledger or config.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ledger="$script_dir/ledger.py"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
trap 'exit 130' INT TERM

export RETRO_LEDGER="$tmp/nested/dir/ledger.sqlite"
export XDG_CONFIG_HOME="$tmp/config"
export PYTHONDONTWRITEBYTECODE=1

run() { python3 -I "$ledger" "$@"; }
fail() { echo "FAIL: $*" >&2; exit 1; }
json_len() { python3 -I -c 'import json, sys; print(len(json.load(sys.stdin)))'; }
json_field() { python3 -I -c 'import json, sys; print(json.load(sys.stdin)[int(sys.argv[1])][sys.argv[2]])' "$1" "$2"; }

[ "$(run path)" = "$RETRO_LEDGER" ] || fail "path does not honor RETRO_LEDGER"

id1="$(run add --project proj-a --harness codex --goal achieved \
  --helped "ran tests first" --friction "Lint autofix stripped an import" \
  --changes "none" --candidates "lint-strip x1")"
[ "$id1" = "1" ] || fail "first id was '$id1'"
[ -f "$RETRO_LEDGER" ] || fail "database file not created"

run add --project proj-b --harness claude-code --goal partial \
  --friction "flaky network test" --changes "AGENTS.md: retry rule" >/dev/null
run add --project proj-a --goal not_achieved \
  --friction "stale PR head merged" --candidates "LINT-STRIP x2" >/dev/null

if run add --project proj-a --goal maybe >/dev/null 2>&1; then
  fail "invalid --goal accepted"
fi

[ "$(run list --json | json_len)" = "3" ] || fail "list did not return 3 rows"
[ "$(run list --json | json_field 0 id)" = "3" ] || fail "list not newest first"
[ "$(run list --limit 1 --json | json_len)" = "1" ] || fail "--limit ignored"
[ "$(run list --project proj-a --json | json_len)" = "2" ] || fail "--project filter"
run list | grep -q "AGENTS.md: retry rule" || fail "text list output"

[ "$(run search lint-strip --json | json_len)" = "2" ] || fail "case-insensitive search"
[ "$(run search NETWORK --json | json_field 0 project)" = "proj-b" ] || fail "search friction"
[ "$(run search retry --json | json_len)" = "1" ] || fail "search changes"
[ "$(run search "ran tests" --json | json_len)" = "0" ] || fail "search must skip helped"
[ "$(run search % --json | json_len)" = "0" ] || fail "% must be literal"
[ "$(run search lint --project proj-b --json | json_len)" = "0" ] || fail "search --project"
run search lint-strip | tail -n 1 | grep -qx "matches: 2" || fail "search footer"

# Config file is used when RETRO_LEDGER is unset.
mkdir -p "$XDG_CONFIG_HOME/retro"
printf '{"ledger": "%s"}\n' "$tmp/from-config.sqlite" >"$XDG_CONFIG_HOME/retro/config.json"
[ "$(env -u RETRO_LEDGER python3 -I "$ledger" path)" = "$tmp/from-config.sqlite" ] \
  || fail "config ledger key ignored"

# Default path when neither is set.
rm "$XDG_CONFIG_HOME/retro/config.json"
[ "$(env -u RETRO_LEDGER XDG_STATE_HOME="$tmp/state" python3 -I "$ledger" path)" \
  = "$tmp/state/retro/ledger.sqlite" ] || fail "XDG_STATE_HOME default"

echo "ledger_test: ok"
