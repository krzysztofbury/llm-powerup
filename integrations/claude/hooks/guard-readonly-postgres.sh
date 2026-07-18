#!/usr/bin/env bash
set -euo pipefail

ask() {
  local reason=$1

  if command -v jq >/dev/null 2>&1; then
    jq -cn --arg reason "$reason" '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: $reason
      }
    }'
  else
    printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"PostgreSQL command requires manual review."}}'
  fi
}

if ! command -v jq >/dev/null 2>&1; then
  ask "jq is required to inspect PostgreSQL commands safely."
  exit 0
fi

input=$(cat)
if ! command=$(printf '%s' "$input" | jq -er '.tool_input.command // empty'); then
  ask "Could not inspect the PostgreSQL command."
  exit 0
fi

[[ "$command" =~ (^|[[:space:];\|&])([^[:space:]]*/)?psql([[:space:]]|$) ]] || exit 0

# A command/file/piped query cannot be safely inspected by this lightweight hook.
if [[ "$command" =~ (^|[[:space:]])(-f|--file|--command-file)([[:space:]=]|$) ]] \
  || [[ "$command" =~ (echo|cat|printf)[[:space:]].*\|[[:space:]]*psql ]]; then
  ask "PostgreSQL input is not an inspectable inline query; confirm it is read-only."
  exit 0
fi

flag_occurrence_pattern='(^|[[:space:];\|&])(-c|--command)'
flag_count=$(printf '%s' "$command" | { grep -oE "$flag_occurrence_pattern" || true; } | wc -l | tr -d '[:space:]')

# Multiple -c/--command flags (on one psql invocation, or across psql
# invocations chained with &&/;/|) cannot be safely reduced to a single
# query; fail closed rather than only inspecting the first.
if [[ "$flag_count" -gt 1 ]]; then
  ask "Multiple -c/--command flags cannot be safely inspected; confirm each query is read-only."
  exit 0
fi

double_quote_pattern='(^|[[:space:]])(-c|--command)[[:space:]=]+"([^"]*)"'
single_quote_pattern="(^|[[:space:]])(-c|--command)[[:space:]=]+'([^']*)'"
query=""

if [[ "$command" =~ $double_quote_pattern ]]; then
  query=${BASH_REMATCH[3]}
elif [[ "$command" =~ $single_quote_pattern ]]; then
  query=${BASH_REMATCH[3]}
fi

if [[ -z "$query" ]]; then
  ask "Could not inspect the PostgreSQL query; confirm it is read-only."
  exit 0
fi

if [[ "$command" =~ PGPASSWORD= ]] \
  || [[ "$command" =~ postgresql://[^[:space:]@]+:[^[:space:]@]+@ ]]; then
  ask "PostgreSQL command appears to contain credentials; use a secret-managed profile instead."
  exit 0
fi

upper_query=$(printf '%s' "$query" | tr '[:lower:]' '[:upper:]')

# WITH can contain data-modifying CTEs. Require confirmation rather than trying
# to parse SQL in a shell hook.
if [[ ! "$upper_query" =~ ^[[:space:]]*(SELECT|SHOW|EXPLAIN)[[:space:]] ]] \
  || [[ "$upper_query" =~ EXPLAIN[[:space:]]+ANALYZE ]] \
  || [[ "$upper_query" =~ \;[[:space:]]*[^[:space:]] ]] \
  || [[ "$upper_query" =~ [[:space:]](INTO|FOR[[:space:]]+(UPDATE|SHARE)|NO[[:space:]]+KEY[[:space:]]+UPDATE)[[:space:]] ]] \
  || [[ "$upper_query" =~ (^|[^[:alnum:]_])(PG_TERMINATE_BACKEND|PG_CANCEL_BACKEND|PG_ADVISORY_LOCK|PG_TRY_ADVISORY_LOCK|PG_RELOAD_CONF|PG_ROTATE_LOGFILE|PG_CREATE_RESTORE_POINT|PG_LOGICAL_EMIT_MESSAGE|PG_SLEEP|NEXTVAL|SETVAL|SET_CONFIG|DBLINK_CONNECT|DBLINK_EXEC|PG_READ_FILE|PG_READ_BINARY_FILE|LO_IMPORT|LO_EXPORT)([^[:alnum:]_]|$) ]]; then
  ask "PostgreSQL command is not a clearly read-only diagnostic; confirm scope and use a reviewed query."
fi
