# Council Skill — Design

Date: 2026-07-19
Status: Approved (design review with user)
Origin: Adaptation of the technique in [karpathy/llm-council](https://github.com/karpathy/llm-council)

## Problem

A single model answers alone. karpathy/llm-council shows that fanning a query out
to several models, letting them rank each other's anonymized answers, and
synthesizing through a chairman produces materially better answers on hard,
judgment-heavy questions. The original is a local web app (FastAPI + React +
OpenRouter). This design ports the technique to a portable Agent Skill: the
harness session is the chairman, installed agent CLIs are the council members,
and files are the storage. No server, no extra API keys.

An advantage over the original: council members are CLI agents with read-only
repo access, so on code questions each member can explore the codebase
independently before answering. An API-only council cannot do that.

## Scope

- Public, portable skill `skills/council/` in llm-powerup (branch
  `feat/council-skill`), compliant with SPEC.md portability and safety rules.
- A personal overlay variant synced into the user's private llm-prompts repo.
  The overlay is standalone: no edits to other skills' routing tables.

## Decisions (resolved with user)

1. **Chairman + member.** The current session acts as chairman. A fresh
   headless `claude -p` (no conversation context) additionally sits on the
   council as a regular member.
2. **Quick mode default.** Default pipeline is Stage 1 (opinions) + Stage 3
   (synthesis). Stage 2 (anonymized peer ranking) runs only on request
   (`--full`).
3. **Bash runner.** Dispatch mechanics live in `scripts/council.sh` —
   deterministic, zero dependencies, testable, portable.
4. **Standalone integration.** The personal variant is invoked explicitly;
   MIND / ATLAS / pair-programmer skills are not modified.

## Layout

```
skills/council/
├── SKILL.md                  # chairman orchestration instructions
├── scripts/council.sh        # deterministic dispatch runner
└── references/cli-matrix.md  # per-CLI headless invocation + read-only flags
```

## Pipeline

Invocation: `/council <problem>` (quick) or `/council --full <problem>`.

1. **Discovery.** `council.sh` probes `command -v` for `gemini`, `codex`,
   `opencode`, `claude`. At least 2 members required, otherwise abort with an
   install hint. The chairman's own CLI (fresh `claude -p`) counts as a member.
2. **Stage 1 — Opinions.** The chairman writes one shared prompt file. The
   runner dispatches it to all members in parallel:
   - `claude -p` with a read-only tool allowlist (`Read,Grep,Glob`)
   - `codex exec --sandbox read-only`
   - `gemini -p` (read-only / no-approval flags per current docs)
   - `opencode run` (read-only agent mode per current docs)
   Exact flags are recorded in `references/cli-matrix.md` and verified against
   current official docs at implementation time (per llm-powerup SPEC: product
   CLIs change).
   Outputs land in `<run-dir>/responses/<member>.md`.
3. **Anonymization.** The runner shuffles and relabels responses to
   `response-A.md` … `response-D.md` and writes `mapping.json`. The chairman
   synthesizes from anonymized labels and de-anonymizes only for the final
   attribution table.
4. **Stage 2 — Peer review (`--full` only).** Each member receives the
   anonymized bundle and returns a structured ranking by accuracy and insight.
5. **Stage 3 — Synthesis.** The chairman produces: the final answer, a
   disagreement map (where members diverged and why it matters), and a
   per-member attribution table (plus rankings in full mode).

## Runner contract (`scripts/council.sh`)

- `council.sh dispatch <prompt-file> [--run-dir DIR] [--members LIST] [--timeout SECS]`
- `council.sh review <run-dir>` — stage 2 fan-out of the anonymized bundle
- `council.sh --dry-run …` — print the exact commands, execute nothing
- `council.sh --mock …` — run the full pipeline on canned fixture responses
- Exit codes: 0 = ok (≥2 responses collected), 1 = insufficient members
  discovered, 2 = fewer than 2 responses collected (including all-failed).
  Partial failure with ≥2 survivors is not an error.

## Safety (priority order: Safety > Performance > DX)

- **Bounded work:** per-member timeout 300 s (configurable), output capped at
  64 KB per member, member count capped at discovered CLIs.
- **Read-only:** no member may write files or run state-changing commands;
  enforced via each CLI's sandbox/allowlist flags, documented in
  `references/cli-matrix.md`.
- **No repo litter:** run dir defaults to the harness scratchpad (fallback:
  `mktemp -d`), never inside the working repo.
- **Fail-soft:** a member's timeout or failure is logged into the run dir and
  the council proceeds if ≥2 responses remain.
- **Dispatch = publish:** SKILL.md states explicitly that the prompt is sent
  to third-party providers (Google, OpenAI, …). Do not include secrets,
  credentials, personal data, or private identifiers in the prompt.

## Personal overlay (not part of the public skill)

A personal variant of this skill is maintained in the user's private prompts
repo, layering a mandatory pre-dispatch redaction gate (default ON) and
Polish-language synthesis output on the same pipeline. Details are
intentionally not published here — see the private repo directly.

## Error handling

- 0–1 CLIs discovered → abort with a message listing what was found and how to
  install members.
- All members fail → report raw errors; never fabricate a synthesis.
- Malformed or truncated member output → include verbatim with a warning;
  never silently drop a response.

## Testing

- `shellcheck` and `bash -n` on `council.sh`.
- `--dry-run` asserts the generated commands for each discovered CLI.
- `--mock` fixtures exercise dispatch → anonymize → review → collect without
  network calls, including the partial-failure path (one member missing).
- Pre-commit (`pre-commit run --all-files`) per repo standards.

## Out of scope

- Web UI, conversation persistence, OpenRouter integration (original repo
  features replaced by the harness).
- Automatic convening from MIND/ATLAS/pair-programmer routing tables
  (explicitly rejected in design review).
- Antigravity support (CLI not installed; can be added later via cli-matrix).
