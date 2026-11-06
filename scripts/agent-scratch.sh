#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: agent-scratch [--root DIRECTORY] -- COMMAND [ARGUMENT...]

Runs one command with a private disposable directory. AGENT_SCRATCH_DIR,
TMPDIR, TMP, and TEMP point there. Default root: ${TMPDIR:-/tmp}.
Copy retained reports outside the directory before the command exits.
Do not start background work that outlives the command.
EOF
}

scratch_root=${TMPDIR:-/tmp}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --root)
      [[ $# -ge 2 && -n "$2" ]] || { usage >&2; exit 2; }
      scratch_root=$2
      shift 2
      ;;
    --)
      shift
      break
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *) usage >&2; exit 2 ;;
  esac
done
[[ $# -gt 0 ]] || { usage >&2; exit 2; }

mkdir -p -- "$scratch_root"
scratch_root=$(cd "$scratch_root" && pwd -P)
umask 077
scratch=$(mktemp -d "$scratch_root/agent-task.XXXXXXXX")
child_pid=

# shellcheck disable=SC2329  # invoked through trap
cleanup() {
  local status=$?
  trap - EXIT
  # A command that leaves descendants running must not lose their files.
  if [[ -n "$child_pid" ]] && kill -0 -- "-$child_pid" 2>/dev/null; then
    printf 'Scratch retained: task processes still running: %s\n' "$scratch" >&2
    [[ "$status" -ne 0 ]] || status=1
  elif [[ -L "$scratch" || ! -d "$scratch" ]]; then
    printf 'Scratch path changed; refusing cleanup: %s\n' "$scratch" >&2
    [[ "$status" -ne 0 ]] || status=1
  elif ! rm -rf -- "$scratch"; then
    printf 'Scratch cleanup failed; inspect retained files: %s\n' "$scratch" >&2
    [[ "$status" -ne 0 ]] || status=1
  fi
  exit "$status"
}
trap cleanup EXIT

# shellcheck disable=SC2329  # invoked through trap
cancel() {
  local signal=$1
  local status=$2
  trap '' HUP INT TERM
  if [[ -n "$child_pid" ]]; then
    kill -s "$signal" -- "-$child_pid" 2>/dev/null || true
    wait "$child_pid" 2>/dev/null || true
  fi
  exit "$status"
}
trap 'cancel HUP 129' HUP
trap 'cancel INT 130' INT
trap 'cancel TERM 143' TERM

export AGENT_SCRATCH_DIR="$scratch" TMPDIR="$scratch" TMP="$scratch" TEMP="$scratch"
# Job control gives the command its own process group on Linux and macOS.
# This lets cancellation reach its descendants without signaling the caller.
set -m
"$@" &
child_pid=$!
if wait "$child_pid"; then
  status=0
else
  status=$?
fi
exit "$status"
