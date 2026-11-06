#!/usr/bin/env bash
# Render Claude's live session data. No credentials or network. The only state
# is the account's rate limits, as reported by Claude, kept so every session of
# this config directory shows them, including one that has not had a reply yet.
# One jq call and no `set -e`: Claude Code re-runs this after every message and
# cancels slow runs, and a failed run blanks the row, so keep it fast and total.
set -uo pipefail
set -f
input=$(cat)

blue='\033[38;2;0;153;255m'
green='\033[38;2;0;175;80m'
red='\033[38;2;255;85;85m'
yellow='\033[38;2;230;200;0m'
dim='\033[2m'
reset='\033[0m'

store="${CLAUDE_CONFIG_DIR:-${HOME:-}/.claude}/cache/statusline-rate-limits.json"
stored='{}'
[[ -r "$store" ]] && stored=$(<"$store")

# Unit separator keeps empty fields in place, unlike tabs under `read`.
fields=$(jq -r --arg stored "$stored" '
  def pct: if type == "number" then floor else null end;
  def text: tostring | gsub("[\u0000-\u001f\u007f]"; " ");
  def reset_at:
    if type == "number" then
      (if (localtime | strflocaltime("%F")) == (now | localtime | strflocaltime("%F"))
       then strflocaltime("%H:%M") else strflocaltime("%a %H:%M") end)
    else null end;
  def quota: select(type == "object" and (.used_percentage | type) == "number")
    | {used_percentage, resets_at};
  # Sessions report at different times: a later window wins, and usage only
  # grows within a window, so an idle session cannot roll the numbers back.
  def rate_limits($stored):
    . as $live | reduce ("five_hour", "seven_day", "spend_limit") as $name ({};
      ([ ($stored[$name]? | quota | select((.resets_at | type) == "number" and .resets_at > now)),
         ($live[$name]? | quota) ] | max_by([.resets_at, .used_percentage])) as $window
      | if $window then .[$name] = $window else . end);
  if type != "object" then error("not an object") else . end
  | (.rate_limits | rate_limits(try ($stored | fromjson) catch {})) as $limits
  | [ (.model.display_name // "Claude" | text),
      (.workspace.current_dir // .cwd // "" | text),
      (.context_window.used_percentage | pct // 0),
      (.cost.total_duration_ms | pct // 0),
      (.effort.level // "" | text),
      (if .thinking.enabled == true then "on" elif .thinking.enabled == false then "off" else "unknown" end),
      (["five_hour", "seven_day", "spend_limit"][]
        | ($limits[.] // {}) as $w
        | (($w.used_percentage | pct) // ""), (($w.resets_at | reset_at) // "")),
      ($limits | tojson)
    ] | map(tostring) | join("\u001f")
' <<<"$input" 2>/dev/null) || fields=''
if [[ -z "$fields" ]]; then
  printf 'Claude\n'
  exit 0
fi
IFS=$'\x1f' read -r model cwd pct duration_ms effort thinking \
  five_used five_reset week_used week_reset spend_used spend_reset limits <<<"$fields"
# Only plain integers may reach (( )), where bash would evaluate anything else.
for name in pct duration_ms five_used week_used spend_used; do
  [[ ${!name} =~ ^-?[0-9]+$ || ( $name == *_used && -z ${!name} ) ]] || printf -v "$name" 0
done

color_for_pct() {
  if (( $1 >= 90 )); then printf '%b' "$red"
  elif (( $1 >= 70 )); then printf '%b' "$yellow"
  else printf '%b' "$green"; fi
}
bar() {
  local pct=$1 filled empty i
  (( pct < 0 )) && pct=0
  (( pct > 100 )) && pct=100
  filled=$(( pct / 10 ))
  empty=$(( 10 - filled ))
  color_for_pct "$pct"
  for ((i=0; i<filled; i++)); do printf '●'; done
  printf '%b' "$dim"
  for ((i=0; i<empty; i++)); do printf '○'; done
  printf '%b' "$reset"
}
quota() {
  local label=$1 used=$2 resets=$3
  printf '%s ' "$label"
  bar "$used"
  printf ' %s%%' "$used"
  [[ -z "$resets" ]] || printf ' resets %s' "$resets"
}

printf '%b%s%b | ' "$blue" "$model" "$reset"
color_for_pct "$pct"
printf '%s%%%b' "$pct" "$reset"
if [[ -n "$cwd" ]]; then
  printf ' | %s' "${cwd##*/}"
  branch=$(git -C "$cwd" --no-optional-locks symbolic-ref --short HEAD 2>/dev/null || true)
  [[ -z "$branch" ]] || printf ' (%s)' "$branch"
fi
(( duration_ms <= 0 )) || printf ' | %sm' "$(( duration_ms / 60000 ))"
[[ -z "$effort" ]] || printf ' | effort %s' "$effort"
printf ' | thinking %s' "$thinking"

# All quotas share one second row so the status line stays two rows tall.
separator=$'\n'
for window in five week spend; do
  case "$window" in
    five) label=current used=$five_used resets=$five_reset ;;
    week) label=weekly used=$week_used resets=$week_reset ;;
    spend) label=spend used=$spend_used resets=$spend_reset ;;
  esac
  [[ -n "$used" ]] || continue
  printf '%s' "$separator"
  quota "$label" "$used" "$resets"
  separator=' | '
done
printf '\n'

# Rename into place so a concurrent session never reads a partial file.
if [[ "$limits" != "$stored" ]]; then
  (
    umask 077
    mkdir -p "${store%/*}" && printf '%s' "$limits" >"$store.$$" && mv -f "$store.$$" "$store"
  ) 2>/dev/null || rm -f "$store.$$" 2>/dev/null
fi
exit 0
