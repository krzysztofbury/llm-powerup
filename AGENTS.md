# Agent Working Rules

Portable, harness-agnostic base rules for coding agents (Claude Code, Codex,
OpenCode, and similar). Personal editions may extend this file; harness
installers symlink it as `CLAUDE.md` / `AGENTS.md` where each tool expects it.

## Verification & Deployment

- Never declare a fix "verified" or "successful" based on a quiet or low-load
  window. Verify under representative load, or state explicitly that
  verification is pending.
- To confirm what is actually on the default branch or deployed, use remote
  evidence (`gh` CLI, `git ls-remote`, the hosting UI), never local SHA-based
  checks.
- Before `gh pr merge`, compare the PR head (`gh pr view --json headRefOid`)
  with the SHA you pushed. A PR can lag behind the branch; merging a stale
  head ships half the work.
- A UI or frontend change is not "done" without visual verification in a real
  browser. If a visual check is impossible, say so explicitly instead of
  claiming completion from grep or curl output.

## Production Investigation & Logs

- Before any production log or cluster investigation, preflight the access
  path: credentials valid, context set and reachable, VPN up. If anything is
  invalid, stop and ask the user to re-authenticate instead of failing
  mid-task.
- An empty log or query result obtained through a filter (container name,
  label selector) is suspect: verify the filter matches actually running
  resources before concluding "no logs" or "no errors".

## Editing & Testing

- After a batch of edits, re-check for formatter or lint side effects. An
  autofix pass can strip newly added imports even when tests pass.
- Exercise the actual runtime path or a smoke test, not just the unit suite,
  before shipping.

## Content & Deliverables

- Before writing anything into a repository (PR bodies, commit messages,
  docstrings, docs), check whether the repository is public or private.
  Public repositories get English only and zero private or personal context.
- CVs, decks, and summaries generated from repository data must be grounded
  in the actual named services and real code or database statistics. Never
  infer generic descriptions from raw commit history.
