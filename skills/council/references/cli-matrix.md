# Council CLI matrix

Real dispatch supports Claude Code, Codex and OpenCode V2. Node.js 20+ and
POSIX process groups are required. Each CLI receives a self-contained prompt
on stdin in a fresh working directory. Recheck installed help after upgrades;
unsupported flags fail the seat rather than weakening its isolation.

| Member | Isolation | Explicit model |
| --- | --- | --- |
| Claude | `--safe-mode --tools "" --strict-mcp-config --mcp-config '{"mcpServers":{}}' --setting-sources "" --no-session-persistence`; slash commands and Chrome disabled | `--model MODEL`, optional `--effort LEVEL` |
| Codex | `--ignore-user-config --ignore-rules --strict-config --ephemeral -s read-only`; shell, exec, apps, plugins, hooks, delegation, browser, images, memory and skill discovery disabled; web search disabled, project document budget zero | `-m MODEL`, optional `model_reasoning_effort` |
| OpenCode V2 | `run --standalone --agent council`; isolated config root, no inherited project config/MCP/user plugins, tool/context discovery plugins disabled, deny-all agent | `--model provider/model#variant` |

Exact flags and environment live in `../scripts/member.mjs`. Authentication
remains available without copying credentials into run output. Global-only
custom OpenCode providers are unavailable; use an authenticated built-in
provider or implement an explicitly reviewed adapter.

OpenCode configuration uses native V2 `agents`, `permissions`, `mcp.servers`,
`plugins`, `update` and `snapshots`. Root `model` excludes the variant; the
agent and CLI retain it. Configuration/agent/provider/policy plugins remain
enabled. User plugins, tools, instruction/skill discovery, warming and well-known
discovery are disabled. Admin-managed policy may still apply.

The adapter sets documented `OPENCODE_DISABLE_PROJECT_CONFIG=1` plus the
compatibility `OPENCODE_CONFIG_PROJECT_DISABLE=true`. A model-free standalone
server diagnostic on OpenCode 2.0.21 (2026-10-07) passed independently with each
spelling and with both: ancestor config sentinel excluded, isolated council
agent present with deny-all permissions, no inherited config/MCP/user plugins.
The positive control, with both variables absent, discovered the ancestor
sentinel, confirming that the isolation checks exercised config discovery.
This tests effective configuration, not model requests or every environment.
Recheck after upgrades. The normal background service is not isolation evidence.

`meta/CLI.json` distinguishes requested models from IDs reported by the CLI.
No reported ID means unverified. Alias availability depends on the account;
three harness names may resolve to the same provider/model.

The runner kills each POSIX process group with SIGKILL on timeout, overflow or
INT/TERM/HUP cancellation, and kills remaining group members when the leader
exits. Raw stdout/stderr are bounded while read (8 MiB combined, stderr 64 KiB);
opinions over 64 KiB fail. This is not containment for processes deliberately
escaping their groups, nor protection against runner SIGKILL or machine crashes.

`manifest.json` records this dispatch's seat results and response hashes.
Review validates hashes and reads only listed responses, reserves a single
attempt and records `review-manifest.json`. Reruns require a new dispatch dir.
Legacy directory reuse, repository-aware calls, implicit model defaults and
brand-based seat elimination are intentionally removed. `agy` and `gemini`
remain discoverable/mockable but real calls fail closed.

References: [Claude CLI](https://code.claude.com/docs/en/cli-reference),
[Codex CLI](https://developers.openai.com/codex/cli/reference),
[OpenCode V2 config](https://opencode.ai/v2/docs/config),
[instructions](https://opencode.ai/v2/docs/instructions),
[plugins](https://opencode.ai/v2/docs/plugins).
