# Skills Specification

## Scope

This repository publishes portable Agent Skills, the hooks and rules that go
with them, reusable prompts, optional harness and tool integrations, and the
installer that links all of it into Claude Code, Codex, OpenCode, and Gemini
CLI. `skills/` must remain portable across harnesses. `hooks/` and
`integrations/` may use platform-specific behavior and must say so.

## Public By Default

Every skill here is public and generic. Anything that depends on one user,
such as accounts, sites, devices, brand, vault layout, or language preferences,
is configuration: an environment variable or a file under
`~/.config/<skill>/`, documented in a "Configuration" section of the skill's
`SKILL.md` with a safe default. Private skills live in their owner's own
repository and are linked next to these through an installer sources file
(see [docs/INSTALL.md](docs/INSTALL.md)), never copied in here.

## Safety And Privacy

- Reviews stay read-only. Implementation requests authorize the requested
  local edits. External actions require authorization for their target and scope.
- Do not add credentials, local paths, internal hosts, customer data, telemetry,
  network inventories, or unredacted logs.
- Do not copy private prompts or operational patterns into public skills.
- Database guidance is read-only by default and must omit query text, client
  addresses, role names, and application names unless explicitly authorized.
- Hooks detect known patterns, not arbitrary shell behavior. For recognized
  commands, uncertain targets cannot use quiet-path exemptions. Document gaps
  and runner failure behavior; permissions and least-privilege access enforce
  boundaries independently.
- Prefer a harness setting over a hook when the harness offers one. Hooks are
  for rules no harness setting can express.

## Repository Layout

- `skills/<name>/SKILL.md`: Agent Skill entry point and public instructions.
- `skills/<name>/references/`: focused supporting material loaded only when
  relevant. `skills/<name>/scripts/`: helpers the skill runs.
- `hooks/claude/`: Claude Code hook scripts, `hooks.json` (the wiring the
  installer merges into settings), and the merge script.
- `hooks/codex/`: the Codex patch lint hook, its wiring, and the merge script.
- `rules/AGENTS.md`: global base rules installed for every harness.
- `prompts/`: standalone prompts for writing and improving skills.
- `integrations/<platform>/`: optional integrations, such as the Claude Code
  status line and the OpenDeck control surface.
- `scripts/`: the installer, `agent-scratch`, and model-free OpenCode
  diagnostics (`check-council-opencode.mjs`, `check-opencode-skills.mjs`).
- `docs/`: installation and tooling guides.
- `tests/`: Node tests for hooks, the installer, and shared tooling.
- `.github/workflows/`: `ci.yml` validates every change; `release.yml`
  publishes a semantic-version release for every merge to `main`
  ([RELEASE.md](RELEASE.md)).

## Validation

Run before submitting a change:

```bash
pre-commit run --all-files
while IFS= read -r -d '' file; do bash -n "$file"; done < <(git ls-files -z '*.sh')
node --test tests/*.test.mjs integrations/opendeck/dev.krzysztof.agents.sdPlugin/test/*.test.js
bash skills/council/scripts/council_test.sh
bash skills/retro/scripts/ledger_test.sh
```

Exercise every hook with safe and confirmation-required JSON fixtures. Review
all new text for private identifiers, secret-like values, non-English text,
and em or en dashes before publishing.
