---
name: oura
description: Summarize and interpret Oura Ring data - sleep, readiness, activity, stress, heart rate and trends - from the Oura API v2 or an MCP server that exposes Oura data. Use when the user asks how they slept, how recovered they are, or about their Oura scores and health trends.
compatibility: Requires either an Oura API v2 access token in an environment variable or a connected MCP server that exposes Oura data.
---

# Oura Health Summary

Read the user's Oura data from the configured source and present it as a
short, grounded summary. Scores are context, not a diagnosis or medical advice.

## Configuration

Two data sources are supported. Configure one; the user may set these in the
shell environment or name the MCP server in the project or user agent
instructions (`AGENTS.md`, `CLAUDE.md` or equivalent).

| Variable | Meaning |
|---|---|
| `OURA_MCP_SERVER` | Name of a connected MCP server that exposes Oura data. Takes precedence when set and reachable. |
| `OURA_TOKEN` | Oura API v2 access token, used when no MCP server is configured. |
| `OURA_SOURCE` | Optional: `mcp` or `api` to force one source. |

**MCP server.** Find the server's tools in the harness tool catalog; tool name
prefixes differ between Claude Code, Codex and OpenCode. If the harness has a
tool search, search for the server name plus "oura". Use only read tools.

**Oura API v2.** Base URL `https://api.ouraring.com/v2/usercollection/`,
authentication `Authorization: Bearer <token>`, and every request needs a
`User-Agent` header. Oura retired personal access tokens in December 2025, so
the token is an OAuth2 access token from an application the user registered
in the Oura developer portal. Obtaining and refreshing it is the user's setup,
outside this skill.

- Never ask the user to paste a token, cookie or authorization code into chat,
  and never print, echo or log the token.
- Read the token from the environment inside the command, and keep it out of
  the process arguments:

```bash
printf 'Authorization: Bearer %s\n' "$OURA_TOKEN" |
  curl -sS --fail-with-body -H @- -H 'User-Agent: oura-skill/1.0' \
    'https://api.ouraring.com/v2/usercollection/daily_readiness?start_date=2026-01-01&end_date=2026-01-07'
```

Filter the JSON to the fields you need (for example with `python3 -I -c` or
`jq`) instead of printing the raw response.

| Endpoint | Data | Range parameters |
|---|---|---|
| `daily_sleep` | sleep score and contributors | `start_date`, `end_date` |
| `sleep` | sleep periods: stages, HRV, lowest heart rate, timing | `start_date`, `end_date` |
| `daily_readiness` | readiness score, contributors, temperature deviation | `start_date`, `end_date` |
| `daily_activity` | activity score, steps, calories, contributors | `start_date`, `end_date` |
| `daily_stress` | stress and recovery time, day summary | `start_date`, `end_date` |
| `daily_resilience` | resilience level and contributors | `start_date`, `end_date` |
| `heartrate` | heart-rate time series | `start_datetime`, `end_datetime` |
| `workout`, `session` | workouts and guided sessions | `start_date`, `end_date` |

Dates are `YYYY-MM-DD`; datetimes are ISO 8601. Results are paginated with
`next_token`. Other endpoints (SpO2, VO2 max, cardiovascular age, tags) are in
the official reference at `https://cloud.ouraring.com/v2/docs`; check it before
relying on a parameter not listed here.

If neither source is configured, say which one is missing, point to this
section and stop. Do not guess values.

## Workflow

1. Identify the question: sleep, readiness, activity, stress, heart rate, a
   trend or a general health summary.
2. Fetch only the metrics and the shortest date range that answer it. For a
   trend or baseline comparison, a recent window such as 14 to 30 days is
   usually enough.
3. Present the result (see below), comparing with the user's own history when
   the data allows it.
4. Offer one or two low-risk, practical suggestions only when the data supports
   them.

## Presentation

- State the measurement date and period, and call out missing days or data
  that has not synced yet.
- Oura scores are the manufacturer's scale, not a diagnosis: 0-59 pay
  attention, 60-69 fair, 70-84 good, 85-100 optimal
  ([Oura readiness score](https://support.ouraring.com/hc/en-us/articles/360025589793-An-Introduction-to-Your-Readiness-Score)).
  Apply these bands only to Oura scores, not to raw measurements or other
  scales.
- Name the key contributors and what drove the score up or down.
- Compare with the user's own baseline (for example the 14 or 30 day average)
  rather than with population norms. When there is no baseline, say so.
- For a notable deviation, give a cautious hypothesis labeled as such (late
  meal, alcohol, training load, travel, illness onset) and one practical step,
  never a diagnosis or a change to medication or treatment.
- Recommend a qualified clinician for persistent, severe or concerning
  symptoms.
- Answer in the user's language.

```text
Period: YYYY-MM-DD to YYYY-MM-DD

Summary: one sentence grounded in the returned data.
Key signals:
- Metric: value - contribution or trend vs. baseline.

Context: comparison to the user's baseline, or "no baseline available".
Next step: one practical, non-medical action.
```

## Common questions

| Question | Data to fetch |
|---|---|
| "How did I sleep?" | `daily_sleep` and `sleep` for last night |
| "How recovered am I?" / readiness | `daily_readiness` for today, with `sleep` for HRV and resting heart rate |
| "How active was I?" | `daily_activity` for today or the requested days |
| "How stressed was I?" | `daily_stress` for today or the requested days |
| Heart rate during a period | `heartrate` for that window only |
| "Health summary" / weekly review | daily sleep, readiness, activity and stress for the period, with a baseline |

With an MCP server, map each row to the server's equivalent read tool.

## Errors

- **No data for the period:** the ring may not have synced; suggest opening
  the Oura app with Bluetooth on, then retry.
- **401 Unauthorized:** the token is missing, expired or revoked; ask the user
  to refresh it outside the chat.
- **403 Forbidden:** the token lacks the needed scope, or the Oura membership
  has expired.
- **429 Too Many Requests:** rate limited; wait and retry later rather than
  looping.
- **MCP server unreachable or missing:** name the configured server and ask
  the user to check that it is running and connected.
- **Anything else:** give a short, safe description and an error id if one is
  available. Never show raw health payloads, tokens or response headers.

## Data handling

- Do not store daily Oura values in project files, notes or memory; the source
  stays authoritative. Save a summary only when the user asks for it.
- Do not expose raw API responses, identifiers or provider errors unless the
  user asks for diagnostics and understands what will be shown.
