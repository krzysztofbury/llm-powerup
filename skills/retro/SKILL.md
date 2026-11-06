---
name: retro
description: Review a finished session and propose improvements to the project's agent instructions, skills, checklists and harness configuration, then record the outcome in a local SQLite ledger. Use for an explicit /retro or a request to improve the working process after a session, not for an ordinary session summary or sign-off.
---

# Retro

Turn supported lessons from a session into approved changes. No change is a
valid outcome. Work from the session already in context; do not export the
transcript to other providers. If the context was compacted and is incomplete,
name the gap instead of reconstructing missing events.

## Configuration

Retro works on the current project's own files by default. Nothing needs to
be configured; the settings below only change where things are stored.

| Setting | How to set it | Default |
|---|---|---|
| Ledger database | env `RETRO_LEDGER`, then key `ledger` in `~/.config/retro/config.json` | `${XDG_STATE_HOME:-~/.local/state}/retro/ledger.sqlite` |
| Knowledge inbox | key `knowledge_inbox` in `~/.config/retro/config.json` | none; durable knowledge goes to project docs |

The config file lives under `${XDG_CONFIG_HOME:-~/.config}`. Example:

```json
{
  "ledger": "~/notes/retro-ledger.sqlite",
  "knowledge_inbox": "~/notes/inbox/knowledge-candidates.md"
}
```

Keep the ledger outside public or shared repositories. It may hold project
names and remote URLs.

### Ledger script

All ledger access goes through `scripts/ledger.py` in this skill's directory.
It needs only Python 3 and its standard library, and creates the database and
its parent directory on first use. Never write SQL by hand against the ledger.

```bash
python3 -I scripts/ledger.py add --goal partial --harness codex \
  --helped "..." --friction "..." --changes "..." --candidates "..."
python3 -I scripts/ledger.py list [--project ID] [--limit N] [--json]
python3 -I scripts/ledger.py search PATTERN [--project ID] [--json]
python3 -I scripts/ledger.py path    # print the resolved database path
```

- `add` prints the new entry id. `--project` defaults to the git remote
  `origin` URL (credentials stripped), else the git toplevel path; outside a
  repository pass it explicitly. `--goal` is `achieved`, `partial` or
  `not_achieved`. `created_at` is set to the current UTC time.
- `list` shows recent entries, newest first (default 20).
- `search` is a case-insensitive substring match over `friction`, `changes`
  and `candidates`; text output ends with `matches: N`.

Table `entries`: `id`, `created_at` (ISO 8601 UTC), `project`, `harness`,
`goal`, `helped`, `friction`, `changes`, `candidates`.

Run the script with the skill directory as the base path; harnesses install
skills in different places. Test: `bash scripts/ledger_test.sh`.

## Default targets

Changes land in the project that the session worked on:

- agent instructions: `AGENTS.md`, `CLAUDE.md` and their nested copies;
- specification and docs: `SPEC.md`, `README`, `docs/`;
- project skills and checklists, for example `skills/`, `.claude/skills/`,
  `.agents/skills/`;
- harness configuration: hooks, permission and settings files of the harness
  in use.

Edit a user-level or global file only when the user names it. If a target is
generated or installed from another source, change the source and say so.

## Pipeline

1. **Review.** Goal and how far it was reached, practices that helped, user
   corrections, friction, failures and their causes, and skills used or
   skipped. Separate a confirmed cause from a hypothesis.
2. **Sort** each supported finding into one bucket:
   - (a) change an existing skill or checklist, with a concrete edit;
   - (b) candidate for a new skill or checklist;
   - (c) harness configuration: `AGENTS.md`, `CLAUDE.md`, hooks, permissions;
   - (d) durable knowledge about the project or domain.
3. **Show** one compact table: finding | bucket | proposed change | target
   file. Skip empty buckets. Include removal or narrowing of rules when
   warranted. Do not invent lessons to fill the table.
4. **Approve.** Apply (a) to (c) only after explicit approval of the specific
   proposal; approval may cover a subset. Bucket (d) goes to project docs, or
   is appended as a candidate to the configured `knowledge_inbox`; a candidate
   is not a fact until the user accepts it.
5. **Apply and verify** the approved changes in proportion to their risk.
6. **Record** one ledger entry with `ledger.py add`, describing what actually
   changed, not the plan. A session with no changes still gets a short entry
   with `--changes none`.

If the user asks for a retro without recording, skip step 6 and the ledger
entirely; the table is the result.

## Two-occurrence rule

Before proposing a new skill or checklist, search the ledger for the same
failure pattern with `ledger.py search <keyword>`, trying a few synonyms. The
first occurrence is recorded as a candidate in `--candidates` with its count.
A second occurrence justifies creating it. An empty or missing ledger is not
evidence that a pattern never happened. Prefer fixing an existing workflow or
removing dead instructions over adding a parallel one for a one-off problem.

## Rule retirement review

For each existing rule touched by a finding, ask which recurring failure it
prevents, what current evidence still justifies its cost, and whether a
harness or tool change removed the cause. Propose removing, narrowing or
merging rules that are dead, conflicting or duplicated instead of adding a new
one on top. Record the rule's scope, evidence and a review date or trigger in
the ledger entry. Retirement needs the same approval as an addition; the
ledger keeps the decision history.

## Ledger entry fields

| Option | Content |
|---|---|
| `--goal` | `achieved`, `partial` or `not_achieved` |
| `--helped` | a concrete practice that helped, or `none` |
| `--friction` | problem and confirmed cause, or a labeled hypothesis |
| `--changes` | files actually changed and rules retired, or `none`; add a review date or trigger for changed rules |
| `--candidates` | pattern and occurrence count, for example `stale PR head merged x1`, or `none` |

Use short, searchable wording for patterns so a later `search` finds them.

## Boundaries

- Keep secrets, credentials and personal data out of the ledger and out of
  shared or public repositories.
- Describe processes and evidence, not people; do not copy raw transcripts or
  data into the ledger.
- Harness-specific insight commands can supply observations, but they do not
  replace approval or the changes themselves.
