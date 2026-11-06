# Controller Connection

## Controller types

- UniFi OS consoles (Dream Machine, Cloud Gateway, Cloud Key Gen2 and later,
  self-hosted UniFi OS Server) proxy the Network application under
  `/proxy/network` and log in at `/api/auth/login`. These are the defaults.
- A standalone Network application (the older self-hosted controller, usually
  on port 8443) uses no prefix and logs in at `/api/login`. Set
  `UNIFI_API_PREFIX=` (empty) and `UNIFI_LOGIN_PATH=/api/login`. This mode is
  not exercised by the script's authors; confirm with `stat/sysinfo` first.

## Authentication modes

Pick the first that the controller supports:

1. API key (`UNIFI_API_KEY`). Recent UniFi OS releases can create keys in the
   console's integration settings. The script sends it as an `X-API-KEY`
   header read from a temporary file, so it never appears in process
   arguments. Whether the classic `/api/s/<site>/...` endpoints accept a key
   depends on the Network version; if every read returns 401, fall back to a
   login.
2. A dedicated local account with view-only (read-only) permissions and no
   cloud sign-in. It limits the damage of a leaked password and usually avoids
   MFA prompts.
3. An account with MFA. The script first posts the username and password; if
   the response carries `data.mfaCookie`, it posts again with `token` set to
   `UNIFI_TOTP` and that cookie. This two-step flow matches UniFi OS consoles
   tested at the time of writing and may change between versions. The code
   expires quickly, so collect it immediately before the run.

Credentials are serialized by `jq` and sent on stdin, never embedded in curl
arguments. The script unsets secrets after authentication and does not print
login responses.

## Secrets handling

- Prefer exporting variables from a secret manager or keychain in the shell
  that starts the agent, so no secret file exists on disk.
- If an env file is used, keep it at `~/.config/ubiquiti-advisor/.env` or in
  this skill directory (ignored by `.gitignore`), readable only by its owner
  (`chmod 600`). Point `UNIFI_ENV_FILE` at another path only when the user
  names it.
- The script parses only the documented `UNIFI_*` keys from the file; it does
  not execute it, so other lines and shell syntax are ignored.

## TLS

Controllers ship with a self-signed certificate. Do not disable verification.
Options, best first:

1. Install a certificate from a trusted CA on the console and use its
   hostname in `UNIFI_URL`.
2. Export the console's certificate (or the private CA that issued it) after
   the user has verified its fingerprint out of band, and set `UNIFI_CA_CERT`
   to that file. The hostname in `UNIFI_URL` must match the certificate.
3. Reach the controller through an SSH tunnel and use
   `http://127.0.0.1:<port>`; plain HTTP is accepted only for loopback URLs.

## Session lifetime and scratch files

Each invocation creates a private temporary directory (`umask 077`) for the
cookie jar and response bodies under `$TMPDIR`, and removes it on exit,
including after HUP, INT or TERM. Run all reads for a task in one invocation
instead of keeping a session between tool calls. SIGKILL or a crash can leave
the directory behind; report its path if that happens. Sessions expire on the
controller side.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `cannot reach ... (connection or TLS failure)` | Wrong URL or port, VPN or firewall, or certificate not trusted. |
| `login failed with HTTP 401/403` | Wrong credentials, account locked, or cloud-only account. |
| `the account requires MFA` | Set `UNIFI_TOTP` with a fresh code, or use a view-only local account or API key. |
| `HTTP 401` on reads with an API key | The Network version does not accept keys on these endpoints. |
| `HTTP 404` on reads | Wrong `UNIFI_SITE` (use the site ID, not its display name) or wrong `UNIFI_API_PREFIX`. |
| `non-JSON response` | The URL points at a login page or another service. |
