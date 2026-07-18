# LLM Powerup Specification

## Scope

This repository publishes portable Agent Skills and optional harness
integrations. `skills/` must remain portable across Claude Code, Codex, and
OpenCode. `integrations/` may use harness-specific behavior and must say so.

## Safety And Privacy

- Skills default to analysis and recommendations. External actions require
  explicit user confirmation.
- Do not add credentials, local paths, internal hosts, customer data, telemetry,
  network inventories, or unredacted logs.
- Do not copy private prompts or operational patterns into public skills.
- Database guidance is read-only by default and must omit query text, client
  addresses, role names, and application names unless explicitly authorized.
- Hooks are guardrails, not security boundaries. They must fail safely by asking
  for review when their input cannot be inspected.

## Repository Layout

- `skills/<name>/SKILL.md`: Agent Skill entry point and public instructions.
- `skills/<name>/references/`: focused supporting material loaded only when
  relevant.
- `integrations/<harness>/`: optional integration code and installation guide.

## Validation

Run before submitting a change:

```bash
pre-commit run --all-files
bash -n integrations/claude/hooks/*.sh
```

Exercise every hook with safe and confirmation-required JSON fixtures. Review
all new text for private identifiers and secret-like values before publishing.
