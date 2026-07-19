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

KNOWN_MEMBERS="agy claude codex gemini opencode"
TIMEOUT_SECS=300
OUTPUT_CAP_BYTES=65536
# gemini/opencode receive the prompt as a single argv argument (not stdin).
# On Linux, MAX_ARG_STRLEN caps any single argument at ~128 KiB regardless of
# overall ARG_MAX; warn (not block) above this size so a fail-soft failure is
# understood rather than mysterious.
ARG_SIZE_WARN_BYTES=100000
MOCK=0
DRY_RUN=0
MEMBERS="$KNOWN_MEMBERS"
MEMBERS_EXPLICIT=0
RUN_DIR=""

log() { printf 'council: %s\n' "$*" >&2; }
die() { log "$1"; exit "${2:-1}"; }

usage() {
  cat >&2 <<'EOF'
Usage: council.sh [flags] <subcommand> [args] [flags]

Flags may appear before and/or after the subcommand, e.g. both of these work:
  council.sh --timeout 60 dispatch prompt.md
  council.sh dispatch prompt.md --timeout 60

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

# Provider-duplicate preferences for the DEFAULT bench: agy supersedes gemini
# (same Google seat; gemini CLI additionally hangs on interactive auth when
# its tier is dead), and codex supersedes opencode (opencode's default
# configuration commonly resolves to the same provider as codex). An explicit
# --members list is honored verbatim — pass one to seat both members of a
# pair, e.g. when opencode is configured for a distinct provider.
apply_bench_preferences() {
  local members=" $1 " dropped=""
  if [ "${members#* agy }" != "$members" ] && [ "${members#* gemini }" != "$members" ]; then
    members="${members/ gemini / }"
    dropped="$dropped gemini(superseded by agy)"
  fi
  if [ "${members#* codex }" != "$members" ] && [ "${members#* opencode }" != "$members" ]; then
    members="${members/ opencode / }"
    dropped="$dropped opencode(superseded by codex)"
  fi
  if [ -n "$dropped" ]; then
    log "bench preferences dropped:$dropped — pass --members to override"
  fi
  members="${members# }"
  echo "${members% }"
}

# Discovery + default-bench preferences in one step. Every subcommand uses
# this instead of calling discover_members directly.
resolve_bench() {
  local members
  members=$(discover_members "$MEMBERS")
  if [ "$MEMBERS_EXPLICIT" = "0" ]; then
    members=$(apply_bench_preferences "$members")
  fi
  echo "$members"
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
  members=$(resolve_bench)
  require_quorum "$members"
  # shellcheck disable=SC2086
  printf '%s\n' $members
}

# Run a command with a wall-clock bound. Uses timeout/gtimeout when
# available, otherwise a bash watcher. Returns the command's exit code
# (143 if killed by the watchdog).
run_with_timeout() {
  local secs="$1"; shift
  if command -v timeout >/dev/null 2>&1; then timeout "$secs" "$@"; return $?; fi
  if command -v gtimeout >/dev/null 2>&1; then gtimeout "$secs" "$@"; return $?; fi
  # 0<&0 makes stdin inheritance explicit: with job control off (the norm in
  # scripts), bash detaches an async command's stdin unless told otherwise,
  # which silently starves stdin-consuming members (claude, codex).
  "$@" 0<&0 &
  local pid=$!
  # TERM first, then KILL after a 5 s grace period: interactive/auth prompts
  # in member CLIs have been observed to survive a lone TERM (readline traps),
  # which would make wait below unbounded. KILL cannot be trapped.
  ( sleep "$secs"; kill -TERM "$pid" 2>/dev/null; sleep 5; kill -KILL "$pid" 2>/dev/null ) &
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
  # shellcheck disable=SC2016  # the $(cat %s) in single quotes is intentional: human-readable command string for --dry-run
  case "$member" in
    agy)      printf 'agy --mode plan -p "$(cat %s)"' "$prompt_file" ;;
    claude)   printf 'claude -p --allowedTools Read Grep Glob --disallowedTools Bash Edit Write NotebookEdit WebFetch WebSearch Task < %s' "$prompt_file" ;;
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
      # Real CLIs have been observed to emit partial output (e.g. an
      # interactive auth prompt) before failing; the mock mirrors that.
      printf 'partial mock output from %s before failure\n' "$member" > "$out_file"
      echo "mock failure for $member" > "$err_file"
      return 1
    fi
    printf 'MOCK %s response to: %s\n' "$member" "$(head -c 200 "$prompt_file")" > "$out_file"
    return 0
  fi
  case "$member" in
    agy|gemini|opencode)
      local size
      size=$(wc -c < "$prompt_file" | tr -d ' ')
      if [ "$size" -gt "$ARG_SIZE_WARN_BYTES" ]; then
        log "$member: prompt is ${size} bytes (> ${ARG_SIZE_WARN_BYTES}); $member takes the prompt as a single argv argument and may fail on Linux due to the per-argument MAX_ARG_STRLEN limit (~128 KiB)"
      fi
      ;;
  esac
  case "$member" in
    agy)
      run_with_timeout "$secs" agy --mode plan -p "$(cat "$prompt_file")" \
        < /dev/null > "$out_file" 2> "$err_file" ;;
    claude)
      run_with_timeout "$secs" claude -p --allowedTools Read Grep Glob \
        --disallowedTools Bash Edit Write NotebookEdit WebFetch WebSearch Task \
        < "$prompt_file" > "$out_file" 2> "$err_file" ;;
    codex)
      run_with_timeout "$secs" codex exec -s read-only --skip-git-repo-check - \
        < "$prompt_file" > "$out_file" 2> "$err_file" ;;
    gemini)
      run_with_timeout "$secs" gemini --approval-mode plan -o text -p "$(cat "$prompt_file")" \
        < /dev/null > "$out_file" 2> "$err_file" ;;
    opencode)
      run_with_timeout "$secs" opencode run --agent plan "$(cat "$prompt_file")" \
        < /dev/null > "$out_file" 2> "$err_file" ;;
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
  # shellcheck disable=SC2086
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
        if [ -s "$out_dir/$m.md" ]; then
          # A failed member's partial output must not enter the anonymized
          # council set; preserve it for diagnosis instead of dropping it.
          mv "$out_dir/$m.md" "$meta_dir/$m.partial"
          log "$m failed with rc=$rc; partial output preserved in $meta_dir/$m.partial"
        else
          log "$m failed with rc=$rc (stderr: $meta_dir/$m.err)"
        fi
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
  local labels="A B C D E" shuffled f member label first=1
  shuffled=$(find "$run_dir/responses" -type f -name '*.md' -size +0c \
    | awk 'BEGIN{srand()}{print rand() "\t" $0}' | sort -n | cut -f2-)
  {
    printf '{\n'
    # shellcheck disable=SC2086
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
  if [ -n "$shuffled" ]; then
    log "warning: more responses than anonymization labels ($labels); not anonymized: $shuffled"
  fi
}

cmd_dispatch() {
  local prompt_file="${1:-}"
  [ -n "$prompt_file" ] && [ -f "$prompt_file" ] || die "dispatch: prompt file required"
  local members
  members=$(resolve_bench)
  require_quorum "$members"

  local run_dir="${RUN_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/council.XXXXXX")}"
  mkdir -p "$run_dir/responses" "$run_dir/meta"
  cp "$prompt_file" "$run_dir/prompt.md"

  # Pin the member role. Members are full agent CLIs and may have their own
  # Agent Skills installed — including this council skill itself, in which
  # case a council-shaped brief makes the member role-play the chairman and
  # answer with a consent gate instead of an opinion (observed live with
  # codex). The preamble forbids that explicitly.
  {
    echo "You are one independent member of a multi-model council. Answer the"
    echo "problem below directly, as a single expert opinion, in your own words."
    echo "Do NOT invoke any council or committee skill, tool, or workflow of"
    echo "your own; do not convene other models; do not display a consent or"
    echo "approval gate (the operator already approved this dispatch); do not"
    echo "ask for further input. Just answer the problem."
    echo
    echo "# Problem"
    echo
    cat "$run_dir/prompt.md"
  } > "$run_dir/member-prompt.md"

  if [ "$DRY_RUN" = "1" ]; then
    local m
    for m in $members; do
      printf '%s: %s\n' "$m" "$(member_command_string "$m" "$run_dir/member-prompt.md")"
    done
    echo "$run_dir"
    return 0
  fi

  log "dispatching to: $members (timeout ${TIMEOUT_SECS}s each)"
  fan_out "$run_dir/member-prompt.md" "$run_dir/responses" "$run_dir/meta" "$members"

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
    echo "Do NOT invoke any council or committee skill, tool, or workflow of"
    echo "your own; do not display a consent or approval gate; answer directly."
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
  members=$(resolve_bench)
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

main() {
  # Flags may appear before AND after the subcommand: keep parsing --flags
  # for the whole argument list while collecting the subcommand and any
  # positional args (e.g. the prompt-file for dispatch) separately.
  local subcommand="" args=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --members)
        [ $# -ge 2 ] || die "missing value for $1"
        MEMBERS="$2"; MEMBERS_EXPLICIT=1; shift 2 ;;
      --timeout)
        [ $# -ge 2 ] || die "missing value for $1"
        TIMEOUT_SECS="$2"; shift 2 ;;
      --run-dir)
        [ $# -ge 2 ] || die "missing value for $1"
        RUN_DIR="$2"; shift 2 ;;
      --mock)    MOCK=1; shift ;;
      --dry-run) DRY_RUN=1; shift ;;
      -h|--help) usage ;;
      -*) log "unknown argument: $1"; usage ;;
      members|dispatch|review)
        if [ -z "$subcommand" ]; then subcommand="$1"; else args+=("$1"); fi
        shift ;;
      *) args+=("$1"); shift ;;
    esac
  done
  case "$subcommand" in
    members)  cmd_members "${args[@]+"${args[@]}"}" ;;
    dispatch) cmd_dispatch "${args[@]+"${args[@]}"}" ;;
    review)   cmd_review "${args[@]+"${args[@]}"}" ;;
    *) usage ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi
