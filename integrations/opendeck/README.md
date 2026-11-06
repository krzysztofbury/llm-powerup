# Agents on OpenDeck and Omarchy

**A physical AI-agent dashboard, built on [OpenDeck](https://github.com/nekename/OpenDeck)
and used on [Omarchy](https://github.com/basecamp/omarchy) 4.**
This is the actual 15-key Elgato Stream Deck MK.2 Agents page, not a generic
deck layout. The OpenDeck plugin draws live status; Herdr supplies agent state
and pane focus; Codex and OpenCode supply their own local metrics. Omarchy
provides the surrounding Linux desktop workflow. Quota and activity keys can
instead read Claude usage from the record Omarchy's agents panel keeps (see
[Claude usage from Omarchy](#claude-usage-from-omarchy)); only those keys call
an Omarchy command, and only when pressed. A generic
[Run Command](#run-command-key) key runs a command named in its settings and
can show that command's on/off status.

This integration uses OpenDeck 2.14's profile format and plugin protocol, on
Linux with Node 22.13+ (22.x) or 23.4+. These versions expose `node:sqlite`
without a flag, as documented in the [Node SQLite history](https://nodejs.org/api/sqlite.html).
Only the OpenCode activity key loads `node:sqlite`, and only when it first
queries; the other keys run on any Node 22.
The profile is laid out for a 5 x 3 keypad. It
keeps the existing `dev.krzysztof.agents.*` action IDs so it is compatible with
the working layout.

## The actual layout

| Position | Key | What it does |
| --- | --- | --- |
| 0 | Back | Switch to the `Default` OpenDeck profile. |
| 1 | Agent Pulse | Show the most urgent Herdr state; press to focus the highest-priority pane. |
| 2 | Codex Quota | Remaining allowance for the 5-hour and 7-day windows; press to refresh. |
| 3 | OpenCode 24H | Root-session token activity in the last 24 hours. |
| 4 | OpenCode 7D | Root-session token activity in the last 168 hours. |
| 5-14 | Agent Session 0-9 | Ten stable Herdr pane slots; press to focus that pane. |

Herdr states appear red for blocked, amber for working, green for completed and
unreviewed, blue for idle or focused, and grey for empty or offline. Pulse
prioritizes blocked, then completed, working, and idle sessions. Slot positions
stay fixed while the plugin runs; they are not persisted between restarts.

The surrounding Omarchy setup puts an `Agents` Switch Profile key in position 7
of `Default`, linking to `Agents/Home`. Position 8 holds a Run Command key that
toggles a meeting camera helper, and position 9 is empty; the bottom row has
system gauges. Other OpenDeck profiles in the setup control Hyprland's
master layout, Omarchy's screenshot/OCR tools, media over MPRIS, and OBS. The
Agents page here is the only profile published by this integration; those
other keys depend on separate plugins, commands, and local device settings.

## Data paths and refresh

| Key | Local source | Refresh while visible |
| --- | --- | --- |
| Pulse and sessions | Herdr Unix socket at `~/.config/herdr/herdr.sock`; `session.snapshot` and `agent.focus` | 2 seconds |
| Quota | `codex app-server --stdio` with `CODEX_HOME=~/.codex` | 5 minutes (press to force refresh) |
| Activity | Read-only `~/.local/share/opencode/opencode.db` | 60 seconds (press to refresh) |
| Quota and activity with `source: "claude"` | Omarchy's `~/.local/state/omarchy/agents/usage/claude.json` | 30 seconds (press to ask Omarchy to rewrite it) |
| Run Command with `statusArgs` | The configured command's stdout and exit status | `intervalSeconds`, default 5 seconds |

The plugin also accepts `HERDR_SOCKET` and `OPENCODE_DB` environment variables.
The quota key accepts `codexExecutable`, `codexHome`, and `refreshMinutes` in its
OpenDeck action settings. It does not read or publish conversation content:
the activity query sums input, output, and reasoning tokens for root sessions
and displays cached tokens separately. Its SQLite query expects the `session`
and `message` tables with the schema used by the OpenCode setup described
here. The plugin does not start or manage agent sessions.

Quota refresh failures retain the last successful percentages and timestamp.
The key shows `CODEX STALE` with the age of that sample until a successful
refresh, including on cached ticks and when the key reappears. Data older than
the configured refresh interval is also marked stale while a request is pending.
The timer checks every 30 seconds; a failed forced refresh does not extend the
last successful sample's cache lifetime. Without a successful sample, failures
show `OFFLINE`. The cache is in memory and shared by quota keys; the first visible
quota key supplies the CLI settings and refresh interval.

The activity adapter expects `session(id, parent_id)` and
`message(session_id, time_created, data)`, with millisecond timestamps and JSON
`role`, `tokens.input`, `tokens.output`, `tokens.reasoning`, and
`tokens.cache.read` fields. This is an internal storage contract, not a supported
OpenCode API or a claim of compatibility with every OpenCode release. Missing
tables or columns and query failures display `NO DATA`; absent JSON token fields
sum as zero. The fixture test validates this expected schema only. Queries run
synchronously and can delay all key updates on large databases; representative
database-size performance and installed-version compatibility need local checks.

## Claude usage from Omarchy

Set `"source": "claude"` in a quota or activity key's settings to show Claude
Code usage instead of Codex quota or OpenCode activity. The keys then read the
record that Omarchy's `omarchy-agent-usage-claude` collector writes for the
agents panel, at `$XDG_STATE_HOME/omarchy/agents/usage/claude.json` (default
`~/.local/state/...`, or the path in `CLAUDE_USAGE_RECORD`). The collector owns
the OAuth usage call and the transcript scan, so the deck never touches Claude
credentials and does not poll the usage endpoint a second time. The record is
reread every 30 seconds; the panel rewrites it every 15 minutes.

The quota key shows the allowance left in the 5-hour and 7-day windows and the
record's age, and turns amber with `CLAUDE STALE` once the record is older than
30 minutes. Model-specific weekly limits are ignored. A window whose reset time
has passed shows full allowance until the next refresh, and an unknown limit
shows `NO DATA` rather than a full bar. Pressing it runs
`omarchy-agent-usage-update --limits-only claude` (override the executable with
`OMARCHY_AGENT_USAGE_UPDATE`). Activity keys show tokens for today (`hours` 24)
or the last N days (`hours` 168 for 7), cache reads included, matching the
Omarchy panel. Pressing one runs a full `omarchy-agent-usage-update claude`.
Keys without `source`, or with any other value, keep the Codex and OpenCode
behavior above.

## Run Command key

`dev.krzysztof.agents.command` runs a command taken entirely from the key's
action settings; the plugin has no built-in commands. It has no property
inspector, so edit the settings in the profile JSON while OpenDeck is stopped.

| Setting | Default | Meaning |
| --- | --- | --- |
| `command` | required | Executable name or path. A leading `~/` is expanded. A bare name is looked up on `PATH`, then in `~/.local/bin`, because a desktop-started OpenDeck often lacks it on `PATH`. |
| `args` | `[]` | Arguments passed on key press, as a JSON list of strings. |
| `statusArgs` | none | When set, the key also runs `command` with these arguments to show on or off. Without it the key is a plain launcher showing `RUN`. |
| `title` | command's basename | Top line of the key, upper-cased and shortened to fit. |
| `onText`, `offText` | `ON`, `OFF` | Bottom line in each state. |
| `onColor` | green | Fill color for the on state, as `#rgb` or `#rrggbb`; anything else falls back to the default. |
| `intervalSeconds` | 5 | Status poll interval, 1 to 3600. |
| `timeoutSeconds` | 15 | Press timeout, 1 to 600. A status check gets at most 5 seconds. |

For example, a key that toggles a camera helper script and shows its state:

```json
"settings": {
  "command": "zoom-cam",
  "args": ["toggle"],
  "statusArgs": ["status"],
  "title": "Zoom cam",
  "onText": "ZOOM ON",
  "offText": "ZOOM OFF",
  "onColor": "#dc2626",
  "intervalSeconds": 2
}
```

Execution rules:

- No shell is involved. The command is started with an argument vector, so
  `$VAR`, `$(...)`, `;`, `|`, globs and `~` inside `args` reach the program as
  literal text. Use `"command": "sh", "args": ["-c", "..."]` only when you
  want shell syntax, and quote accordingly.
- The command runs as the OpenDeck user, in the home directory, with OpenDeck's
  environment and no stdin. Anyone who can edit the profile can run commands
  as that user, as with OpenDeck's own Run Command action.
- A press succeeds when the command exits with status 0; the key then shows
  OpenDeck's check mark, otherwise its alert mark and a line in the plugin log.
  The key shows `WAIT` while the command runs and ignores presses meanwhile.
  The press completes when the command exits, even if it left a background
  process running.
- The command runs in its own process group. When a press or status check
  exceeds its timeout, the whole group is killed with SIGKILL, so a command
  that starts a long-running program must detach it, for example with
  `systemd-run --user` or `setsid -f`.
- Status: if the first line of stdout is `on`, `true`, `yes`, `active`,
  `enabled` or `1` the key is on; `off`, `false`, `no`, `inactive`, `disabled`
  or `0` means off. Any other output falls back to the exit status: 0 is on,
  anything else is off. A status command that cannot start or times out shows
  `ERROR`. Only the first 4 KB of status output is read; press output is
  discarded.
- Polling keeps the key correct when the state changes outside the deck, and
  each press is followed by an immediate status check.
- Missing or malformed settings (no `command`, a non-list `args`) show `ERROR`
  and a press shows the alert mark without running anything.

OpenDeck's bundled Starter Pack also has a Run Command action. That one runs
its command through `sh -c` and can only change the key's title text; this one
runs without a shell and draws its own status image.

**Herdr is required for the pulse and session keys.** Without its socket, those
keys show `OFFLINE`; quota and activity still use their independent sources.
Codex quota needs a signed-in Codex CLI, and OpenCode activity needs a populated
local database.

## Install this 15-key profile

The instructions assume OpenDeck is installed (`opendeck` on Arch), the
[Stream Deck udev rules](https://github.com/OpenActionAPI/rust-elgato-streamdeck/blob/main/40-streamdeck.rules)
are installed, and a 15-key MK.2 is connected. For the live keys, this setup
also uses a running Herdr server with its OpenCode integration, a signed-in
Codex CLI, and OpenCode's local database. Check those locally:

```bash
node -e "require('node:sqlite')"   # Node 22.13+ (22.x) or 23.4+
test -S "$HOME/.config/herdr/herdr.sock"
codex login status
test -r "$HOME/.local/share/opencode/opencode.db"
```

OpenDeck must be stopped before changing its profile JSON: it keeps profiles in
memory and can overwrite disk edits on exit. Work from the repository root:

```bash
pgrep -x opendeck || true    # quit OpenDeck if a PID appears
node --version               # Node 22.13+ (22.x) or 23.4+

OD="${XDG_CONFIG_HOME:-$HOME/.config}/opendeck"
D="sd-YOUR_DECK_SERIAL"      # use the device directory name under "$OD/profiles"

# Save your existing OpenDeck config outside the live config directory first.
cp -a "$OD" "$HOME/opendeck-before-agents"

mkdir -p "$OD/plugins" "$OD/profiles/$D/Agents"
cp -a integrations/opendeck/dev.krzysztof.agents.sdPlugin "$OD/plugins/"
jq --arg device "$D" '.keys[0].settings.device = $device' \
  integrations/opendeck/profiles/Agents/Home.json \
  > "$OD/profiles/$D/Agents/Home.json"
```

This profile includes the Back key provided by OpenDeck's bundled Starter Pack.
In the OpenDeck UI, add a **Switch Profile** action to an empty position on
`Default`, pointing at `Agents/Home`. The original setup uses position 7. Start
OpenDeck after installing the plugin and profile; it removes actions whose
plugins are unknown at load time. Do not copy the template without replacing
`sd-DEVICE_ID` in its Back key. An existing `Agents/Home` profile will be
replaced by the commands above, so check the backup first.

The key artwork is generated by the plugin as SVG data. The five `icons/*.svg`
files are the action-list and initial images. No OpenDeck `images/` snapshot,
third-party plugin collection, or lighting configuration is included. No
credentials are bundled; the Codex quota key uses the local CLI sign-in.

## Check it

Run `npm test` in `integrations/opendeck/dev.krzysztof.agents.sdPlugin` to
exercise slot assignment, quota parsing and cached-failure runtime behavior,
a Herdr socket round-trip, the local OpenCode SQL query, Claude record parsing
and refresh, the Run Command key (argument passing without a shell, lookup,
timeouts, status parsing, and a press-and-poll runtime cycle), and the 15-key
profile. The runtime tests use local fixtures and a simulated OpenDeck
transport; they make no provider requests. On the physical deck, open the
Agents page, confirm the status images update, press Pulse or a session key to
focus a real pane, press Quota to refresh it, and compare the activity keys to
your local OpenCode usage. A passing test run alone does not verify a real
OpenDeck, Herdr, Codex, and Omarchy session.

OpenDeck and Omarchy are upstream projects; this integration is independently
maintained and is not affiliated with either project.
