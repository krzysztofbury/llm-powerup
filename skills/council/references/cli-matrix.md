# Council CLI Matrix

Headless, read-only invocations used by `scripts/council.sh`. Verified against
installed versions on 2026-07-19: claude 2.1.215, codex 0.144.6, gemini 0.45.2,
opencode 1.18.3. Product CLIs change — re-verify with `--help` before editing.

| Member | Invocation | Read-only mechanism | Model override |
| --- | --- | --- | --- |
| claude | `claude -p --allowedTools Read Grep Glob --disallowedTools Bash Edit Write NotebookEdit WebFetch WebSearch Task < prompt.md` | Allow+deny pair: `--allowedTools` grants the read-only set; `--disallowedTools` explicitly denies the state-changing/network tools. The deny list is required because `--allowedTools` is additive and does not override tools a repo's own `.claude/settings.json` might grant — a permissive or malicious project settings file could otherwise hand this headless session Bash/Edit. `--disallowedTools` wins over any settings-granted permission. | `--model <alias>` |
| codex | `codex exec -s read-only --skip-git-repo-check - < prompt.md` | `read-only` sandbox policy; git check skipped so it runs in any directory | `-m <model>` |
| gemini | `gemini --approval-mode plan -o text -p "$(cat prompt.md)"` | `plan` approval mode is read-only | `-m <model>` |
| opencode | `opencode run --agent plan "$(cat prompt.md)"` | Built-in `plan` agent has editing disabled | `-m provider/model` |

## Notes

- Prompt delivery: claude and codex read stdin; gemini and opencode take the
  prompt as a single argv argument. On Linux, `MAX_ARG_STRLEN` caps any single
  argument at ~128 KiB regardless of overall `ARG_MAX`, so review bundles
  approaching the 65536-byte-per-member output cap times several members can
  exceed it. `council.sh` logs a warning (does not block) when the prompt file
  exceeds 100000 bytes and the member is gemini or opencode; the resulting CLI
  failure is still recorded fail-soft in `meta/<member>.failed`.
- Each member runs with the caller's working directory, so on code questions
  members can explore the repository read-only. Convene from the repo root.
- Timeouts and output caps are enforced by `council.sh`
  (`--timeout`, 65536-byte cap), not by the member CLIs.
- All members must already be authenticated (interactive login done once by
  the user). An unauthenticated CLI fails fail-soft and is recorded in
  `meta/<member>.failed`.
- Not yet supported: antigravity (no CLI installed to verify against). Add a
  row and a `dispatch_one` case once verifiable.
