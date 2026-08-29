---
name: retro
description: End-of-session retrospective that turns lessons into system changes, not a diary. Use when the user says /retro, "I'm done", "wrap up the session", "podsumuj sesję", or asks what went well / badly and which skills, checklists, or configs should change. Works in any harness that reads Agent Skills (Claude Code, Codex, OpenCode, and similar) because the session transcript is already in the model's context.
---

# Retro

A session retrospective whose output is **diffs to your operating system**
(skills, checklists, harness config), with an append-only ledger as the
by-product. A retro that only writes reflections into a file nobody reads
is theater; the deliverable is change.

## Configuration

- `LEDGER`: path of the append-only retro log. Default: `RETRO.md` in the
  current repository root. A personal variant of this skill may override it.
- `MEMORY_INBOX` (optional): file for personal-knowledge candidates. If unset,
  bucket (d) findings are shown to the user instead of written anywhere.

## Pipeline

1. **Review the session from your own context.** No exports, no APIs - you
   were there. Answer concretely:
   - What was the goal? Was it reached?
   - What went well - and would have gone badly without which practice?
   - Where did the user correct you, repeat themselves, or express friction?
   - What failed, was retried, or was abandoned? Root cause, not symptom.
   - Which skills/checklists were used? Which SHOULD have been used but were
     not, or fired but gave bad guidance?
2. **Classify each finding into exactly one bucket:**
   - (a) update to an existing skill/checklist - include the concrete edit;
   - (b) candidate for a NEW skill/checklist - see the two-strikes rule;
   - (c) harness configuration - CLAUDE.md / AGENTS.md / hooks / permissions;
   - (d) personal knowledge - facts about the user or project worth keeping.
3. **Present one compact table:** finding -> bucket -> proposed change ->
   target file. No essays. Skip empty buckets. If the session produced no
   system-worthy findings, say so and append only a one-line ledger entry -
   an honest "nothing to change" beats invented insight.
4. **Approval gate.** File edits in buckets (a)-(c) happen only after the
   user approves the table (they can approve a subset). Bucket (d) goes to
   `MEMORY_INBOX` automatically when it is configured.
5. **Apply approved edits**, then append one entry to `LEDGER` (newest on
   top) recording findings and what actually changed.

## Two-strikes rule (anti-sprawl)

Before proposing a NEW skill or checklist, search `LEDGER` for the same
failure pattern. A first occurrence is logged as a candidate, nothing is
created. Only a second occurrence earns creation - one-off pain is noise,
repeated pain is a process gap. Corollary: prefer editing an existing skill
over adding one, and prefer deleting a dead skill over keeping it. A retro
that only ever adds files reproduces the mess it was built to fix.

## Ledger entry format

```markdown
## YYYY-MM-DD · harness · project
- Goal: <one line> (reached / partly / no)
- Went well: <one line>
- Friction: <one line, root cause>
- Changes: <files edited, or "none">
- Candidates: <new-skill candidates with occurrence count, or "none">
```

## Boundaries

- Never include secrets, credentials, or private personal content in a
  ledger that lives inside a shared or public repository.
- The retro reviews the session, not the person: findings name processes
  and files, not blame.
- Keep the whole retro under ~2 minutes of user attention: one table, one
  approval, done.
