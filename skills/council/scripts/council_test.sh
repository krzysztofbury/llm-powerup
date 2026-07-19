#!/usr/bin/env bash
# Self-test for council.sh. Uses --mock and --dry-run only: no network calls.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
COUNCIL="$SCRIPT_DIR/council.sh"
TMP=$(mktemp -d "${TMPDIR:-/tmp}/council-test.XXXXXX")
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

# --- Task 1: discovery ---

# 1. mock discovery lists all four known members
out=$("$COUNCIL" --mock members) || fail "mock members rc=$?"
[ "$(echo "$out" | wc -l | tr -d ' ')" -eq 5 ] || fail "expected 5 mock members, got: $out"
echo "$out" | grep -qx "codex" || fail "codex missing from mock members"
echo "$out" | grep -qx "agy" || fail "agy missing from mock members"

# 2. insufficient members -> exit 1
rc=0
"$COUNCIL" --members "no-such-cli-xyz" members >/dev/null 2>&1 || rc=$?
[ "$rc" -eq 1 ] || fail "expected rc 1 for insufficient members, got $rc"

# --- Task 2: dispatch ---

echo "What is the capital of France? One word." > "$TMP/prompt.md"

# 3. mock dispatch: 4 responses, anonymized, mapping present
run1="$TMP/run1"
"$COUNCIL" --mock --run-dir "$run1" dispatch "$TMP/prompt.md" >/dev/null || fail "mock dispatch rc=$?"
[ -f "$run1/prompt.md" ] || fail "prompt.md not copied into run dir"
[ -f "$run1/anon/mapping.json" ] || fail "mapping.json missing"
# shellcheck disable=SC2012  # counts files; behavior required by integration test
count=$(ls "$run1"/anon/response-*.md | wc -l | tr -d ' ')
[ "$count" -eq 5 ] || fail "expected 5 anon responses, got $count"
grep -q '"response-A"' "$run1/anon/mapping.json" || fail "mapping.json lacks response-A key"

# 4. fail-soft: one member fails, council proceeds with 3
run2="$TMP/run2"
COUNCIL_MOCK_FAIL=codex "$COUNCIL" --mock --run-dir "$run2" dispatch "$TMP/prompt.md" >/dev/null \
  || fail "fail-soft dispatch rc=$?"
# shellcheck disable=SC2012  # counts files; behavior required by integration test
count=$(ls "$run2"/anon/response-*.md | wc -l | tr -d ' ')
[ "$count" -eq 4 ] || fail "expected 4 anon responses after 1 failure, got $count"
[ -f "$run2/meta/codex.failed" ] || fail "codex failure not recorded in meta/"
[ ! -f "$run2/responses/codex.md" ] || fail "failed member's partial output must not remain in responses/"
[ -s "$run2/meta/codex.partial" ] || fail "failed member's partial output must be preserved as meta/codex.partial"

# 5. dry-run prints commands and writes no responses
run3="$TMP/run3"
out=$("$COUNCIL" --mock --dry-run --run-dir "$run3" dispatch "$TMP/prompt.md")
echo "$out" | grep -q "codex exec -s read-only" || fail "dry-run missing codex command"
echo "$out" | grep -q "claude -p" || fail "dry-run missing claude command"
[ -z "$(ls -A "$run3/responses" 2>/dev/null)" ] || fail "dry-run wrote responses"

# --- Task 3: review ---

# 6. mock review over run1: bundle built, one ranking per member
"$COUNCIL" --mock review "$run1" >/dev/null || fail "mock review rc=$?"
[ -f "$run1/review-prompt.md" ] || fail "review-prompt.md missing"
grep -q "response-A" "$run1/review-prompt.md" || fail "bundle lacks anonymized responses"
[ -s "$run1/reviews/claude.md" ] || fail "claude review missing"
# shellcheck disable=SC2012  # counts files; behavior required by integration test
count=$(ls "$run1"/reviews/*.md | wc -l | tr -d ' ')
[ "$count" -eq 5 ] || fail "expected 5 reviews, got $count"

# 7. review without a dispatched run dir -> hard error
rc=0
"$COUNCIL" --mock review "$TMP/nonexistent" >/dev/null 2>&1 || rc=$?
[ "$rc" -ne 0 ] || fail "review of missing run dir should fail"

# --- Fix pass: flags accepted before AND after the subcommand ---

# 8. flags placed after the subcommand and prompt-file must be honored
# (regression: main() used to stop parsing flags at the subcommand)
run8="$TMP/run8"
out=$("$COUNCIL" --mock --dry-run dispatch "$TMP/prompt.md" --run-dir "$run8" --timeout 42)
echo "$out" | grep -q "codex exec -s read-only" || fail "flags-after-subcommand: dry-run missing codex command"
[ -d "$run8" ] || fail "flags-after-subcommand: --run-dir given after the subcommand was not honored"

# 9. a value-taking flag with no value dies cleanly (was: unbound-variable crash on \$2)
rc=0
"$COUNCIL" --mock members --members >/dev/null 2>&1 || rc=$?
[ "$rc" -ne 0 ] || fail "--members with no value should fail, not crash"

# --- Fix pass: run_with_timeout behavioral contract ---

# 10. run_with_timeout must kill a hung command well within the outer bound
# and let a fast command return its own exit code. This machine has neither
# `timeout` nor `gtimeout` installed (checked during implementation), so on
# stock macOS this exercises the bash-watcher fallback branch, not the
# timeout(1)/gtimeout(1) fast path -- which is exactly the untested path this
# assertion targets. If a coreutils timeout is ever installed here, this
# still verifies the observable contract (non-zero rc, bounded elapsed time,
# 0 for a command that finishes in time) even though it would then exercise
# the other branch.
(
  set -euo pipefail
  # shellcheck disable=SC1090  # dynamic path to council.sh in this dir; verified to exist above
  source "$COUNCIL"
  start=$(date +%s)
  rc=0
  run_with_timeout 1 sleep 5 || rc=$?
  end=$(date +%s)
  elapsed=$((end - start))
  [ "$rc" -ne 0 ] || fail "run_with_timeout: expected non-zero rc for a killed command, got 0"
  [ "$elapsed" -lt 5 ] || fail "run_with_timeout: expected elapsed <5s for a 1s-bounded kill, got ${elapsed}s"
  run_with_timeout 5 true || fail "run_with_timeout: expected rc 0 for a command finishing within the bound"
) || fail "run_with_timeout subshell failed"

# --- Fix pass: output-cap truncation ---

# 11. fan_out must truncate a member's output to OUTPUT_CAP_BYTES
(
  set -euo pipefail
  # shellcheck disable=SC1090  # dynamic path to council.sh in this dir; verified to exist above
  source "$COUNCIL"
  # These override council.sh globals consumed by the sourced dispatch_one/
  # fan_out functions below; shellcheck can't see that cross-file usage.
  # shellcheck disable=SC2034
  MOCK=1
  # shellcheck disable=SC2034
  OUTPUT_CAP_BYTES=100
  # shellcheck disable=SC2034
  TIMEOUT_SECS=5
  trunc_dir="$TMP/trunc"
  mkdir -p "$trunc_dir"
  prompt="$trunc_dir/big-prompt.md"
  printf 'X%.0s' {1..250} > "$prompt"
  fan_out "$prompt" "$trunc_dir/out" "$trunc_dir/meta" "claude"
  size=$(wc -c < "$trunc_dir/out/claude.md" | tr -d ' ')
  [ "$size" -eq 100 ] || fail "truncation: expected claude.md capped at 100 bytes, got $size"
) || fail "truncation subshell failed"

# --- Fix pass 2: watchdog must escalate TERM -> KILL ---

# 12. a member that traps/ignores SIGTERM must still die within the grace window
(
  set -euo pipefail
  # shellcheck disable=SC1090  # dynamic path to council.sh in this dir; verified to exist above
  source "$COUNCIL"
  start=$(date +%s)
  rc=0
  run_with_timeout 1 bash -c 'trap "" TERM; sleep 20' || rc=$?
  end=$(date +%s)
  elapsed=$((end - start))
  [ "$rc" -ne 0 ] || fail "kill escalation: expected non-zero rc for a TERM-ignoring command, got 0"
  [ "$elapsed" -lt 15 ] || fail "kill escalation: expected elapsed <15s for a TERM-ignoring command, got ${elapsed}s"
) || fail "kill escalation subshell failed"

echo "ALL TESTS PASSED"
