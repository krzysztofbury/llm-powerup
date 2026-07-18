# Claude Code Integrations

These scripts implement Claude Code hook payloads. They are optional and are
not portable Agent Skills.

Install them by symlinking individual scripts into `~/.claude/hooks/`, then add
the corresponding `PreToolUse` or `PostToolUse` entry in `~/.claude/settings.json`.
The PreToolUse hooks require `jq`.

- `hooks/block-dangerous.sh` requests confirmation for commands with destructive
  patterns. It is a guardrail, not a sandbox or command parser.
- `hooks/confirm-external-impact.sh` requests confirmation before publishing,
  deploying, or mutating remote infrastructure. It checks a fixed allowlist of
  common publish/deploy commands (not exhaustive).
- `hooks/guard-readonly-postgres.sh` requests confirmation for uninspectable or
  state-changing `psql` input. It does not replace a least-privilege database
  role.
- `hooks/auto-lint.sh` reports lint/format findings only. It never rewrites a
  user file.

Example `~/.claude/settings.json` entries:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Bash",
      "hooks": [
        {"type": "command", "command": "bash ~/.claude/hooks/block-dangerous.sh"},
        {"type": "command", "command": "bash ~/.claude/hooks/confirm-external-impact.sh"},
        {"type": "command", "command": "bash ~/.claude/hooks/guard-readonly-postgres.sh"}
      ]
    }],
    "PostToolUse": [{
      "matcher": "Edit|Write",
      "hooks": [
        {"type": "command", "command": "bash ~/.claude/hooks/auto-lint.sh"}
      ]
    }]
  }
}
```
