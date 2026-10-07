# Agent Working Rules

Portable, harness-agnostic base rules for coding agents (Claude Code, Codex,
OpenCode, and similar). Personal editions may extend this file; harness
installers symlink it as `CLAUDE.md` / `AGENTS.md` where each tool expects it.

## Verification & Deployment

- For load-sensitive fixes, verify under representative load. A quiet window
  is not evidence; state explicitly when load verification is pending.
- To confirm what is actually on the default branch or deployed, use remote
  evidence (`gh` CLI, `git ls-remote`, the hosting UI), never local SHA-based
  checks.
- Before `gh pr merge`, compare the PR head (`gh pr view --json headRefOid`)
  with the SHA you pushed. A PR can lag behind the branch; merging a stale
  head ships half the work.
- A visible UI change is not "done" without visual verification in a real
  browser. If a visual check is impossible, say so explicitly instead of
  claiming completion from grep or curl output.

## Production Investigation & Logs

- Before production log or cluster work, check the required access path:
  credentials, target context and VPN when used. If access fails, request
  re-authentication before continuing dependent work.
- An empty log or query result obtained through a filter (container name,
  label selector) is suspect: verify the filter matches actually running
  resources before concluding "no logs" or "no errors".

## Editing & Testing

- After a batch of edits, re-check for formatter or lint side effects. An
  autofix pass can strip newly added imports even when tests pass.
- For behavior changes, exercise the affected runtime path or a smoke test.
  Run required project checks; after they pass, repeat or broaden testing only
  for new changes, failures or an unresolved risk.
- Before a repository-wide regex substitution, list every match per pattern,
  including hyphenated names, URLs, and link paths, then review the word diff.

## Scratch Space & Cleanup

- Create disposable artifacts in a unique `mktemp -d` directory under a
  harness-approved location. Never reuse a shared task directory.
- Use a lifecycle helper or cleanup traps, including termination signals;
  stop task processes before deleting their files. Keep child temporary files
  inside the owned directory. Traps cannot cover SIGKILL or machine crashes.
- Give tools that write to the current directory by default (`pip download`,
  `curl -O`, `uv build`) an explicit scratch output path.
- Keep Git worktrees, source changes, and durable deliverables outside
  disposable scratch. Delete only paths allocated by the current task.
- Record ownership for multi-call scratch; clean it on completion or failure.
  Retain only useful deliverables. Report leftover paths, sizes, reasons and
  cleanup failures; never delete another task's files or escalate to hide them.

## Content & Deliverables

- Before writing anything into a repository (PR bodies, commit messages,
  docstrings, docs), check whether the repository is public or private.
  Public repositories get English only and zero private or personal context.
- CVs, decks, and summaries generated from repository data must be grounded
  in the actual named services and real code or database statistics. Never
  infer generic descriptions from raw commit history.
