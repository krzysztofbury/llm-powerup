---
name: council
description: Convene a council of installed agent CLIs (agy, claude, codex, gemini, opencode) on one hard problem - parallel independent opinions, optional anonymized peer ranking, chairman synthesis. Use for high-stakes decisions, architecture trade-offs, contested reviews, or questions where one model's blind spots matter.
compatibility: Requires at least two authenticated CLIs among agy, claude, codex, gemini, opencode, and a POSIX shell with bash.
---

# Council

Adaptation of the technique in [karpathy/llm-council](https://github.com/karpathy/llm-council):
fan a problem out to several models, optionally let them rank each other's
anonymized answers, then synthesize as chairman. You (the agent reading this)
are the chairman. `scripts/council.sh` handles dispatch mechanics.

## When to convene

- High-stakes or judgment-heavy decisions where a second and third opinion matter.
- Architecture trade-offs and contested code reviews (members explore the repo
  read-only — convene from the repo root).
- NOT for routine questions: a council run costs one call per member per stage.

## Before dispatch: dispatch = publish

The prompt is sent to third-party providers (Google, OpenAI, and others).
Never include secrets, credentials, personal data, or private identifiers.
Recommended practice: rewrite the problem into a self-contained, redacted
prompt and show it to the user before dispatching.

## Pipeline

1. Check the bench: `scripts/council.sh members` (needs >= 2; exit 1 otherwise).
   Tell the user who sits on the council.
2. Write the problem to a prompt file in a temp directory (never in the repo).
   Make it self-contained: the members have no conversation context. State the
   question, constraints, and desired output format.
3. Stage 1 — opinions: `scripts/council.sh dispatch <prompt-file>`.
   The last stdout line is the run directory. Exit 2 means fewer than two
   usable responses: report the contents of `<run-dir>/meta/*.err` verbatim
   and stop — never synthesize from a single opinion as if it were a council.
4. Quick mode (default): skip to step 6.
5. Full mode (only when the user asks for `full` or peer ranking):
   `scripts/council.sh review <run-dir>` — each member ranks the anonymized
   responses; rankings land in `<run-dir>/reviews/`.
6. Stage 3 — synthesis (you, the chairman):
   - Read `<run-dir>/anon/response-*.md` FIRST and form your judgment on the
     anonymized texts (and `reviews/*.md` in full mode).
   - Only then open `anon/mapping.json` to attribute authors.
   - A fresh headless claude sits on the council as a regular member; you are
     not bound to prefer it.

## Synthesis output format

1. **Final answer** — your synthesis, taking the best-supported points.
2. **Disagreement map** — where members diverged and why it matters. If the
   council is unanimous, say so in one line.
3. **Attribution table** — member | position in one sentence (| avg rank, in
   full mode).

## Failure handling

- Exit 1 from any subcommand: fewer than 2 CLIs installed — tell the user
  which members were found and what to install (see references/cli-matrix.md).
- A member's failure or timeout is recorded in `<run-dir>/meta/`; name the
  missing member in your synthesis so the user knows the bench was short.
  Review-stage (peer-ranking) failures are recorded the same way in
  `<run-dir>/reviews-meta/`. A failed member's partial output, if any, is
  preserved as `meta/<member>.partial` — diagnostic material, never a
  council opinion.
- Malformed or truncated output: quote it verbatim with a warning; never
  silently drop a member's response.

## Tuning

- `--timeout SECS` (default 300) for slow members; `--members "a b c"` to
  restrict the bench; per-member model overrides: references/cli-matrix.md.
- Mechanics testing without API calls: `council.sh --mock`, `--dry-run`, and
  `scripts/council_test.sh`.
