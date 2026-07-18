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
if [[ "$command" =~ git([[:space:]]+-[^[:space:]]*([[:space:]]+[^[:space:]]+)?)*[[:space:]]+push ]] \
  || [[ "$command" =~ gh[[:space:]]+(pr[[:space:]]+(merge|create)|release[[:space:]]+create) ]] \
  || [[ "$command" =~ (npm|pnpm|yarn)[[:space:]]+publish ]] \
  || [[ "$command" =~ (twine|poetry)[[:space:]]+(upload|publish) ]] \
  || [[ "$command" =~ docker[[:space:]]+push ]] \
  || [[ "$command" =~ kubectl[[:space:]]+(apply|delete|replace|patch) ]] \
  || [[ "$command" =~ terraform[[:space:]]+(apply|destroy) ]] \
  || [[ "$command" =~ helm[[:space:]]+(install|upgrade|uninstall) ]] \
  || [[ "$command" =~ aws([[:space:]]|$) ]] \
  || [[ "$command" =~ gcloud([[:space:]]|$) ]] \
  || [[ "$command" =~ flyctl([[:space:]]|$) ]] \
  || [[ "$command" =~ vercel([[:space:]]|$) ]] \
  || [[ "$command" =~ netlify([[:space:]]|$) ]] \
  || [[ "$command" =~ make[[:space:]]+[^[:space:]]*deploy[^[:space:]]* ]]; then
  ask "Command can publish, deploy, or change remote infrastructure; confirm scope and target."
fi
