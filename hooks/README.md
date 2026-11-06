# Hooks

`claude/` holds Claude Code hook scripts and `codex/` the Codex patch lint
hook. They are optional, harness-specific, and not portable Agent Skills.

`scripts/install.sh --claude` links every `claude/*.sh` into
`~/.claude/hooks/` and merges `claude/hooks.json` into
`~/.claude/settings.json`; `--codex` does the same for Codex (see
[docs/INSTALL.md](../docs/INSTALL.md)). The PreToolUse hooks require `jq` and
source `command-scan.sh` from the directory of the resolved script, so a
symlinked hook finds it automatically; a copied hook needs the helper copied
next to it. A missing helper makes every Bash command ask for confirmation.

- `claude/block-dangerous.sh` requests confirmation for commands with destructive
  patterns. It is a guardrail, not a sandbox or command parser.
- `claude/confirm-external-impact.sh` requests confirmation before publishing,
  deploying, or mutating remote infrastructure. It checks a fixed allowlist of
  common publish/deploy commands (not exhaustive).
- `claude/guard-readonly-postgres.sh` requests confirmation for uninspectable or
  state-changing `psql` input. It does not replace a least-privilege database
  role.
- `claude/guard-dashes.sh` refuses Edit, MultiEdit and Write calls that add em
  or en dashes (U+2014, U+2013), for authors who use plain hyphens only. Only
  dashes the call adds count, so editing text that already contains them still
  works. No harness has a setting for this, so it is a hook.
- `claude/auto-lint.sh` reports lint/format findings only. It never rewrites a
  user file. `codex/auto-lint.mjs` does the same for Codex `apply_patch`.

Agent attribution in commits and pull requests is a setting, not a hook:
Claude Code's `attribution.commit`, `attribution.pr` and
`attribution.sessionUrl`, and Codex's `commit_attribution`.

- `claude/command-scan.sh` is the shared helper, not a hook. It splits a command
  into simple commands and words, so rules match programs where they run
  (`docker rm`, `rg psql`, and `ls ~/.netlify` no longer trigger `rm`, `psql`, or
  Netlify rules). Words it cannot resolve, such as `$VAR`, `$(...)`, escapes, and
  brace expansion, cannot use exemptions for recognized commands. Dynamic
  executable names, aliases, scripts and unrecognized commands can escape
  classification. These detectors are not an enforcement boundary.

## Low-friction development

The guards cover known command patterns with the following quiet paths:

- `rm -r`, `rm -f`, globbed `rm`, and `find -delete` pass when every target is
  inside a disposable root: the current Claude Code session's temporary
  directory (`<tmp>/claude-<uid>/<project>/<session_id>/`, matched by the hook
  payload's `session_id`) or a directory listed in `CLAUDE_HOOK_DISPOSABLE_ROOTS`
  (colon-separated absolute paths; `/`, `/tmp`, and `$HOME` themselves are
  refused). `rm` also passes for build and cache output inside the current Git
  work tree (`node_modules`, `dist`, `build`, `target`, `__pycache__`, `*.pyc`,
  tool caches) when Git reports the path as ignored, which it does not for a
  directory that still holds tracked files. `find -delete` outside owned scratch
  asks even for artifact-like names: a predicate does not prove ownership.
  `sudo`, `xargs`, `find -exec rm`,
  `docker exec`, `ssh`, `..`, and unresolved paths always ask. An operand
  `"$NAME"`, `"${NAME:?}"` or `"$NAME/literal"` resolves when NAME is set once,
  at the top level, before the `rm`, from `$(mktemp ...)` or a disposable
  literal path; a suffix after a mktemp variable needs `&&` or `${NAME:?}`.
  Unquoted expansions resolve only for literal paths in commands that leave
  `IFS` alone.
- A `cd` that opens the command, at the top level, to a literal existing
  directory (absolute, `./`, `../` or `~/`) sets the working directory for the
  rest of it. Any other `cd`, `pushd` or `popd` leaves it unresolved. A command
  that uses `eval`, `source`, `trap`, `exec`, a function definition or a
  dynamic program name leaves the directory unresolved, including the one it
  started in; `declare`, `export`, `read` or `printf -v` leave variables
  unresolved.
- `git push` of a non-protected branch passes. Force pushes (including
  `--force-with-lease` and `+refspec`), deletions, tags, mirrors, pushes to
  `main`, `master`, `trunk`, `develop`, `production`, `prod`, `release*`, or the
  remote's default branch, custom push mappings, `-c`/`--config-env` overrides,
  and pushes whose directory is unresolved ask.
- In auto mode (`permission_mode: "auto"`), `CLAUDE_HOOK_AUTO_DEFER` names
  confirmations to leave to the auto mode classifier: `pr-create`, `pr-merge`,
  and `push-protected` (a plain push whose only concern is a protected or
  default branch). It is unset by default, and other modes always ask.
- `docker rm` of a local container passes; removing volumes, pruning, or a
  remote daemon (`-H`, `--context`, `DOCKER_HOST`) asks.
- `sqlite3` on an in-memory database, a session file, or a file in the work
  tree passes.
- `psql` may change a development database listed in
  `${CLAUDE_HOOK_POSTGRES_DEV_TARGETS:-~/.config/claude-hooks/postgres-dev-targets}`,
  one `host[:port]/dbname` per line (port defaults to 5432). Host and database
  must both be explicit in a single unambiguous connection form: `-h`/`-d`,
  a plain host/port/database URI, simple `host port dbname` conninfo, or
  `PGHOST=`/`PGDATABASE=` prefixes. URI queries, hostaddr, services, repeated or
  mixed connection forms, wrappers and inherited routing overrides cannot use
  the exemption. Inline credentials are checked before any exemption. Shell
  profile defaults do not establish a dev target. The list is opt-in and empty
  by default: a port forward
  to a production database also listens on `localhost`. `psql --version`,
  `psql -l`, and describe meta-commands such as `\dt` pass without it.
- `aws --version`, `aws s3 ls`, and `get-`/`describe-`/`list-`/`head-` calls
  pass; each `aws` or `gcloud` invocation in a compound command is inspected on
  its own.

Set the environment variables in the shell that starts Claude Code or in the
`env` block of `settings.json`.

The scripts do not inspect psql startup files, called SQL functions or later
connections made by a script. Use database roles to enforce access. Missing
hook registration, hook timeouts or runner errors may also bypass feedback.
The `ask` response is Claude-specific; Codex does not support it. Do not copy
these registrations into another harness as an equivalent policy.

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
