#!/usr/bin/env bash
# Read-only UniFi Network API client for the ubiquiti-advisor skill.
#
# Usage: unifi-read.sh [--redact] [--check] ENDPOINT...
#   ENDPOINT  path below /api/s/<site>/, for example stat/device.
#   --redact  mask client identifiers (keys listed in UNIFI_REDACT_KEYS).
#   --check   print the resolved, non-secret configuration and exit.
#
# Only GET requests are sent for data. Every endpoint must be in the
# allowlist. Keys starting with "x_" (UniFi secret fields such as Wi-Fi
# passphrases and RADIUS secrets) are always removed from the output.
# Prints one JSON object keyed by endpoint. Configuration: see SKILL.md.
set -euo pipefail
set +x
umask 077

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
skill_dir=$(dirname "$script_dir")
known_keys=(UNIFI_URL UNIFI_SITE UNIFI_USERNAME UNIFI_PASSWORD UNIFI_TOTP
  UNIFI_API_KEY UNIFI_CA_CERT UNIFI_API_PREFIX UNIFI_LOGIN_PATH
  UNIFI_ALLOWED_ENDPOINTS UNIFI_REDACT_KEYS)

die() { printf 'unifi-read: %s\n' "$*" >&2; exit 1; }

# Parse KEY=VALUE lines for known keys only; the file is never sourced.
# Variables already set in the environment take precedence.
load_env_file() {
  local file=$1 line key value
  [[ -f $file ]] || die "env file not found: $file"
  while IFS= read -r line || [[ -n $line ]]; do
    [[ $line =~ ^[[:space:]]*(export[[:space:]]+)?([A-Z_]+)=(.*)$ ]] || continue
    key=${BASH_REMATCH[2]}
    value=${BASH_REMATCH[3]}
    value=${value%$'\r'}
    if [[ $value =~ ^\"(.*)\"$ || $value =~ ^\'(.*)\'$ ]]; then
      value=${BASH_REMATCH[1]}
    fi
    [[ " ${known_keys[*]} " == *" $key "* ]] || continue
    [[ -n ${!key+x} ]] && continue
    printf -v "$key" '%s' "$value"
    export "${key?}"
  done < "$file"
}

config_home=${XDG_CONFIG_HOME:-$HOME/.config}
if [[ -n ${UNIFI_ENV_FILE:-} ]]; then
  load_env_file "$UNIFI_ENV_FILE"
  env_source=$UNIFI_ENV_FILE
elif [[ -f $config_home/ubiquiti-advisor/.env ]]; then
  load_env_file "$config_home/ubiquiti-advisor/.env"
  env_source=$config_home/ubiquiti-advisor/.env
elif [[ -f $skill_dir/.env ]]; then
  load_env_file "$skill_dir/.env"
  env_source=$skill_dir/.env
else
  env_source="environment only"
fi

default_allowlist="stat/sysinfo stat/health stat/device rest/networkconf
rest/wlanconf rest/setting rest/firewallrule rest/firewallgroup
rest/portforward rest/routing stat/sta rest/user stat/dpi"
default_redact="mac ip hostname name note last_ip fixed_ip bssid serial
uplink_mac gw_mac oui wan_ip"

UNIFI_SITE=${UNIFI_SITE:-default}
UNIFI_API_PREFIX=${UNIFI_API_PREFIX-/proxy/network}
UNIFI_LOGIN_PATH=${UNIFI_LOGIN_PATH:-/api/auth/login}
UNIFI_ALLOWED_ENDPOINTS=${UNIFI_ALLOWED_ENDPOINTS:-$default_allowlist}
UNIFI_REDACT_KEYS=${UNIFI_REDACT_KEYS:-$default_redact}
allowlist=" $(tr -s '[:space:],' ' ' <<<"$UNIFI_ALLOWED_ENDPOINTS") "

redact=false
check=false
endpoints=()
for arg in "$@"; do
  case $arg in
    --redact) redact=true ;;
    --check) check=true ;;
    -h | --help) sed -n '2,12p' "${BASH_SOURCE[0]}"; exit 0 ;;
    -*) die "unknown option: $arg" ;;
    *) endpoints+=("$arg") ;;
  esac
done

if [[ -n ${UNIFI_API_KEY:-} ]]; then
  auth_mode="api key"
elif [[ -n ${UNIFI_TOTP:-} ]]; then
  auth_mode="password + TOTP"
else
  auth_mode="password"
fi

if $check; then
  printf 'config source: %s\n' "$env_source"
  printf 'url: %s\n' "${UNIFI_URL:-<unset>}"
  printf 'site: %s\n' "$UNIFI_SITE"
  printf 'api prefix: %s\n' "${UNIFI_API_PREFIX:-<none>}"
  printf 'login path: %s\n' "$UNIFI_LOGIN_PATH"
  printf 'auth: %s\n' "$auth_mode"
  printf 'username set: %s\n' "$([[ -n ${UNIFI_USERNAME:-} ]] && echo yes || echo no)"
  printf 'ca cert: %s\n' "${UNIFI_CA_CERT:-<system trust store>}"
  printf 'allowlist:%s\n' "${allowlist% }"
  exit 0
fi

command -v curl >/dev/null || die "curl is required"
command -v jq >/dev/null || die "jq is required"
((${#endpoints[@]})) || die "no endpoint given; see --help"
[[ -n ${UNIFI_URL:-} ]] || die "UNIFI_URL is not set"
UNIFI_URL=${UNIFI_URL%/}
[[ $UNIFI_URL =~ ^https://[^/]+$ ||
  $UNIFI_URL =~ ^http://(127\.0\.0\.1|localhost|\[::1\])(:[0-9]+)?$ ]] ||
  die "UNIFI_URL must be https://host[:port] (plain http only for a local tunnel)"
[[ $UNIFI_SITE =~ ^[A-Za-z0-9_-]+$ ]] || die "invalid UNIFI_SITE"

for endpoint in "${endpoints[@]}"; do
  [[ $endpoint =~ ^[a-z0-9_/-]+$ && $endpoint != *..* ]] ||
    die "invalid endpoint: $endpoint"
  [[ $allowlist == *" $endpoint "* ]] ||
    die "endpoint not in allowlist: $endpoint"
done

curl_opts=(-sS --connect-timeout 10 --max-time 30 --proto "=https,http")
if [[ -n ${UNIFI_CA_CERT:-} ]]; then
  [[ -f $UNIFI_CA_CERT ]] || die "UNIFI_CA_CERT not found: $UNIFI_CA_CERT"
  curl_opts+=(--cacert "$UNIFI_CA_CERT")
fi

work_dir=$(mktemp -d "${TMPDIR:-/tmp}/unifi-read.XXXXXXXX")
cleanup() { rm -rf -- "$work_dir"; }
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
cookie_jar=$work_dir/session.cookies
auth_args=()

login() {
  [[ -n ${UNIFI_USERNAME:-} && -n ${UNIFI_PASSWORD:-} ]] ||
    die "set UNIFI_API_KEY, or UNIFI_USERNAME and UNIFI_PASSWORD"
  local login_url=$UNIFI_URL$UNIFI_LOGIN_PATH status mfa_cookie
  # Credentials go through jq on stdin, never into curl arguments.
  status=$(jq -cn '{username: env.UNIFI_USERNAME, password: env.UNIFI_PASSWORD}' |
    curl "${curl_opts[@]}" -X POST "$login_url" \
      -H 'Content-Type: application/json' --data-binary @- \
      -c "$cookie_jar" -o "$work_dir/login1.json" -w '%{http_code}') ||
    die "cannot reach $login_url (connection or TLS failure)"
  mfa_cookie=$(jq -r '.data.mfaCookie? // empty' "$work_dir/login1.json" 2>/dev/null || true)
  if [[ -z $mfa_cookie ]]; then
    [[ $status == 200 ]] || die "login failed with HTTP $status"
    return 0
  fi
  mfa_cookie=${mfa_cookie%%;*}
  [[ $mfa_cookie == *=* ]] || mfa_cookie="UBIC_2FA=$mfa_cookie"
  [[ -n ${UNIFI_TOTP:-} ]] ||
    die "the account requires MFA; set UNIFI_TOTP just before running"
  # Two-step MFA on UniFi OS consoles: resend with the code and the MFA cookie.
  status=$(jq -cn '{username: env.UNIFI_USERNAME, password: env.UNIFI_PASSWORD, token: env.UNIFI_TOTP}' |
    curl "${curl_opts[@]}" -X POST "$login_url" \
      -H 'Content-Type: application/json' -b "$mfa_cookie" --data-binary @- \
      -c "$cookie_jar" -o "$work_dir/login2.json" -w '%{http_code}') ||
    die "cannot reach $login_url during MFA login"
  [[ $status == 200 ]] || die "MFA login failed with HTTP $status"
}

if [[ -n ${UNIFI_API_KEY:-} ]]; then
  # Header value is read from a file so the key never appears in arguments.
  printf 'X-API-KEY: %s\n' "$UNIFI_API_KEY" > "$work_dir/auth.header"
  auth_args=(-H "@$work_dir/auth.header")
else
  login
  auth_args=(-b "$cookie_jar")
fi
unset UNIFI_PASSWORD UNIFI_TOTP UNIFI_API_KEY

# shellcheck disable=SC2016 # jq variables, not shell expansions
strip_filter='walk(if type == "object" then with_entries(select(.key | startswith("x_") | not)) else . end)'
# shellcheck disable=SC2016
redact_filter='walk(if type == "object" then with_entries(if (.key as $k | $keys | index($k)) and (.value | type) == "string" then .value = "REDACTED" else . end) else . end)'
redact_keys_json=$(tr -s '[:space:],' '\n' <<<"$UNIFI_REDACT_KEYS" |
  jq -R 'select(length > 0)' | jq -sc .)

base=$UNIFI_URL$UNIFI_API_PREFIX/api/s/$UNIFI_SITE
result='{}'
for endpoint in "${endpoints[@]}"; do
  body=$work_dir/body.json
  status=$(curl "${curl_opts[@]}" "${auth_args[@]}" "$base/$endpoint" \
    -o "$body" -w '%{http_code}') || die "request failed: $endpoint"
  [[ $status == 200 ]] || die "HTTP $status for $endpoint (authentication, site or version mismatch)"
  filtered=$(jq -c "$strip_filter" "$body") || die "non-JSON response for $endpoint"
  if $redact; then
    filtered=$(jq -c --argjson keys "$redact_keys_json" "$redact_filter" <<<"$filtered")
  fi
  result=$(jq -c --arg ep "$endpoint" --argjson data "$filtered" '. + {($ep): $data}' <<<"$result")
done
jq . <<<"$result"
