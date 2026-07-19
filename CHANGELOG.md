# Changelog

All notable changes to this project are documented in this file.

### Added

- `council` skill: convene installed agent CLIs (Claude, Codex, Gemini,
  OpenCode) as a multi-model council over headless, read-only sessions —
  parallel dispatch, anonymized peer ranking, and chairman synthesis.
  Adapted from [karpathy/llm-council](https://github.com/karpathy/llm-council).
- Public project specification, contribution guide, code of conduct, and CI.
- Claude hooks for auto-lint, dangerous-command confirmation,
  external-impact confirmation, and read-only PostgreSQL input.
- Focused, privacy-redacted PostgreSQL diagnostic references.

### Changed

- Claude auto-lint runs ruff, sqlfluff, and ShellCheck and reports findings on
  stderr with exit 2; it is non-destructive and never rewrites files.

### Fixed

- `guard-readonly-postgres.sh` fails closed (asks) on multiple `-c`/`--command`
  flags instead of inspecting only the first.
- `block-dangerous.sh` scopes its SQL-keyword gate to commands that also
  reference a SQL-executing binary (`psql`/`mysql`/`mariadb`/`sqlite3`),
  fixing false positives on shell `truncate` and `git stash drop`.
- `block-dangerous.sh` re-scopes `rm` confirmation to recursive/forced,
  `xargs`-driven, and `find -delete` deletions instead of every `rm`, and
  restores the `find -delete` gate.
- `block-dangerous.sh` git rules no longer treat `--force-with-lease` as
  `--force`, and anchor the checkout/restore dot-pathspec check to a bare `.`.
- `confirm-external-impact.sh` allowlist covers `gh pr create`, `aws`,
  `gcloud`, `flyctl`, `vercel`, `netlify`, and `make deploy`-style targets,
  and recognizes `git push` through intervening `-C`/`-c` options.
- `auto-lint.sh` reports findings on stderr and exits 2 instead of discarding
  them.
