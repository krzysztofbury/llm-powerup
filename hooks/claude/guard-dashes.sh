#!/usr/bin/env bash
set -euo pipefail

# Refuses Edit, MultiEdit and Write calls that add em or en dashes: content the
# user authors uses plain hyphens only. Only dashes the call adds count, so
# editing text that already holds dashes still works. Style rule, so a parse
# failure lets the call through instead of prompting.

command -v jq >/dev/null 2>&1 || exit 0
input=$(cat)
added=$(jq -r '
  def dashes: if type == "string" then [scan("[\u2013\u2014]")] | length else 0 end;
  .tool_input as $t
  | if .tool_name == "Write" then ($t.content | dashes)
    elif .tool_name == "Edit" then ($t.new_string | dashes) - ($t.old_string | dashes)
    elif .tool_name == "MultiEdit" then [($t.edits // [])[] | (.new_string | dashes) - (.old_string | dashes)] | add // 0
    else 0 end
' <<<"$input" 2>/dev/null) || exit 0
[[ "$added" =~ ^-?[0-9]+$ ]] || exit 0

if [[ "$(jq -r '.tool_name // empty' <<<"$input")" == Write ]]; then
  file=$(jq -r '.tool_input.file_path // empty' <<<"$input")
  if [[ -n "$file" && -f "$file" && -r "$file" ]]; then
    existing=$(jq -Rrs '[scan("[\u2013\u2014]")] | length' -- "$file" 2>/dev/null) || existing=0
    [[ "$existing" =~ ^[0-9]+$ ]] || existing=0
    added=$(( added - existing ))
  fi
fi
(( added > 0 )) || exit 0

jq -cn --arg n "$added" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: ("This change adds " + $n + " em/en dash(es) (U+2014, U+2013). Use a plain hyphen (-) instead and retry. If a literal dash is required, write it as an escape such as \\u2014 or ask the user.")
  }
}'
