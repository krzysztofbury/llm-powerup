# Council CLI matrix

CLI help rechecked on 2026-10-07. Recheck installed help after upgrades;
unsupported flags fail the seat rather than weakening its isolation.
Real dispatch supports Claude Code, Codex and OpenCode V2. Node.js 20+ and
POSIX process groups are required. Each CLI receives a self-contained prompt
on stdin in a disposable empty working directory.

| Member | Isolation | Explicit model |
| --- | --- | --- |
| Claude | `--safe-mode --tools "" --strict-mcp-config --mcp-config '{"mcpServers":{}}' --setting-sources "" --no-session-persistence`; slash commands and Chrome disabled | `--model MODEL`, optional `--effort LEVEL` |
| Codex | `--ignore-user-config --ignore-rules --strict-config --ephemeral -s read-only`; shell, exec, apps, plugins, hooks, delegation, browser, images, memory and skill discovery disabled; web search disabled, project document budget zero | `-m MODEL`, optional `model_reasoning_effort` |
| OpenCode V2 | `run --standalone --agent council`; isolated `OPENCODE_CONFIG_DIR`, project configuration disabled, no inherited MCP or user plugins, tool/context discovery plugins disabled, deny-all agent permissions | `--model provider/model#variant` |

Exact flags and environment live in `../scripts/member.mjs`.

## Credentials and providers

Adapters retain the user's normal provider credentials. They do not copy
credentials into run output, change global configuration or inherit a project.
Custom OpenCode providers defined only in global configuration are
intentionally unavailable; use an authenticated built-in provider or add an
explicitly reviewed adapter rather than silently inheriting global config.

This is harness-level isolation, not an OS sandbox or a guarantee about
provider retention. Never submit unapproved private information. Admin-managed
policy may still apply. Failures are recorded instead of falling back to
permissive flags.

## OpenCode configuration

OpenCode configuration uses native V2 `agents`, `permissions`, `mcp.servers`,
`plugins`, `update` and `snapshots`. Root `model` excludes the variant; the
agent and CLI retain it. Built-in configuration, agent, provider and policy
plugins remain enabled. User plugins, tools, instruction/skill discovery,
warming and well-known discovery are disabled.

The adapter sets documented `OPENCODE_DISABLE_PROJECT_CONFIG=1` plus the
compatibility `OPENCODE_CONFIG_PROJECT_DISABLE=true`. In the source repository,
`node scripts/check-council-opencode.mjs MODE` (run from the repository root)
starts a private, password-protected local OpenCode server without calling a
model, places a harmless configuration sentinel in an ancestor directory and
inspects the effective agents, configuration sources, MCP servers and plugins.
`MODE` is `documented`, `compatibility` or `both` (the default) to test each
variable spelling, or `control` with both variables absent.

On OpenCode 2.0.21 (2026-10-07), `documented`, `compatibility` and `both` each
passed: the ancestor sentinel was excluded, the council agent loaded with
deny-all permissions, and no inherited configuration, MCP or user plugins were
present. The `control` mode discovered the ancestor sentinel, confirming that
the diagnostic exercises configuration discovery. The diagnostic waits for
asynchronous registration before inspecting. This establishes effective
configuration on that version, not universal support, live model behavior or
every environment. Recheck after upgrades. The normal background service is
not evidence about a new `--standalone` run.

## Model metadata

JSON output is converted to the final opinion. `meta/CLI.json` distinguishes
the requested model from IDs reported by the CLI. No reported ID means
unverified; do not invent a resolved model. Alias availability depends on the
account and provider; three harness names may resolve to the same model.

## Process lifecycle

The runner kills each POSIX process group with SIGKILL on timeout, overflow or
INT/TERM/HUP cancellation, and kills remaining group members when the leader
exits. Raw stdout/stderr are bounded while read (8 MiB combined, stderr 64 KiB);
opinions over 64 KiB fail rather than entering synthesis truncated. This is not
containment for processes deliberately escaping their groups, nor protection
against runner SIGKILL or machine crashes. These are not token-cost bounds.

## Manifests

`manifest.json` records the dispatch ID, seats, statuses and anonymous response
hashes. Review validates prompt and response hashes, reads only listed
responses, reserves a single attempt and records `review-manifest.json`. Reruns
require a new dispatch directory. Pre-manifest runs and sourced Bash internals
are not supported by the Node runner; common shell flags, output paths and
`bench.tsv` remain. Legacy directory reuse, repository-aware calls, implicit
model defaults and brand-based seat elimination are intentionally removed.
`agy` and `gemini` remain discoverable and mockable but real calls fail closed.
Consent remains the chair's responsibility; neither hashes nor a run manifest
verify approval.

References: [Claude CLI](https://code.claude.com/docs/en/cli-reference),
[Codex CLI](https://developers.openai.com/codex/cli/reference),
[OpenCode V2 config](https://opencode.ai/v2/docs/config),
[agents](https://opencode.ai/v2/docs/agents),
[instructions](https://opencode.ai/v2/docs/instructions),
[plugins](https://opencode.ai/v2/docs/plugins).
