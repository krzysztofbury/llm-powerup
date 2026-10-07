# LLM Powerup Specification

## Scope

This repository publishes portable Agent Skills and optional harness and tool
integrations. `skills/` must remain portable across Claude Code, Codex, and
OpenCode. `integrations/` may use platform-specific behavior and must say so.

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

## Repository Layout

- `skills/<name>/SKILL.md`: Agent Skill entry point and public instructions.
- `skills/<name>/references/`: focused supporting material loaded only when
  relevant.
- `integrations/<platform>/`: optional integration code and installation guide.

## Validation

Run before submitting a change:

```bash
pre-commit run --all-files
while IFS= read -r -d '' file; do bash -n "$file"; done < <(git ls-files -z '*.sh')
node --test tests/*.test.mjs integrations/opendeck/dev.krzysztof.agents.sdPlugin/test/*.test.js
bash skills/council/scripts/council_test.sh
```

Exercise every hook with safe and confirmation-required JSON fixtures. Review
all new text for private identifiers and secret-like values before publishing.
