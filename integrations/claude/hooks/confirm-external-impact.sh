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
  exit 0
}

command -v jq >/dev/null 2>&1 || ask "jq is required to inspect Bash commands safely."
input=$(cat)
command=$(printf '%s' "$input" | jq -er '.tool_input.command // empty') \
  || ask "Could not inspect the Bash command."
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty')
session_id=$(printf '%s' "$input" | jq -r '.session_id // empty')

hook_path=$(readlink -f -- "${BASH_SOURCE[0]}" 2>/dev/null) || hook_path=${BASH_SOURCE[0]}
# shellcheck source-path=SCRIPTDIR source=command-scan.sh
source "${hook_path%/*}/command-scan.sh" 2>/dev/null \
  || ask "Hook helper command-scan.sh is missing; review this command manually."
cs_scan "$command" || ask "Could not split the Bash command into simple commands; review it manually."
cs_context "$cwd" "$session_id"

impact="Command can publish, deploy, or change remote infrastructure; confirm scope and target."
global_flags='([[:space:]]+-[^[:space:]]+([[:space:]]+[^[:space:]-][^[:space:]]*)?)*'
# Branches that a push must never reach without confirmation, in addition to
# the remote's default branch.
protected_branches='main|master|trunk|develop|production|prod|release|release/.*'

git_in() {
  git -c core.fsmonitor=false -C "$git_dir" "$@" 2>/dev/null
}

# A plain push of a feature branch passes; force, delete, mirror, tag and
# default-branch pushes, and anything that cannot be resolved, ask.
git_push_safe() {
  local segment=$1 j end w remote="" current default destination
  local -a refspecs=()
  end=${CS_END[segment]}
  [[ "$CS_VIA" == direct && "$CS_CWD_OK" == true ]] || return 1
  git_dir=$CS_CWD
  j=$((CS_I + 1))
  while (( j < end )); do
    w=${CS_WORDS[j]}
    [[ "${CS_FLAGS[j]}" != *[dg]* ]] || return 1
    case "$w" in
      -C)
        j=$((j + 1)); (( j < end )) && [[ "${CS_FLAGS[j]}" != *[dg]* ]] || return 1
        if [[ "${CS_WORDS[j]}" == /* ]]; then git_dir=${CS_WORDS[j]}; else git_dir="$git_dir/${CS_WORDS[j]}"; fi
        ;;
      -c) j=$((j + 1)) ;;
      --no-pager|-P|--paginate|-p|--no-replace-objects|--literal-pathspecs|--no-optional-locks) ;;
      push) break ;;
      *) return 1 ;;
    esac
    j=$((j + 1))
  done
  (( j < end )) || return 1
  for ((j = j + 1; j < end; j++)); do
    w=${CS_WORDS[j]}
    [[ "${CS_FLAGS[j]}" != *[dg]* ]] || return 1
    case "$w" in
      -u|--set-upstream|-q|--quiet|-v|--verbose|-n|--dry-run|--no-verify|--verify|--progress|--no-progress|--porcelain|--atomic) ;;
      -o|--push-option) j=$((j + 1)) ;;
      --push-option=*) ;;
      -*) return 1 ;;
      *)
        if [[ -z "$remote" ]]; then remote=$w; else refspecs+=("$w"); fi
        ;;
    esac
  done
  git_in rev-parse --git-dir >/dev/null || return 1
  # Configured push mappings can send a branch somewhere other than its name.
  case "$(git_in config --get push.default || true)" in
    ''|simple|current) ;;
    *) return 1 ;;
  esac
  [[ -z "$(git_in config --get-regexp '^remote\..*\.push$' || true)" ]] || return 1
  current=$(git_in symbolic-ref --quiet --short HEAD) || return 1
  (( ${#refspecs[@]} > 0 )) || refspecs=("$current")
  [[ -n "$remote" ]] || remote=$(git_in config --get "branch.$current.remote" || printf 'origin')
  default=$(git_in symbolic-ref --quiet --short "refs/remotes/$remote/HEAD" || true)
  default=${default#"$remote"/}
  for w in "${refspecs[@]}"; do
    [[ "$w" != +* ]] || return 1
    destination=${w##*:}
    [[ -n "$destination" && "$w" != :* ]] || return 1
    [[ "$destination" != HEAD ]] || destination=$current
    destination=${destination#refs/heads/}
    [[ "$destination" != refs/* ]] || return 1
    [[ ! "$destination" =~ ^($protected_branches)$ ]] || return 1
    [[ -z "$default" || "$destination" != "$default" ]] || return 1
  done
}

aws_safe() {
  local segment=$1 j end w
  local -a positional=()
  end=${CS_END[segment]}
  for ((j = CS_I + 1; j < end; j++)); do
    w=${CS_WORDS[j]}
    [[ "${CS_FLAGS[j]}" != *[dg]* ]] || return 1
    case "$w" in
      --version|help) return 0 ;;
      --profile|--region|--output|--endpoint-url|--color|--query|--ca-bundle|--cli-read-timeout|--cli-connect-timeout|--cli-binary-format) j=$((j + 1)) ;;
      -*) ;;
      *) positional+=("$w") ;;
    esac
  done
  (( ${#positional[@]} >= 2 )) || return 1
  [[ "${positional[1]}" =~ ^(get-|describe-|list-|head-)[a-z0-9-]+$ || "${positional[0]} ${positional[1]}" == "s3 ls" ]]
}

gcloud_safe() {
  local segment=$1 j end w
  local -a positional=()
  end=${CS_END[segment]}
  for ((j = CS_I + 1; j < end; j++)); do
    w=${CS_WORDS[j]}
    [[ "${CS_FLAGS[j]}" != *[dg]* ]] || return 1
    [[ "$w" != --version ]] || return 0
    [[ "$w" == -* ]] || positional+=("$w")
  done
  (( ${#positional[@]} > 0 )) || return 1
  for w in "${positional[@]}"; do
    [[ ! "$w" =~ ^(add|apply|create|delete|deploy|disable|enable|import|insert|patch|remove|reset|set|start|stop|update)$ ]] || return 1
  done
  [[ "${positional[1]:-}" =~ ^(list|describe)$ || "${positional[2]:-}" =~ ^(list|describe)$ ]]
}

for segment in $(cs_segments); do
  if cs_invocation "$segment" 'cd|pushd|popd'; then
    CS_CWD_OK=false
    continue
  fi
  if cs_invocation "$segment" git; then
    cs_text "$segment"
    if [[ "$CS_TEXT" =~ ^git${global_flags}[[:space:]]+push([[:space:]]|$) ]]; then
      git_push_safe "$segment" || ask "Git push targets a protected or unresolved branch, or rewrites history; confirm scope and target."
    fi
  fi
  if cs_invocation "$segment" gh; then
    cs_text "$segment"
    [[ ! "$CS_TEXT" =~ ^gh${global_flags}[[:space:]]+(pr[[:space:]]+(merge|create)|release[[:space:]]+create) ]] || ask "$impact"
  fi
  if cs_invocation "$segment" 'npm|pnpm|yarn|bun|twine|poetry|docker|podman'; then
    cs_text "$segment"
    [[ ! "$CS_TEXT" =~ ^(npm|pnpm|yarn|bun)${global_flags}[[:space:]]+publish([[:space:]]|$) \
      && ! "$CS_TEXT" =~ ^(twine|poetry)${global_flags}[[:space:]]+(upload|publish)([[:space:]]|$) \
      && ! "$CS_TEXT" =~ ^(docker|podman)${global_flags}[[:space:]]+(image[[:space:]]+)?push([[:space:]]|$) ]] || ask "$impact"
  fi
  if cs_invocation "$segment" kubectl && cs_has_word "$segment" 'apply|delete|replace|patch'; then ask "$impact"; fi
  if cs_invocation "$segment" terraform && cs_has_word "$segment" 'apply|destroy'; then ask "$impact"; fi
  if cs_invocation "$segment" helm && cs_has_word "$segment" 'install|upgrade|uninstall'; then ask "$impact"; fi
  if cs_invocation "$segment" aws; then aws_safe "$segment" || ask "$impact"; fi
  if cs_invocation "$segment" gcloud; then gcloud_safe "$segment" || ask "$impact"; fi
  if cs_invocation "$segment" 'flyctl|fly|vercel|netlify'; then
    cs_has_word "$segment" '--version|version|help|--help' || ask "$impact"
  fi
  if cs_invocation "$segment" make && cs_has_word "$segment" '([^-=][^=]*)?deploy[^=]*'; then ask "$impact"; fi
done

exit 0
