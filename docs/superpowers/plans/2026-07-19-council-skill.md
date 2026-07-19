# Council Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A portable `council` Agent Skill that convenes installed agent CLIs (claude, codex, gemini, opencode) as an LLM council — parallel opinions, optional anonymized peer ranking, chairman synthesis — per the approved spec at `docs/superpowers/specs/2026-07-19-council-skill-design.md`.

**Architecture:** A deterministic bash runner (`scripts/council.sh`) handles member discovery, parallel read-only headless dispatch, anonymization, and peer-review fan-out. The harness session (the agent reading SKILL.md) acts as chairman: writes the prompt, calls the runner, synthesizes. A personal overlay variant is copied into the private llm-prompts repo with a mandatory redaction gate.

**Tech Stack:** bash (zero dependencies), Agent Skills directory format, headless CLIs: `claude -p`, `codex exec`, `gemini -p`, `opencode run`.

## Global Constraints

- Work happens in the repo root on branch `feat/council-skill` (already created; spec committed as 118feb3). Task 7 additionally touches the private prompts repo.
- `skills/` must stay portable across Claude Code, Codex, and OpenCode (SPEC.md). Runner is bash-only — no python/node dependencies.
- Member invocations are read-only: `claude -p --allowedTools Read Grep Glob`, `codex exec -s read-only --skip-git-repo-check`, `gemini --approval-mode plan -o text`, `opencode run --agent plan` (flags verified against installed CLIs 2026-07-19: claude 2.1.215, codex 0.144.6, gemini 0.45.2, opencode 1.18.3).
- Bounded work: default per-member timeout **300** s, output cap **65536** bytes, members limited to the four known CLIs.
- Exit codes: **0** = ok (≥2 responses collected), **1** = insufficient members discovered, **2** = fewer than 2 responses collected (review: 0 reviews collected).
- Run dirs default to `mktemp -d` under `$TMPDIR` — never inside the working repo.
- No secrets, personal data, or private identifiers in any committed file.
- `bash -n` and `shellcheck` must pass on all shell files; run `pre-commit run --all-files` before the final commit.
- Git commits: plain messages, **no** Co-Authored-By lines (user rule).

---

### Task 1: Runner skeleton — CLI parsing, discovery, `members` subcommand

**Files:**
- Create: `skills/council/scripts/council.sh`
- Test: `skills/council/scripts/council_test.sh`

**Interfaces:**
- Produces: `council.sh [--mock] [--dry-run] [--members "a b c"] [--timeout SECS] [--run-dir DIR] <subcommand> [args]`; subcommands `members`, `dispatch <prompt-file>` (stub), `review <run-dir>` (stub). Global vars for later tasks: `MOCK`, `DRY_RUN`, `MEMBERS`, `TIMEOUT_SECS`, `RUN_DIR`, `KNOWN_MEMBERS`, `OUTPUT_CAP_BYTES`; functions `log`, `die`, `discover_members`. Exit code 1 when <2 members discovered. `--mock` makes discovery return all four known members without checking `command -v`.
- Consumes: nothing (first task).

- [ ] **Step 1: Write the failing test**

Create `skills/council/scripts/council_test.sh`:

```bash
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
[ "$(echo "$out" | wc -l | tr -d ' ')" -eq 4 ] || fail "expected 4 mock members, got: $out"
echo "$out" | grep -qx "codex" || fail "codex missing from mock members"

# 2. insufficient members -> exit 1
rc=0
"$COUNCIL" --members "no-such-cli-xyz" members >/dev/null 2>&1 || rc=$?
[ "$rc" -eq 1 ] || fail "expected rc 1 for insufficient members, got $rc"

echo "ALL TESTS PASSED"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash skills/council/scripts/council_test.sh`
Expected: FAIL — `council.sh: No such file or directory`

- [ ] **Step 3: Write the skeleton**

Create `skills/council/scripts/council.sh`:

```bash
#!/usr/bin/env bash
# council.sh — convene installed agent CLIs as an LLM council.
# Adaptation of the technique in https://github.com/karpathy/llm-council
#
# Subcommands:
#   members                 print discovered council members (>=2 required)
#   dispatch <prompt-file>  stage 1: parallel read-only opinions + anonymization
#   review <run-dir>        stage 2: anonymized peer ranking by each member
#
# Exit codes: 0 ok; 1 insufficient members discovered; 2 fewer than 2
# responses collected (review: 0 reviews collected).
set -euo pipefail
shopt -s nullglob

KNOWN_MEMBERS="claude codex gemini opencode"
TIMEOUT_SECS=300
OUTPUT_CAP_BYTES=65536
MOCK=0
DRY_RUN=0
MEMBERS="$KNOWN_MEMBERS"
RUN_DIR=""

log() { printf 'council: %s\n' "$*" >&2; }
die() { log "$*"; exit "${2:-1}"; }

usage() {
  cat >&2 <<'EOF'
Usage: council.sh [flags] <subcommand> [args]

Subcommands:
  members                 print discovered council members
  dispatch <prompt-file>  parallel opinions + anonymization
  review <run-dir>        anonymized peer ranking

Flags:
  --members "a b c"   candidate CLIs (default: claude codex gemini opencode)
  --timeout SECS      per-member timeout (default: 300)
  --run-dir DIR       working directory for the run (default: mktemp -d)
  --mock              canned responses, no CLI calls (testing)
  --dry-run           print member commands without executing
EOF
  exit 1
}

# Print the subset of requested members that are actually installed.
discover_members() {
  local requested="$1" found="" m
  if [ "$MOCK" = "1" ]; then
    for m in $requested; do
      case " $KNOWN_MEMBERS " in *" $m "*) found="$found $m" ;; esac
    done
  else
    for m in $requested; do
      command -v "$m" >/dev/null 2>&1 && found="$found $m"
    done
  fi
  echo "${found# }"
}

require_quorum() {
  local members="$1" count
  count=$(echo "$members" | wc -w | tr -d ' ')
  if [ "$count" -lt 2 ]; then
    die "need >=2 council members, found ${count}: '${members}'. Install more of: $KNOWN_MEMBERS" 1
  fi
}

cmd_members() {
  local members
  members=$(discover_members "$MEMBERS")
  require_quorum "$members"
  printf '%s\n' $members
}

cmd_dispatch() { die "dispatch: not implemented yet" 70; }
cmd_review()   { die "review: not implemented yet" 70; }

main() {
  local subcommand=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --members) MEMBERS="$2"; shift 2 ;;
      --timeout) TIMEOUT_SECS="$2"; shift 2 ;;
      --run-dir) RUN_DIR="$2"; shift 2 ;;
      --mock)    MOCK=1; shift ;;
      --dry-run) DRY_RUN=1; shift ;;
      -h|--help) usage ;;
      members|dispatch|review) subcommand="$1"; shift; break ;;
      *) log "unknown argument: $1"; usage ;;
    esac
  done
  case "$subcommand" in
    members)  cmd_members "$@" ;;
    dispatch) cmd_dispatch "$@" ;;
    review)   cmd_review "$@" ;;
    *) usage ;;
  esac
}

main "$@"
```

Then: `chmod +x skills/council/scripts/council.sh skills/council/scripts/council_test.sh`

- [ ] **Step 4: Run test to verify it passes**

Run: `bash skills/council/scripts/council_test.sh`
Expected: `ALL TESTS PASSED`

Run: `bash -n skills/council/scripts/council.sh && shellcheck skills/council/scripts/council.sh skills/council/scripts/council_test.sh`
Expected: no output (clean). If shellcheck flags the unquoted `$members` in `cmd_members` (SC2086), it is intentional word-splitting — annotate that single line with `# shellcheck disable=SC2086` rather than quoting it.

- [ ] **Step 5: Commit**

```bash
git add skills/council/scripts/council.sh skills/council/scripts/council_test.sh
git commit -m "Add council runner skeleton: discovery, quorum, members subcommand"
```

---

### Task 2: Dispatch — parallel read-only opinions, fail-soft, anonymization

**Files:**
- Modify: `skills/council/scripts/council.sh` (replace `cmd_dispatch` stub; add helpers)
- Modify: `skills/council/scripts/council_test.sh` (append tests)

**Interfaces:**
- Consumes: Task 1 globals (`MOCK`, `DRY_RUN`, `TIMEOUT_SECS`, `RUN_DIR`, `OUTPUT_CAP_BYTES`) and functions (`log`, `die`, `discover_members`, `require_quorum`).
- Produces: `cmd_dispatch <prompt-file>` and run-dir layout used by Task 3 and SKILL.md:
  - `<run-dir>/prompt.md` — copy of the dispatched prompt
  - `<run-dir>/responses/<member>.md` — raw member output (capped at 65536 bytes)
  - `<run-dir>/meta/<member>.ok` | `<run-dir>/meta/<member>.failed` (contains rc or `empty`) | `<run-dir>/meta/<member>.err` (stderr)
  - `<run-dir>/anon/response-<A..D>.md` + `<run-dir>/anon/mapping.json` (`{"response-A": "<member>", ...}`)
  - stdout: the run-dir path (last line). Env hook for tests: `COUNCIL_MOCK_FAIL=<member>` makes that member fail in mock mode.
  - Helper functions reused by Task 3: `run_with_timeout`, `dispatch_one`, `member_command_string`, `fan_out`.

- [ ] **Step 1: Append failing tests**

Append to `skills/council/scripts/council_test.sh`, **before** the final `echo "ALL TESTS PASSED"` line:

```bash
# --- Task 2: dispatch ---

echo "What is the capital of France? One word." > "$TMP/prompt.md"

# 3. mock dispatch: 4 responses, anonymized, mapping present
run1="$TMP/run1"
"$COUNCIL" --mock --run-dir "$run1" dispatch "$TMP/prompt.md" >/dev/null || fail "mock dispatch rc=$?"
[ -f "$run1/prompt.md" ] || fail "prompt.md not copied into run dir"
[ -f "$run1/anon/mapping.json" ] || fail "mapping.json missing"
count=$(ls "$run1"/anon/response-*.md | wc -l | tr -d ' ')
[ "$count" -eq 4 ] || fail "expected 4 anon responses, got $count"
grep -q '"response-A"' "$run1/anon/mapping.json" || fail "mapping.json lacks response-A key"

# 4. fail-soft: one member fails, council proceeds with 3
run2="$TMP/run2"
COUNCIL_MOCK_FAIL=codex "$COUNCIL" --mock --run-dir "$run2" dispatch "$TMP/prompt.md" >/dev/null \
  || fail "fail-soft dispatch rc=$?"
count=$(ls "$run2"/anon/response-*.md | wc -l | tr -d ' ')
[ "$count" -eq 3 ] || fail "expected 3 anon responses after 1 failure, got $count"
[ -f "$run2/meta/codex.failed" ] || fail "codex failure not recorded in meta/"

# 5. dry-run prints commands and writes no responses
run3="$TMP/run3"
out=$("$COUNCIL" --mock --dry-run --run-dir "$run3" dispatch "$TMP/prompt.md")
echo "$out" | grep -q "codex exec -s read-only" || fail "dry-run missing codex command"
echo "$out" | grep -q "claude -p" || fail "dry-run missing claude command"
[ -z "$(ls -A "$run3/responses" 2>/dev/null)" ] || fail "dry-run wrote responses"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bash skills/council/scripts/council_test.sh`
Expected: FAIL — `council: dispatch: not implemented yet` (rc 70 → test 3 fails)

- [ ] **Step 3: Implement dispatch**

In `skills/council/scripts/council.sh`, replace the line `cmd_dispatch() { die "dispatch: not implemented yet" 70; }` with the following block:

```bash
# Run a command with a wall-clock bound. Uses timeout/gtimeout when
# available, otherwise a bash watcher. Returns the command's exit code
# (143 if killed by the watchdog).
run_with_timeout() {
  local secs="$1"; shift
  if command -v timeout >/dev/null 2>&1; then timeout "$secs" "$@"; return $?; fi
  if command -v gtimeout >/dev/null 2>&1; then gtimeout "$secs" "$@"; return $?; fi
  "$@" &
  local pid=$!
  ( sleep "$secs"; kill -TERM "$pid" 2>/dev/null ) &
  local watcher=$!
  local rc=0
  wait "$pid" || rc=$?
  kill "$watcher" 2>/dev/null || true
  wait "$watcher" 2>/dev/null || true
  return "$rc"
}

# Human-readable command line per member, for --dry-run and cli-matrix parity.
member_command_string() {
  local member="$1" prompt_file="$2"
  case "$member" in
    claude)   printf 'claude -p --allowedTools Read Grep Glob < %s' "$prompt_file" ;;
    codex)    printf 'codex exec -s read-only --skip-git-repo-check - < %s' "$prompt_file" ;;
    gemini)   printf 'gemini --approval-mode plan -o text -p "$(cat %s)"' "$prompt_file" ;;
    opencode) printf 'opencode run --agent plan "$(cat %s)"' "$prompt_file" ;;
    *)        printf 'unknown member: %s' "$member" ;;
  esac
}

# Dispatch one prompt to one member, read-only, bounded. Writes stdout to
# $out_file and stderr to $err_file. Returns the member CLI's exit code.
dispatch_one() {
  local member="$1" prompt_file="$2" out_file="$3" err_file="$4" secs="$5"
  if [ "$MOCK" = "1" ]; then
    if [ "$member" = "${COUNCIL_MOCK_FAIL:-}" ]; then
      echo "mock failure for $member" > "$err_file"
      return 1
    fi
    printf 'MOCK %s response to: %s\n' "$member" "$(head -c 200 "$prompt_file")" > "$out_file"
    return 0
  fi
  case "$member" in
    claude)
      run_with_timeout "$secs" claude -p --allowedTools Read Grep Glob \
        < "$prompt_file" > "$out_file" 2> "$err_file" ;;
    codex)
      run_with_timeout "$secs" codex exec -s read-only --skip-git-repo-check - \
        < "$prompt_file" > "$out_file" 2> "$err_file" ;;
    gemini)
      run_with_timeout "$secs" gemini --approval-mode plan -o text -p "$(cat "$prompt_file")" \
        > "$out_file" 2> "$err_file" ;;
    opencode)
      run_with_timeout "$secs" opencode run --agent plan "$(cat "$prompt_file")" \
        > "$out_file" 2> "$err_file" ;;
    *)
      echo "unknown member: $member" > "$err_file"; return 64 ;;
  esac
}

# Fan one prompt out to all members in parallel; record ok/failed per member.
# Empty output with rc 0 counts as failure ("empty").
fan_out() {
  local prompt_file="$1" out_dir="$2" meta_dir="$3" members="$4"
  local m
  mkdir -p "$out_dir" "$meta_dir"
  for m in $members; do
    (
      rc=0
      dispatch_one "$m" "$prompt_file" "$out_dir/$m.md" "$meta_dir/$m.err" "$TIMEOUT_SECS" || rc=$?
      if [ "$rc" -eq 0 ] && [ -s "$out_dir/$m.md" ]; then
        : > "$meta_dir/$m.ok"
      elif [ "$rc" -eq 0 ]; then
        echo "empty" > "$meta_dir/$m.failed"
        log "$m returned empty output"
      else
        echo "$rc" > "$meta_dir/$m.failed"
        log "$m failed with rc=$rc (stderr: $meta_dir/$m.err)"
      fi
    ) &
  done
  wait
  # Enforce the output cap post-hoc.
  local f size
  for f in "$out_dir"/*.md; do
    size=$(wc -c < "$f" | tr -d ' ')
    if [ "$size" -gt "$OUTPUT_CAP_BYTES" ]; then
      head -c "$OUTPUT_CAP_BYTES" "$f" > "$f.tmp" && mv "$f.tmp" "$f"
      log "truncated $f from $size to $OUTPUT_CAP_BYTES bytes"
    fi
  done
}

# Shuffle non-empty responses into anon/response-<label>.md + mapping.json
# so the chairman and reviewers judge without knowing the authors.
anonymize() {
  local run_dir="$1"
  mkdir -p "$run_dir/anon"
  local labels="A B C D" shuffled f member label first=1
  shuffled=$(find "$run_dir/responses" -type f -name '*.md' -size +0c \
    | awk 'BEGIN{srand()}{print rand() "\t" $0}' | sort -n | cut -f2-)
  {
    printf '{\n'
    for label in $labels; do
      f=$(echo "$shuffled" | sed -n '1p')
      [ -n "$f" ] || break
      shuffled=$(echo "$shuffled" | sed '1d')
      member=$(basename "$f" .md)
      cp "$f" "$run_dir/anon/response-$label.md"
      [ "$first" -eq 1 ] && first=0 || printf ',\n'
      printf '  "response-%s": "%s"' "$label" "$member"
    done
    printf '\n}\n'
  } > "$run_dir/anon/mapping.json"
}

cmd_dispatch() {
  local prompt_file="${1:-}"
  [ -n "$prompt_file" ] && [ -f "$prompt_file" ] || die "dispatch: prompt file required"
  local members
  members=$(discover_members "$MEMBERS")
  require_quorum "$members"

  local run_dir="${RUN_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/council.XXXXXX")}"
  mkdir -p "$run_dir/responses" "$run_dir/meta"
  cp "$prompt_file" "$run_dir/prompt.md"

  if [ "$DRY_RUN" = "1" ]; then
    local m
    for m in $members; do
      printf '%s: %s\n' "$m" "$(member_command_string "$m" "$run_dir/prompt.md")"
    done
    echo "$run_dir"
    return 0
  fi

  log "dispatching to: $members (timeout ${TIMEOUT_SECS}s each)"
  fan_out "$run_dir/prompt.md" "$run_dir/responses" "$run_dir/meta" "$members"

  local collected=0 f
  for f in "$run_dir"/responses/*.md; do
    [ -s "$f" ] && collected=$((collected + 1))
  done
  if [ "$collected" -lt 2 ]; then
    log "only $collected usable response(s); see $run_dir/meta/ for errors"
    echo "$run_dir"
    return 2
  fi

  anonymize "$run_dir"
  log "collected $collected responses; anonymized in $run_dir/anon/"
  echo "$run_dir"
}
```

Note for the implementer: `cmd_dispatch` must appear **after** the helpers in the file (bash resolves functions at call time, but keep definition order helpers → `cmd_dispatch` → `cmd_review` for readability). The `dry-run` branch above requires `mkdir -p "$run_dir/responses"` to have run so test 5's `ls -A` check has a directory to inspect — that is already the case since `mkdir` precedes the branch.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bash skills/council/scripts/council_test.sh`
Expected: `ALL TESTS PASSED`

Run: `bash -n skills/council/scripts/council.sh && shellcheck skills/council/scripts/council.sh skills/council/scripts/council_test.sh`
Expected: clean, same SC2086 note as Task 1 (word-splitting of `$members`/`$labels` is intentional; disable per-line, do not quote).

- [ ] **Step 5: Commit**

```bash
git add skills/council/scripts/council.sh skills/council/scripts/council_test.sh
git commit -m "Add council dispatch: parallel read-only fan-out, fail-soft, anonymization"
```

---

### Task 3: Review — stage 2 anonymized peer ranking

**Files:**
- Modify: `skills/council/scripts/council.sh` (replace `cmd_review` stub)
- Modify: `skills/council/scripts/council_test.sh` (append tests)

**Interfaces:**
- Consumes: Task 2's `fan_out`, run-dir layout (`anon/response-*.md`, `prompt.md`).
- Produces: `cmd_review <run-dir>` → `<run-dir>/review-prompt.md`, `<run-dir>/reviews/<member>.md`, `<run-dir>/reviews-meta/<member>.{ok,failed,err}`. Exit 2 if 0 reviews collected. SKILL.md (Task 5) documents this as the `--full` path.

- [ ] **Step 1: Append failing tests**

Append to `skills/council/scripts/council_test.sh`, before the final `echo "ALL TESTS PASSED"`:

```bash
# --- Task 3: review ---

# 6. mock review over run1: bundle built, one ranking per member
"$COUNCIL" --mock review "$run1" >/dev/null || fail "mock review rc=$?"
[ -f "$run1/review-prompt.md" ] || fail "review-prompt.md missing"
grep -q "response-A" "$run1/review-prompt.md" || fail "bundle lacks anonymized responses"
[ -s "$run1/reviews/claude.md" ] || fail "claude review missing"
count=$(ls "$run1"/reviews/*.md | wc -l | tr -d ' ')
[ "$count" -eq 4 ] || fail "expected 4 reviews, got $count"

# 7. review without a dispatched run dir -> hard error
rc=0
"$COUNCIL" --mock review "$TMP/nonexistent" >/dev/null 2>&1 || rc=$?
[ "$rc" -ne 0 ] || fail "review of missing run dir should fail"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bash skills/council/scripts/council_test.sh`
Expected: FAIL — `council: review: not implemented yet`

- [ ] **Step 3: Implement review**

Replace the line `cmd_review()   { die "review: not implemented yet" 70; }` with:

```bash
# Build the anonymized ranking prompt and fan it out to all members.
cmd_review() {
  local run_dir="${1:-}"
  [ -n "$run_dir" ] && [ -d "$run_dir/anon" ] || \
    die "review: run dir with anon/ responses required (run dispatch first)"

  local bundle="$run_dir/review-prompt.md" f
  {
    echo "You are one anonymous member of an LLM council. Below is a problem"
    echo "and the anonymized responses of all council members (possibly"
    echo "including your own — you cannot tell)."
    echo
    echo "# Original problem"
    echo
    cat "$run_dir/prompt.md"
    for f in "$run_dir"/anon/response-*.md; do
      echo
      echo "# $(basename "$f" .md)"
      echo
      cat "$f"
    done
    echo
    echo "# Your task"
    echo
    echo "Rank the responses from best to worst by factual accuracy and depth"
    echo "of insight. Output exactly one markdown table with columns:"
    echo "rank | response | justification (one sentence). Then one short"
    echo "paragraph: the single most important disagreement between responses."
    echo "Do not speculate about which model wrote which response."
  } > "$bundle"

  local members
  members=$(discover_members "$MEMBERS")
  require_quorum "$members"

  if [ "$DRY_RUN" = "1" ]; then
    local m
    for m in $members; do
      printf '%s: %s\n' "$m" "$(member_command_string "$m" "$bundle")"
    done
    return 0
  fi

  log "requesting rankings from: $members"
  fan_out "$bundle" "$run_dir/reviews" "$run_dir/reviews-meta" "$members"

  local collected=0
  for f in "$run_dir"/reviews/*.md; do
    [ -s "$f" ] && collected=$((collected + 1))
  done
  if [ "$collected" -lt 1 ]; then
    log "no rankings collected; see $run_dir/reviews-meta/"
    return 2
  fi
  log "collected $collected rankings in $run_dir/reviews/"
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bash skills/council/scripts/council_test.sh`
Expected: `ALL TESTS PASSED`

Run: `bash -n skills/council/scripts/council.sh && shellcheck skills/council/scripts/council.sh skills/council/scripts/council_test.sh`
Expected: clean (same intentional SC2086 handling).

- [ ] **Step 5: Commit**

```bash
git add skills/council/scripts/council.sh skills/council/scripts/council_test.sh
git commit -m "Add council review: anonymized peer ranking fan-out"
```

---

### Task 4: `references/cli-matrix.md` — verified per-CLI invocation matrix

**Files:**
- Create: `skills/council/references/cli-matrix.md`

**Interfaces:**
- Consumes: the exact command strings from `member_command_string` (Task 2) — the matrix and the script must never disagree.
- Produces: reference doc loaded by SKILL.md readers when flags need adjusting.

- [ ] **Step 1: Re-verify flags on the installed CLIs**

Run each and confirm the quoted flags exist (they were verified 2026-07-19; re-check in case of upgrades):

```bash
claude --help 2>&1 | grep -E 'allowedTools|--print'
codex exec --help 2>&1 | grep -E 'sandbox|skip-git-repo-check'
gemini --help 2>&1 | grep -E 'approval-mode|--prompt'
opencode run --help 2>&1 | grep -E 'agent|model'
```

Expected: each grep returns at least one matching line. If a flag is missing (CLI upgrade changed it), update BOTH `member_command_string`/`dispatch_one` and this matrix, and re-run `council_test.sh`.

- [ ] **Step 2: Write the matrix**

Create `skills/council/references/cli-matrix.md`:

```markdown
# Council CLI Matrix

Headless, read-only invocations used by `scripts/council.sh`. Verified against
installed versions on 2026-07-19: claude 2.1.215, codex 0.144.6, gemini 0.45.2,
opencode 1.18.3. Product CLIs change — re-verify with `--help` before editing.

| Member | Invocation | Read-only mechanism | Model override |
| --- | --- | --- | --- |
| claude | `claude -p --allowedTools Read Grep Glob < prompt.md` | Tool allowlist; non-listed tools are denied in `--print` mode | `--model <alias>` |
| codex | `codex exec -s read-only --skip-git-repo-check - < prompt.md` | `read-only` sandbox policy; git check skipped so it runs in any directory | `-m <model>` |
| gemini | `gemini --approval-mode plan -o text -p "$(cat prompt.md)"` | `plan` approval mode is read-only | `-m <model>` |
| opencode | `opencode run --agent plan "$(cat prompt.md)"` | Built-in `plan` agent has editing disabled | `-m provider/model` |

## Notes

- Prompt delivery: claude and codex read stdin; gemini and opencode take the
  prompt as an argument (fine for prompts well under ARG_MAX).
- Each member runs with the caller's working directory, so on code questions
  members can explore the repository read-only. Convene from the repo root.
- Timeouts and output caps are enforced by `council.sh`
  (`--timeout`, 65536-byte cap), not by the member CLIs.
- All members must already be authenticated (interactive login done once by
  the user). An unauthenticated CLI fails fail-soft and is recorded in
  `meta/<member>.failed`.
- Not yet supported: antigravity (no CLI installed to verify against). Add a
  row and a `dispatch_one` case once verifiable.
```

- [ ] **Step 3: Commit**

```bash
git add skills/council/references/cli-matrix.md
git commit -m "Add council CLI matrix reference"
```

---

### Task 5: `SKILL.md` — chairman orchestration

**Files:**
- Create: `skills/council/SKILL.md`

**Interfaces:**
- Consumes: `council.sh` subcommands and run-dir layout (Tasks 1–3), cli-matrix (Task 4).
- Produces: the public skill entry point; the personal overlay (Task 7) derives from it.

- [ ] **Step 1: Write SKILL.md**

Create `skills/council/SKILL.md`:

```markdown
---
name: council
description: Convene a council of installed agent CLIs (claude, codex, gemini, opencode) on one hard problem - parallel independent opinions, optional anonymized peer ranking, chairman synthesis. Use for high-stakes decisions, architecture trade-offs, contested reviews, or questions where one model's blind spots matter.
compatibility: Requires at least two authenticated CLIs among claude, codex, gemini, opencode, and a POSIX shell with bash.
---

# Council

Adaptation of the technique in [karpathy/llm-council](https://github.com/karpathy/llm-council):
fan a problem out to several models, optionally let them rank each other's
anonymized answers, then synthesize as chairman. You (the agent reading this)
are the chairman. `scripts/council.sh` handles dispatch mechanics.

## When to convene

- High-stakes or judgment-heavy decisions where a second and third opinion matter.
- Architecture trade-offs and contested code reviews (members explore the repo
  read-only — convene from the repo root).
- NOT for routine questions: a council run costs one call per member per stage.

## Before dispatch: dispatch = publish

The prompt is sent to third-party providers (Google, OpenAI, and others).
Never include secrets, credentials, personal data, or private identifiers.
Recommended practice: rewrite the problem into a self-contained, redacted
prompt and show it to the user before dispatching.

## Pipeline

1. Check the bench: `scripts/council.sh members` (needs >= 2; exit 1 otherwise).
   Tell the user who sits on the council.
2. Write the problem to a prompt file in a temp directory (never in the repo).
   Make it self-contained: the members have no conversation context. State the
   question, constraints, and desired output format.
3. Stage 1 — opinions: `scripts/council.sh dispatch <prompt-file>`.
   The last stdout line is the run directory. Exit 2 means fewer than two
   usable responses: report the contents of `<run-dir>/meta/*.err` verbatim
   and stop — never synthesize from a single opinion as if it were a council.
4. Quick mode (default): skip to step 6.
5. Full mode (only when the user asks for `full` or peer ranking):
   `scripts/council.sh review <run-dir>` — each member ranks the anonymized
   responses; rankings land in `<run-dir>/reviews/`.
6. Stage 3 — synthesis (you, the chairman):
   - Read `<run-dir>/anon/response-*.md` FIRST and form your judgment on the
     anonymized texts (and `reviews/*.md` in full mode).
   - Only then open `anon/mapping.json` to attribute authors.
   - A fresh headless claude sits on the council as a regular member; you are
     not bound to prefer it.

## Synthesis output format

1. **Final answer** — your synthesis, taking the best-supported points.
2. **Disagreement map** — where members diverged and why it matters. If the
   council is unanimous, say so in one line.
3. **Attribution table** — member | position in one sentence (| avg rank, in
   full mode).

## Failure handling

- Exit 1 from any subcommand: fewer than 2 CLIs installed — tell the user
  which members were found and what to install (see references/cli-matrix.md).
- A member's failure or timeout is recorded in `<run-dir>/meta/`; name the
  missing member in your synthesis so the user knows the bench was short.
- Malformed or truncated output: quote it verbatim with a warning; never
  silently drop a member's response.

## Tuning

- `--timeout SECS` (default 300) for slow members; `--members "a b c"` to
  restrict the bench; per-member model overrides: references/cli-matrix.md.
- Mechanics testing without API calls: `council.sh --mock`, `--dry-run`, and
  `scripts/council_test.sh`.
```

- [ ] **Step 2: Validate against the runner**

Run: `bash skills/council/scripts/council_test.sh`
Expected: `ALL TESTS PASSED` (SKILL.md references match actual subcommands/paths — spot-check `members`, `dispatch`, `review`, `anon/mapping.json`, `meta/`, `reviews/` against the script).

- [ ] **Step 3: Commit**

```bash
git add skills/council/SKILL.md
git commit -m "Add council SKILL.md: chairman orchestration"
```

---

### Task 6: Repo integration, live smoke test, pre-commit

**Files:**
- Modify: `README.md` (skills table)
- Modify: `CHANGELOG.md` (new entry, follow the file's existing format)

**Interfaces:**
- Consumes: the finished skill (Tasks 1–5).
- Produces: a branch ready for review/merge; live verification evidence.

- [ ] **Step 1: README table row**

In `README.md`, add to the "Available Skills" table, keeping alphabetical order (before `data-news`):

```markdown
| `council` | Convene installed agent CLIs as a multi-model council with anonymized peer review. |
```

- [ ] **Step 2: CHANGELOG entry**

Read `CHANGELOG.md`, follow its existing heading/format conventions, and add an entry: added `council` skill — multi-model council over headless agent CLIs (dispatch, anonymized peer ranking, chairman synthesis), adapted from karpathy/llm-council.

- [ ] **Step 3: Live smoke test (real CLIs, small prompt)**

```bash
SMOKE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/council-smoke.XXXXXX")
printf 'Reply with exactly one word: ready\n' > "$SMOKE_DIR/smoke.md"
skills/council/scripts/council.sh --timeout 120 --run-dir "$SMOKE_DIR/run" dispatch "$SMOKE_DIR/smoke.md"
ls "$SMOKE_DIR/run/responses/" "$SMOKE_DIR/run/anon/"
```

Expected: exit 0, >= 2 non-empty `responses/*.md`, `anon/mapping.json` present.
This is the representative-conditions verification — do not claim the skill
works from mock tests alone. If a member fails (e.g. not authenticated),
record which one in the final report; >= 2 survivors still passes.
If `opencode` fails with an unknown-agent error, replace `--agent plan` with
the current read-only agent name per `opencode run --help`, update
`dispatch_one`, `member_command_string`, and `references/cli-matrix.md`, and
re-run this smoke test.

- [ ] **Step 4: Pre-commit and final checks**

```bash
pre-commit run --all-files
bash -n skills/council/scripts/council.sh
shellcheck skills/council/scripts/*.sh
```

Expected: all pass. Fix anything flagged, re-run until clean.

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "Register council skill in README and CHANGELOG"
```

---

### Task 7: Personal overlay in the private prompts repo (redaction gate, Polish)

**Files (in the user's private prompts repo — not published in this repo):**
- `skills/council/SKILL.md` (personal variant)
- `skills/council/scripts/council.sh`, `scripts/council_test.sh` (copies)
- `skills/council/references/cli-matrix.md` (copy)

**Interfaces:**
- Consumes: the public skill from this repo (Tasks 1–5).
- Produces: standalone personal variant in the private prompts repo; no edits to mind/atlas/pair-programmer skills (explicit design decision).

**Summary:** The personal overlay is maintained in the user's private prompts
repo and is intentionally not reproduced here. It layers a mandatory
pre-dispatch redaction gate (default ON — rewrite the problem to strip
personal identifiers, show the redacted prompt to the user, and wait for
explicit approval before dispatching) and Polish-language synthesis output on
top of the same pipeline as the public skill. Content is private by design;
see the private repo directly for the exact wording.

- [ ] **Step 1: Copy runner and references into the private prompts repo**

Copy `scripts/` and `references/` from this repo's `skills/council/` into the
private prompts repo's `skills/council/`.

- [ ] **Step 2: Write the personal SKILL.md**

Author the personal `SKILL.md` in the private prompts repo: same pipeline as
the public skill, plus the redaction gate and Polish synthesis described
above. Content lives only in the private repo.

- [ ] **Step 3: Verify the copy works in place**

Run the copied `council_test.sh` from its location in the private prompts
repo. Expected: `ALL TESTS PASSED`

- [ ] **Step 4: Commit in the private prompts repo (if it is a git repo)**

If it is a git repo, commit the `skills/council` addition there with a plain
message. If it is not a git repo, skip the commit and note that in the final
report.

---

## Verification summary (whole plan)

- `bash skills/council/scripts/council_test.sh` — 7 assertions, mock/dry-run only.
- `shellcheck` + `bash -n` on both shell files.
- `pre-commit run --all-files` clean.
- Live smoke test with real CLIs produced >= 2 responses (Task 6, step 3).
- Personal copy self-test passes from its llm-prompts location (Task 7, step 3).
