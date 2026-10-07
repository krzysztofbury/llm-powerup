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
  exit 0
}

command -v jq >/dev/null 2>&1 || ask "jq is required to inspect PostgreSQL commands safely."
input=$(cat)
command=$(printf '%s' "$input" | jq -er '.tool_input.command // empty') \
  || ask "Could not inspect the PostgreSQL command."
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty')
session_id=$(printf '%s' "$input" | jq -r '.session_id // empty')

# Cheap exit for the common case: no psql anywhere in the command.
[[ "$command" == *psql* ]] || exit 0

hook_path=$(readlink -f -- "${BASH_SOURCE[0]}" 2>/dev/null) || hook_path=${BASH_SOURCE[0]}
# shellcheck source-path=SCRIPTDIR source=command-scan.sh
source "${hook_path%/*}/command-scan.sh" 2>/dev/null \
  || ask "Hook helper command-scan.sh is missing; review this command manually."
cs_scan "$command" || ask "Could not inspect the PostgreSQL command."
cs_context "$cwd" "$session_id"

credentials_inline() {
  [[ "$command" =~ PGPASSWORD=|password[[:space:]]*= ]] || [[ "$command" =~ postgres(ql)?://[^[:space:]@/]+:[^[:space:]@]+@ ]]
}

# Sets query to the single -c/--command value of the psql invocation at CS_I.
# Returns 1 with a reason when the input cannot be inspected.
inspect_invocation() {
  local segment=$1 j end w count=0 info=false
  end=${CS_END[segment]}
  query=""
  for ((j = CS_I + 1; j < end; j++)); do
    w=${CS_WORDS[j]}
    case "$w" in
      -c|--command)
        count=$((count + 1)); j=$((j + 1))
        (( j < end )) || { reason="Could not inspect the PostgreSQL query; confirm it is read-only."; return 1; }
        [[ "${CS_FLAGS[j]}" != *d* ]] || { reason="PostgreSQL query contains shell expansion; confirm it is read-only."; return 1; }
        query=${CS_WORDS[j]}
        ;;
      --command=*|-c?*)
        count=$((count + 1))
        [[ "${CS_FLAGS[j]}" != *d* ]] || { reason="PostgreSQL query contains shell expansion; confirm it is read-only."; return 1; }
        if [[ "$w" == --command=* ]]; then query=${w#*=}; else query=${w#-c}; fi
        ;;
      -f|--file|--file=*|-f?*)
        reason="PostgreSQL input is not an inspectable inline query; confirm it is read-only."
        return 1
        ;;
      -V|--version|-\?|--help|--help=*|-l|--list) info=true ;;
      -h|--host|-p|--port|-d|--dbname|-U|--username|-v|--set|--variable|-o|--output|-L|--log-file|-F|--field-separator|-R|--record-separator|-P|--pset|-T|--table-attr) j=$((j + 1)) ;;
    esac
  done
  if (( count > 1 )); then
    reason="Multiple -c/--command flags cannot be safely inspected; confirm each query is read-only."
    return 1
  fi
  if (( count == 0 )); then
    [[ "$info" == true ]] && return 0
    reason="Could not inspect the PostgreSQL query; confirm it is read-only."
    return 1
  fi
}

read_only_query() {
  local upper
  # psql describe and list meta-commands, e.g. \dt, \d+ users, \l, \conninfo.
  [[ "$query" =~ ^[[:space:]]*\\(d[A-Za-z]*\+?|l\+?|conninfo)([[:space:]]+[^\\\;]*)?[[:space:]]*$ ]] && return 0
  upper=$(printf '%s' "$query" | tr '[:lower:]' '[:upper:]')
  # WITH can contain data-modifying CTEs. Require confirmation rather than
  # trying to parse SQL in a shell hook.
  if [[ ! "$upper" =~ ^[[:space:]]*(SELECT|SHOW|EXPLAIN)[[:space:]] ]] \
    || [[ "$upper" =~ EXPLAIN[[:space:]]+(ANALYZE|\([^\)]*ANALYZE) ]] \
    || [[ "$upper" =~ \;[[:space:]]*[^[:space:]] ]] \
    || [[ "$upper" =~ [[:space:]](INTO|FOR[[:space:]]+(UPDATE|SHARE)|NO[[:space:]]+KEY[[:space:]]+UPDATE)[[:space:]] ]] \
    || [[ "$upper" =~ (^|[^[:alnum:]_])(PG_TERMINATE_BACKEND|PG_CANCEL_BACKEND|PG_ADVISORY_LOCK|PG_TRY_ADVISORY_LOCK|PG_RELOAD_CONF|PG_ROTATE_LOGFILE|PG_CREATE_RESTORE_POINT|PG_LOGICAL_EMIT_MESSAGE|PG_SLEEP|NEXTVAL|SETVAL|SET_CONFIG|DBLINK_CONNECT|DBLINK_EXEC|PG_READ_FILE|PG_READ_BINARY_FILE|LO_IMPORT|LO_EXPORT)([^[:alnum:]_]|$) ]]; then
    return 1
  fi
}

for segment in $(cs_segments); do
  cs_invocation "$segment" psql || continue
  if credentials_inline; then
    ask "PostgreSQL command appears to contain credentials; use a secret-managed profile instead."
  fi
  # An allowlisted development database may be changed freely.
  cs_pg_dev_target "$segment" && continue
  reason=""
  inspect_invocation "$segment" || ask "$reason"
  [[ -z "$query" ]] || read_only_query \
    || ask "PostgreSQL command is not a clearly read-only diagnostic; confirm scope and use a reviewed query."
done

exit 0
