---
name: retro
description: Review a session to propose improvements to skills, checklists or harness configuration. Use for explicit /retro or a request to improve the working process, not an ordinary session summary or sign-off.
---

# Retro

Turn supported lessons into approved changes. No change is a valid outcome.
Use the session evidence already available; disclose gaps after compaction
instead of reconstructing missing events or exporting the transcript.

## Configuration

- `LEDGER`: user-configured private log outside public/shared repositories.
  If unset, present the entry in chat and ask for a destination only when the
  user wants it saved. Do not silently create `RETRO.md` in the current repo.
- `MEMORY_INBOX` (optional): configured destination for personal-knowledge
  candidates, subject to its source/approval contract. Candidates are not facts.

## Workflow

1. Review the goal, outcome, useful practices, user corrections, failures and
   skill usage. Separate confirmed causes from hypotheses.
2. Classify supported findings as existing skill/checklist changes, new-skill
   candidates, harness configuration, or durable knowledge candidates.
3. Show a compact table: finding, proposed change, evidence and target file.
   Skip empty categories. Include removal or narrowing when warranted.
4. Apply skill/configuration edits only after approval of the specific proposal;
   approval may cover a subset. Route knowledge candidates through the configured
   inbox contract, or present them in chat when no inbox is configured.
5. Verify approved changes proportionately. Add a new entry at the top of the
   configured ledger, preserving all prior entries. Record actual changes,
   not planned ones. If no ledger is configured, return the entry in chat.

## Avoid instruction accumulation

Before proposing a new skill, look for the same failure pattern in the available
ledger. One occurrence supports a candidate; a second supports considering a
skill. Missing history is not proof of recurrence. Prefer improving an existing
workflow over adding a parallel one.

For an existing rule, ask what recurring failure it prevents and what current
evidence justifies its cost. Propose retirement, narrowing or consolidation if
the cause disappeared, the harness changed, or the rule duplicates or conflicts
with stronger guidance. Record the rule's scope, evidence and review date or
trigger. Retire it only after approval, preserving the decision history.

## Ledger entry

```markdown
## YYYY-MM-DD | harness | project
- Goal: reached / partly / no
- Helpful practice: evidence, or none
- Friction: confirmed cause or hypothesis
- Changes: actual files and retired rules, or none
- Candidates: pattern and occurrence count, or none
- Review: date or condition for revisiting changed rules
```

Keep secrets and personal information out of shared/public repositories.
Describe processes and evidence, not blame. A concise table and the resulting
diffs are enough; do not invent lessons to fill a template.
