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
    printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"Hook parser unavailable; review this command manually."}}'
  fi
  exit 0
}

command -v jq >/dev/null 2>&1 || ask "jq is required to inspect Bash commands safely."
input=$(cat)
command=$(printf '%s' "$input" | jq -er '.tool_input.command // empty') \
  || ask "Could not inspect the Bash command."
[[ -n "$command" ]] || ask "Bash command is empty or unavailable."
shopt -s nocasematch

# This is deliberately conservative. It is a confirmation gate, not a parser.
if [[ "$command" =~ (^|[[:space:];\\|&])(sudo[[:space:]]+)?(command[[:space:]]+)?(/usr/bin/|/bin/)?rm[[:space:]] ]]; then
  if [[ "$command" =~ (^|[[:space:]])(--recursive|--force)([[:space:]]|$) ]] \
    || [[ "$command" =~ (^|[[:space:]])-[a-zA-Z]*[rf][a-zA-Z]*([[:space:]]|$) ]] \
    || [[ "$command" =~ rm[[:space:]]([^;&|]*)[*?] ]]; then
    ask "rm deletes files; confirm the target and scope."
  fi
fi
if [[ "$command" =~ xargs.*[[:space:]]rm([[:space:]]|$) ]]; then
  ask "xargs-driven rm deletes files; confirm the target and scope."
fi
if [[ "$command" =~ (^|[[:space:];\|&])rmdir[[:space:]] ]]; then
  ask "rmdir deletes directories; confirm the target and scope."
fi
if [[ "$command" =~ find[[:space:]].*-delete([[:space:]]|$) ]]; then
  ask "find -delete removes files; confirm the target and scope."
fi
if [[ "$command" =~ git[[:space:]]+reset.*--hard|git[[:space:]]+clean.*(-[a-zA-Z]*f|--force)|git[[:space:]]+(checkout|restore)([[:space:]]+[^[:space:]]+)*[[:space:]]+\.([[:space:]]|$)|git[[:space:]]+push.*(--force([[:space:]]|$)|-f([[:space:]]|$)) ]]; then
  ask "Git command can discard work or rewrite remote history."
fi
if [[ "$command" =~ (psql|mysql|mariadb|sqlite3|pgcli|mycli|cockroach|clickhouse-client|sqlcmd|usql) ]] \
  && [[ "$command" =~ (DROP|TRUNCATE|DELETE[[:space:]]+FROM|UPDATE|INSERT[[:space:]]+INTO|ALTER[[:space:]]+TABLE|CREATE[[:space:]]+(TABLE|INDEX|SCHEMA)|VACUUM[[:space:]]+FULL|REINDEX)[[:space:]] ]]; then
  ask "SQL command may change data or schema."
fi
if [[ "$command" =~ kubectl[[:space:]]+delete|terraform[[:space:]]+destroy|docker[[:space:]]+(system[[:space:]]+prune|rm|volume[[:space:]]+rm) ]]; then
  ask "Infrastructure command may remove resources."
fi

exit 0
