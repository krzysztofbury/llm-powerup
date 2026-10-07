# Agents on OpenDeck and Omarchy

**A physical AI-agent dashboard, built on [OpenDeck](https://github.com/nekename/OpenDeck)
and used on [Omarchy](https://github.com/basecamp/omarchy) 4.**
This is the actual 15-key Elgato Stream Deck MK.2 Agents page, not a generic
deck layout. The OpenDeck plugin draws live status; Herdr supplies agent state
and pane focus; Codex and OpenCode supply their own local metrics. Omarchy
provides the surrounding Linux desktop workflow. The plugin does not call
Omarchy commands itself.

This integration uses OpenDeck 2.14's profile format and plugin protocol, on
Linux with Node 22.13+ (22.x) or 23.4+. These versions expose `node:sqlite`
without a flag, as documented in the [Node SQLite history](https://nodejs.org/api/sqlite.html).
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
of `Default`, linking to `Agents/Home`. Positions 8 and 9 are empty; the bottom
row has system gauges. Other OpenDeck profiles in the setup control Hyprland's
master layout, Omarchy's screenshot/OCR tools, media over MPRIS, and OBS. The
Agents page here is the only profile published by this integration; those
other keys depend on separate plugins, commands, and local device settings.

## Data paths and refresh

| Key | Local source | Refresh while visible |
| --- | --- | --- |
| Pulse and sessions | Herdr Unix socket at `~/.config/herdr/herdr.sock`; `session.snapshot` and `agent.focus` | 2 seconds |
| Quota | `codex app-server --stdio` with `CODEX_HOME=~/.codex` | 5 minutes (press to force refresh) |
| Activity | Read-only `~/.local/share/opencode/opencode.db` | 60 seconds (press to refresh) |

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
memory and can overwrite disk edits on exit. Work from the `llm-powerup` root:

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
a Herdr socket round-trip, the local OpenCode SQL query, and the 15-key profile.
The quota runtime test uses a local CLI fixture and simulated OpenDeck transport;
it makes no provider requests. On the physical deck, open the
Agents page, confirm the status images update, press Pulse or a session key to
focus a real pane, press Quota to refresh it, and compare the activity keys to
your local OpenCode usage. A passing test run alone does not verify a real
OpenDeck, Herdr, Codex, and Omarchy session.

OpenDeck and Omarchy are upstream projects; this integration is independently
maintained and is not affiliated with either project.
