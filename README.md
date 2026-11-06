# Skills

Portable, production-minded Agent Skills, the hooks and base rules that go
with them, and an installer that links them into Claude Code, Codex, OpenCode,
and Gemini CLI.

## Contents

- `skills/`: portable [Agent Skills](https://agentskills.io/).
- `hooks/`: optional Claude Code guard and lint hooks, and the Codex patch lint
  hook. See [hooks/README.md](hooks/README.md).
- `rules/AGENTS.md`: harness-agnostic base rules for coding agents, installed
  as `CLAUDE.md` / `AGENTS.md` for each harness.
- `prompts/`: standalone prompts for writing, scoring, and improving skills.
- `integrations/`: the Claude Code status line and the
  [OpenDeck Agents control surface](integrations/opendeck/README.md).
- `scripts/`: the installer, `agent-scratch`, a disposable scratch-directory
  helper for agents ([docs/AGENT-SCRATCH.md](docs/AGENT-SCRATCH.md)), and
  model-free OpenCode checks for council isolation and skill discovery.

## Available Skills

| Skill | Purpose |
| --- | --- |
| `article-curator` | Turn clipped web articles into concise, reusable notes in a configurable folder and format. |
| `council` | Convene installed agent CLIs as a multi-model council with anonymized peer review and a redaction gate. |
| `mcp-tool-design` | Write, review, and score MCP tool definitions so agents pick and call them correctly. |
| `oura` | Summarize sleep, readiness, and activity from the Oura API or an Oura MCP server. |
| `pair-programmer` | Evidence-based code review, design trade-offs, and debugging, with proof before completion claims. |
| `pg-performance-advisor` | Diagnose PostgreSQL performance with read-only, redacted queries. |
| `plausible-insights` | Analyze Plausible Analytics traffic, content, and SEO for a configured site. |
| `retro` | Run a session retrospective that improves the project's rules and skills, with a SQLite ledger. |
| `sdlc-evaluator` | Audit a repository against an agentic software development lifecycle. |
| `sentry-observability` | Design and review Sentry observability with privacy controls. |
| `test-audit` | Check whether Python and SQL tests protect real behavior. |
| `ubiquiti-advisor` | Review a UniFi network through a configured, read-only controller connection. |
| `video-edit` | Edit recorded footage from a word-level transcript: cuts, cards, subtitles, loudness, vertical Shorts, verified renders. |
| `whatsapp-style-guide` | Format concise, mobile-first WhatsApp messages. |

Skills that need user-specific details, such as a site, a device, a brand, or a
data source, read them from documented configuration. Each skill's `SKILL.md`
has a Configuration section where that applies.

## Install

```bash
scripts/install.sh            # every harness
scripts/install.sh --claude   # Claude Code only
scripts/install.sh --dry-run  # show what would change
```

Skills are symlinked, never copied. A sources file can add your own private
skills and pinned skills from other repositories next to these ones, without
forking or copying them. See [docs/INSTALL.md](docs/INSTALL.md).

Review a skill and its dependencies before linking it: some require an
authorized analytics, health-data, database, or network connection.
`video-edit` needs ffmpeg, Node, and local Whisper; see its Requirements
section.

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
- [Installing](docs/INSTALL.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Code of conduct](CODE_OF_CONDUCT.md)
- [Changelog](CHANGELOG.md)
- [License](LICENSE)
