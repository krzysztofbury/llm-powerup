# LLM Powerup

Portable, production-minded Agent Skills and optional harness integrations for
Claude Code, Codex, and OpenCode.

## Contents

- `skills/` contains portable [Agent Skills](https://agentskills.io/).
- `integrations/claude/` contains optional Claude Code hooks. They do not apply
  to Codex or OpenCode.

## Available Skills

| Skill | Purpose |
| --- | --- |
| `council` | Convene installed agent CLIs as a multi-model council with anonymized peer review. |
| `data-news` | Curate a current data engineering and database briefing. |
| `oura` | Summarize user-authorized health and readiness data. |
| `pair-programmer` | Apply a safety-first engineering review workflow. |
| `pg-performance-advisor` | Diagnose PostgreSQL performance with read-only, redacted queries. |
| `plausible-insights` | Analyze privacy-friendly web analytics through an authorized adapter. |
| `sentry-observability` | Design and review Sentry observability with privacy controls. |
| `ubiquiti-advisor` | Review a user-authorized UniFi network configuration. |
| `whatsapp-style-guide` | Format concise, mobile-first WhatsApp messages. |

## Install A Skill

Symlink a selected skill directory into the location your harness discovers:

```bash
ln -s "$PWD/skills/<skill-name>" "$HOME/.claude/skills/<skill-name>"
ln -s "$PWD/skills/<skill-name>" "$HOME/.agents/skills/<skill-name>"
```

Claude Code, Codex, and OpenCode support the Agent Skills directory format.
Symlink into the skills location your harness discovers. Review a skill and
its dependencies before linking it: some require an authorized analytics,
health-data, database, or network adapter.

## Safety And Privacy

- Never commit secrets, local permission files, network snapshots, or telemetry
  payloads.
- Skills default to analysis and recommendations. Actions with external impact
  require explicit user confirmation.
- Product APIs and SDKs change. Check the linked official documentation before
  applying integration examples to production.

## Scope

This is an independent community project, not affiliated with the services or
products named in individual skills.

## Project Docs

- [Specification](SPEC.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Code of conduct](CODE_OF_CONDUCT.md)
- [Changelog](CHANGELOG.md)
- [License](LICENSE)
