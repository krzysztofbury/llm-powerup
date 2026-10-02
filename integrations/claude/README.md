# Claude Code Integrations

These scripts implement Claude Code hook payloads. They are optional and are
not portable Agent Skills.

Install them by symlinking individual scripts into `~/.claude/hooks/`, then add
the corresponding `PreToolUse` or `PostToolUse` entry in `~/.claude/settings.json`.
The PreToolUse hooks require `jq` and source `hooks/command-scan.sh` from the
directory of the resolved script, so a symlinked hook finds it automatically; a
copied hook needs the helper copied next to it. A missing helper makes every
Bash command ask for confirmation.

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
- `hooks/command-scan.sh` is the shared helper, not a hook. It splits a command
  into simple commands and words, so rules match programs where they run
  (`docker rm`, `rg psql`, and `ls ~/.netlify` no longer trigger `rm`, `psql`, or
  Netlify rules). Words it cannot resolve, such as `$VAR`, `$(...)`, escapes, and
  brace expansion, are treated as unknown and keep the confirmation.

## Low-friction development

The guards stay quiet for routine sandbox and development work and ask for
everything else:

- `rm -r`, `rm -f`, globbed `rm`, and `find -delete` pass when every target is
  inside a disposable root: the current Claude Code session's temporary
  directory (`<tmp>/claude-<uid>/<project>/<session_id>/`, matched by the hook
  payload's `session_id`) or a directory listed in `CLAUDE_HOOK_DISPOSABLE_ROOTS`
  (colon-separated absolute paths; `/`, `/tmp`, and `$HOME` themselves are
  refused). They also pass for build and cache output inside the current Git
  work tree (`node_modules`, `dist`, `build`, `target`, `__pycache__`, `*.pyc`,
  tool caches) when Git reports the path as ignored, which it does not for a
  directory that still holds tracked files. `sudo`, `xargs`, `find -exec rm`,
  `docker exec`, `ssh`, `..`, and unresolved paths always ask.
- `git push` of a non-protected branch passes. Force pushes (including
  `--force-with-lease` and `+refspec`), deletions, tags, mirrors, pushes to
  `main`, `master`, `trunk`, `develop`, `production`, `prod`, `release*`, or the
  remote's default branch, custom push mappings, and pushes after a `cd` ask.
- `docker rm` of a local container passes; removing volumes, pruning, or a
  remote daemon (`-H`, `--context`, `DOCKER_HOST`) asks.
- `sqlite3` on an in-memory database, a session file, or a file in the work
  tree passes.
- `psql` may change a development database listed in
  `${CLAUDE_HOOK_POSTGRES_DEV_TARGETS:-~/.config/claude-hooks/postgres-dev-targets}`,
  one `host[:port]/dbname` per line (port defaults to 5432). Host and database
  must both be explicit in the command (`-h`/`-d`, a URI, a conninfo string, or
  `PGHOST=`/`PGDATABASE=` prefixes); shell profile defaults are invisible to the
  hook and never count. The list is opt-in and empty by default: a port forward
  to a production database also listens on `localhost`. `psql --version`,
  `psql -l`, and describe meta-commands such as `\dt` pass without it.
- `aws --version`, `aws s3 ls`, and `get-`/`describe-`/`list-`/`head-` calls
  pass; each `aws` or `gcloud` invocation in a compound command is inspected on
  its own.

Set the environment variables in the shell that starts Claude Code or in the
`env` block of `settings.json`.

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
