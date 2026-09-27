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
    printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"External-impact command requires manual review."}}'
  fi
}

if ! command -v jq >/dev/null 2>&1; then
  ask "jq is required to inspect Bash commands safely."
  exit 0
fi

input=$(cat)
if ! command=$(printf '%s' "$input" | jq -er '.tool_input.command // empty'); then
  ask "Could not inspect the Bash command."
  exit 0
fi

shopt -s nocasematch
global_flags='([[:space:]]+--?[^[:space:];|&]+([[:space:]]+[^[:space:];|&-]+)?)*'
# Only exempt a single recognizable read. Compound commands and unknown cloud
# operations still request review; seeing one read must not hide a later write.
safe_aws="^[[:space:]]*([^[:space:]]*/)?aws${global_flags}[[:space:]]+[a-z0-9-]+[[:space:]]+(get-|describe-|list-|head-)[a-z0-9-]+([[:space:]]+[^;|&\$\(\)\`]+)?[[:space:]]*$"
safe_gcloud="^[[:space:]]*([^[:space:]]*/)?gcloud${global_flags}[[:space:]]+([a-z0-9-]+[[:space:]]+){1,2}(list|describe)([[:space:]]+[^;|&\$\(\)\`]+)?[[:space:]]*$"
gcloud_mutation='[[:space:]](add|apply|create|delete|deploy|disable|enable|import|insert|patch|remove|reset|set|start|stop|update)([[:space:]]|$)'
cloud_review=false
if [[ "$command" =~ (^|[[:space:];\|&])([^[:space:]]*/)?aws([[:space:]]|$) ]]; then
  if [[ "$command" == *$'\n'* || ! "$command" =~ $safe_aws ]]; then cloud_review=true; fi
fi
if [[ "$command" =~ (^|[[:space:];\|&])([^[:space:]]*/)?gcloud([[:space:]]|$) ]]; then
  if [[ "$command" == *$'\n'* || "$command" =~ $gcloud_mutation || ! "$command" =~ $safe_gcloud ]]; then cloud_review=true; fi
fi
if [[ "$command" =~ git${global_flags}[[:space:]]+push ]] \
  || [[ "$command" =~ gh${global_flags}[[:space:]]+(pr[[:space:]]+(merge|create)|release[[:space:]]+create) ]] \
  || [[ "$command" =~ (npm|pnpm|yarn)[[:space:]]+publish ]] \
  || [[ "$command" =~ (twine|poetry)[[:space:]]+(upload|publish) ]] \
  || [[ "$command" =~ docker[[:space:]]+push ]] \
  || [[ "$command" =~ kubectl${global_flags}[[:space:]]+(apply|delete|replace|patch) ]] \
  || [[ "$command" =~ terraform${global_flags}[[:space:]]+(apply|destroy) ]] \
  || [[ "$command" =~ helm${global_flags}[[:space:]]+(install|upgrade|uninstall) ]] \
  || [[ "$cloud_review" == true ]] \
  || [[ "$command" =~ flyctl([[:space:]]|$) ]] \
  || [[ "$command" =~ vercel([[:space:]]|$) ]] \
  || [[ "$command" =~ netlify([[:space:]]|$) ]] \
  || [[ "$command" =~ make[[:space:]]+[^[:space:]]*deploy[^[:space:]]* ]]; then
  ask "Command can publish, deploy, or change remote infrastructure; confirm scope and target."
fi
