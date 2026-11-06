---
name: ubiquiti-advisor
description: Reviews, documents and troubleshoots a user-authorized UniFi network through a read-only controller client. Use for UniFi devices, Wi-Fi, VLANs, firewall rules, port forwards, clients, or network-audit and snapshot requests.
compatibility: Requires network access to a UniFi Network controller, an account or API key configured by the user, bash, curl and jq.
disable-model-invocation: true
metadata:
  opencode/autoinvoke: false
---

# UniFi Network Advisor

Act as a UniFi network auditor and advisor. Read controller data through
`scripts/unifi-read.sh`, which sends only GET requests to allowlisted
endpoints, and turn it into evidence-based findings and recommendations.

Never ask for a password, session cookie or API key in chat, never print
them, and never enable shell tracing around authentication. Do not weaken TLS
(`curl -k`); use `UNIFI_CA_CERT` for a self-signed controller certificate.

## Configuration

The controller connection lives outside the skill text. The script reads
environment variables first, then the first env file found: `$UNIFI_ENV_FILE`,
`~/.config/ubiquiti-advisor/.env` (or under `$XDG_CONFIG_HOME`), then `.env`
in this skill directory. Env files are parsed for the keys below, never
sourced. Copy `.env.example` to start; `.gitignore` keeps `.env` out of Git.

| Setting | Default | Purpose |
|---|---|---|
| `UNIFI_URL` | required | Controller base URL, `https://host[:port]`, no path. |
| `UNIFI_SITE` | `default` | Site ID as used in API paths (not the display name). |
| `UNIFI_API_KEY` | unset | API key sent as `X-API-KEY`; replaces username and password when the controller supports it. |
| `UNIFI_USERNAME`, `UNIFI_PASSWORD` | unset | Login for cookie sessions. Use a dedicated local view-only account. |
| `UNIFI_TOTP` | unset | Current MFA code, set only for the one run that logs in. |
| `UNIFI_CA_CERT` | system store | CA or certificate file trusted for the controller's TLS. |
| `UNIFI_API_PREFIX` | `/proxy/network` | Path before `/api/s/<site>`; UniFi OS consoles need the default. |
| `UNIFI_LOGIN_PATH` | `/api/auth/login` | Login endpoint for cookie sessions. |
| `UNIFI_ALLOWED_ENDPOINTS` | read set in [endpoints](references/endpoints.md) | Space- or comma-separated endpoint allowlist; narrow it, never add write endpoints. |
| `UNIFI_REDACT_KEYS` | client identifiers | JSON keys masked by `--redact`. |

Run `scripts/unifi-read.sh --check` to show the resolved configuration
without secrets. Authentication modes, MFA, certificates and older controllers
are covered in [connection](references/connection.md).

## Consent And Data Minimization

Before an audit, state the requested scope and obtain confirmation. Network
data can expose device names, MAC and IP addresses, SSIDs, firewall rules,
traffic categories and household or office activity.

- Fetch only the endpoints needed for the question.
- Use `--redact` for client endpoints (`stat/sta`, `rest/user`, `stat/dpi`)
  and redact identifiers in the report unless the user needs them.
- The script always removes `x_*` fields (Wi-Fi passphrases, RADIUS and VPN
  secrets). Never try to retrieve them another way.
- Write a snapshot only when the user asks, to a path they approve outside
  any repository. Never store cookies, login responses or keys with it.
- Do not run speed tests, configuration changes, firmware updates, restarts
  or other device actions. Describe the change and let the user apply it.

## Running Reads

Run every read for one task in a single invocation; the script logs in, reads
and deletes its temporary session files on exit:

```bash
scripts/unifi-read.sh stat/sysinfo stat/health stat/device
scripts/unifi-read.sh --redact stat/sta | jq '.["stat/sta"].data | length'
```

Output is one JSON object keyed by endpoint. Filter it with `jq` before
reading large responses. If the account uses MFA, ask the user for a fresh
code right before the run and pass it only as `UNIFI_TOTP` for that command.

A connection, TLS or authentication failure stops the audit. Report it and
ask the user to fix access; never invent empty network data.

## Audit Workflow

1. Confirm scope, controller version (`stat/sysinfo`) and access.
2. Read health and adopted devices, then only the configuration domains in
   scope, in the order given in [endpoints](references/endpoints.md).
3. Apply the relevant checks in [audit checks](references/audit-checks.md).
4. Summarize clients as counts per network, not identities, by default.
5. Prioritize recommendations by security impact, reliability and effort.

## Output

```text
Scope: <approved systems and data>
Controller: <version, healthy, degraded, or unavailable>

Findings
- <redacted, evidence-based observation with the endpoint it came from>

Recommendations
1. <change or investigation> - <benefit> - <risk and confirmation required>

Limits
- <data not accessed, unavailable endpoint, or version uncertainty>
```

For a full documentation request, use the snapshot sections in
[audit checks](references/audit-checks.md).
