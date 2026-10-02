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
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty')
session_id=$(printf '%s' "$input" | jq -r '.session_id // empty')

hook_path=$(readlink -f -- "${BASH_SOURCE[0]}" 2>/dev/null) || hook_path=${BASH_SOURCE[0]}
# shellcheck source-path=SCRIPTDIR source=command-scan.sh
source "${hook_path%/*}/command-scan.sh" 2>/dev/null \
  || ask "Hook helper command-scan.sh is missing; review this command manually."

# This is a confirmation gate, not a sandbox. It inspects each simple command
# the lexer finds; anything it cannot resolve requests confirmation.
cs_scan "$command" || ask "Could not split the Bash command into simple commands; review it manually."
cs_context "$cwd" "$session_id"

# Global options and their values, e.g. git -C repo-dir or kubectl --context prod-eu.
global_flags='([[:space:]]+-[^[:space:]]+([[:space:]]+[^[:space:]-][^[:space:]]*)?)*'
sql_clients='psql|mysql|mariadb|sqlite3|pgcli|mycli|cockroach|clickhouse-client|sqlcmd|usql'
sql_client_seen=false

for segment in $(cs_segments); do
  if cs_invocation "$segment" 'cd|pushd|popd'; then
    CS_CWD_OK=false
    continue
  fi
  if cs_invocation "$segment" 'rm|rmdir'; then
    [[ ! "$CS_WRAPPER" =~ ^(xargs|parallel)$ ]] \
      || ask "xargs-driven rm deletes files; confirm the target and scope."
    cs_rm_safe "$segment" || ask "rm deletes files; confirm the target and scope."
  fi
  if cs_invocation "$segment" find; then
    cs_find_safe "$segment" || ask "$CS_REASON"
  fi
  if cs_invocation "$segment" git; then
    cs_text "$segment"
    if [[ "$CS_TEXT" =~ ^git${global_flags}[[:space:]]+(reset[[:space:]](.*[[:space:]])?--hard([[:space:]]|$)|clean[[:space:]](.*[[:space:]])?(-[a-zA-Z]*f|--force)|(checkout|restore)([[:space:]]+[^[:space:]]+)*[[:space:]]+\.([[:space:]]|$)|push[[:space:]](.*[[:space:]])?(--force|-[a-zA-Z]*f[a-zA-Z]*|\+[^[:space:]]+)([[:space:]]|$)) ]]; then
      ask "Git command can discard work or rewrite remote history."
    fi
  fi
  if cs_invocation "$segment" "$sql_clients"; then
    case "${CS_WORDS[CS_I]##*/}" in
      psql) cs_pg_dev_target "$segment" || sql_client_seen=true ;;
      sqlite3) cs_sqlite_local "$segment" || sql_client_seen=true ;;
      *) sql_client_seen=true ;;
    esac
  fi
  if cs_invocation "$segment" kubectl && cs_has_word "$segment" delete; then
    ask "Infrastructure command may remove resources."
  fi
  if cs_invocation "$segment" terraform && cs_has_word "$segment" destroy; then
    ask "Infrastructure command may remove resources."
  fi
  if cs_invocation "$segment" docker; then
    cs_text "$segment"
    if [[ "$CS_TEXT" =~ ^docker${global_flags}[[:space:]]+(system[[:space:]]+prune|volume[[:space:]]+(rm|prune)) ]]; then
      ask "Infrastructure command may remove resources."
    fi
    # Removing a local container is routine; removing its volumes or acting
    # on a remote daemon is not.
    if [[ "$CS_TEXT" =~ ^docker${global_flags}[[:space:]]+(container[[:space:]]+)?rm([[:space:]]|$) ]] \
      && [[ "$CS_TEXT" =~ [[:space:]](--volumes|-[a-zA-Z]*v[a-zA-Z]*|-H|--host|--context)([[:space:]=]|$) \
        || "$command" == *DOCKER_HOST=* ]]; then
      ask "Docker command removes volumes or targets a remote daemon."
    fi
  fi
done

# Heredocs and pipes can carry the SQL text away from the client, so the
# keywords are checked against the whole command once a gated client runs.
if [[ "$sql_client_seen" == true ]]; then
  upper_command=$(printf '%s' "$command" | tr '[:lower:]' '[:upper:]')
  if [[ "$upper_command" =~ (DROP|TRUNCATE|DELETE[[:space:]]+FROM|UPDATE|INSERT[[:space:]]+INTO|ALTER[[:space:]]+TABLE|CREATE[[:space:]]+(TABLE|INDEX|SCHEMA)|VACUUM[[:space:]]+FULL|REINDEX)[[:space:]] ]]; then
    ask "SQL command may change data or schema."
  fi
fi

exit 0
