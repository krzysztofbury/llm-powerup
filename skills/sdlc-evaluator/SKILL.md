---
name: sdlc-evaluator
description: >-
  Audit a repository (or compare several) against agentic SDLC: legibility
  (AGENTS.md), tools agents can operate, evaluation of agentic knowledge, and
  proof artifacts. Use for "how we work with agents" reviews, before adding
  AGENTS.md, or when designing a control/treatment AGENTS.md experiment. Do
  not use for ordinary code review (use the pair-programmer skill) or test
  pruning (use the test-audit skill).
---

# SDLC Evaluator

Score agent readiness, not product features. Prefer read-only access to the
hosting service (for example the `gh` CLI) or a fresh clone. Do not open PRs
unless the user asked.

## Rubric (four axes)

For each repo, score **Strong / Partial / Weak / Missing** with one-line
evidence (path or tool name):

1. **Legibility** - `AGENTS.md` (or the harness equivalent such as
   `CLAUDE.md`) with authority, work rhythm, claim ban, and an explicit "this
   is not evidence" list. Pointers to review skills (for example the
   `pair-programmer` and `test-audit` skills) count toward Strong.
2. **Tools** - what an agent can operate without HTML scraping: health/readiness,
   feature flags, deploy/smoke CLIs, MCP SDLC tools, doctor/check commands.
   Human-gated mutators (Ansible, secrets) are fine if documented as such.
3. **Eval** - whether agentic knowledge is tested (evals/, blind AGENTS.md
   experiments, contract tests for tool catalogs). Product model evals alone
   are Partial, not Strong, for this axis.
4. **Proof** - living verification log (`VERIFICATION.md`, `release-evidence/`,
   `release_verification/`), post-deploy templates, CI links with limits named
   ("does not prove ..."). Claim bans without artifacts stay Partial.

## Method

1. List root docs (`AGENTS.md`, `VERIFICATION.md`, `RELEASE.md`, `CONTRIBUTING.md`,
   `MCP_CONTRACT.md`, `evals/`, `scripts/`).
2. Sample MCP/CLI surfaces for health, doctor, measure, deploy, feature flags.
3. Skim CI for release-evidence uploads or live-check workflows.
4. Write a scorecard table, then a prioritized action list (issues, not code,
   unless asked).
5. Optional experiment: same fixed task, N blind agents, control without
   `AGENTS.md` excerpt vs treatment with claim ban + non-evidence list. Score
   whether the PR "done" comment claims production, and whether evidence lists
   reject CI-alone / coverage / grep. Report counts, not vibes.

## Report shape

- Bottom line (2-4 sentences)
- Scorecard table
- Prioritized actions (owner picks)
- Skills: whether a new skill is warranted (prefer this skill over overloading
  the `pair-programmer` skill)

Skip forcing admin/flag/email plugins onto library-only repos (for example an
API client library) unless the user asks.
