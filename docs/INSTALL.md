# Installing

`scripts/install.sh` links skills, hooks, and the status line script into the
directories each harness reads, and generates the global rules file for each
harness. It never copies a skill: every installed skill is a symlink to its
source, so the source stays the only editable copy.

```bash
scripts/install.sh                 # every target
scripts/install.sh --claude        # Claude Code only
scripts/install.sh --agents        # Codex, OpenCode, and Gemini CLI shared skills and rules
scripts/install.sh --codex         # adds the Codex lint hook (requires codex on PATH)
scripts/install.sh --dry-run       # show what would change
```

Requires Node.js 20 or newer and `git` for git sources.

## What goes where

| Target | Skills | Hooks | Rules |
| --- | --- | --- | --- |
| `--claude` | `~/.claude/skills/` | `~/.claude/hooks/*.sh`, merged into `~/.claude/settings.json`; `~/.claude/statusline-command.sh` | `~/.claude/CLAUDE.md` |
| `--agents` | `~/.agents/skills/` | none | `~/.codex/AGENTS.md`, `~/.config/opencode/AGENTS.md` |
| `--codex` | as `--agents` | `$CODEX_HOME/hooks/auto-lint.mjs`, merged into `$CODEX_HOME/hooks.json` | as `--agents` |

Every target also links `~/.local/bin/agent-scratch`.

The hook merge only adds missing entries. It keeps existing hooks, timeouts and
unrelated settings, writes a timestamped backup before changing the file, and
refuses a settings file that is a symlink. The status line script is linked
but not enabled: point `statusLine.command` in your Claude Code settings at it.

## Skill sources

Without `--sources`, the installer links this repository's `skills/`. A
sources file is a JSON list that can combine this repository, your own
private skills, and skills from other public repositories without forking or
copying them:

```json
[
  { "source": "self" },
  { "path": "~/private-setup/skills" },
  { "path": "./skills", "exclude": ["draft-skill"] },
  {
    "git": "someone/their-skills",
    "commit": "0123456789abcdef0123456789abcdef01234567",
    "subdir": "skills",
    "skills": ["useful-skill"],
    "rename": { "useful-skill": "their-useful-skill" }
  }
]
```

- `{ "source": "self" }` is this repository's `skills/`.
- `path` is a directory of skill directories. `~` expands to your home; a
  relative path resolves against the sources file.
- `git` is `owner/repo` on GitHub or any git URL. `commit` must be a full
  40-character SHA: an upstream change reaches you only when you move the pin,
  so review the diff before you do. The checkout is cached under
  `${XDG_CACHE_HOME:-~/.cache}/agent-skills/` and linked from there, so the
  upstream license and attribution stay with the files.
- `skills` limits a source to the listed skills, `exclude` drops some, and
  `rename` installs a skill under another name.

Each installed name comes from exactly one source. If two sources provide the
same name, the installer stops before changing anything; exclude or rename
one of them.

## Rules

The generated rules file is `rules/AGENTS.md` followed by the optional
`--rules-overlay FILE`, behind a header that marks it as generated. Edit the
sources and rerun the installer. Codex and OpenCode cannot include one file
from another, so the installer writes a full copy for each harness instead of a
link.

## Conflicts and cleanup

The installer replaces only what it manages: links into this repository, into
a configured source, into the git cache, or into a `--prune-root` directory,
and rules files that carry its header. Anything else in the way is reported as
`Conflict:` and left alone; the run then exits with status 1.

Links into a managed source that no longer provides a skill are pruned, so a
removed or renamed skill disappears on the next run. Links that point
elsewhere, such as skills another tool installs, are never touched. After you
move or rename a repository that used to be a source, run the installer once
with `--prune-root OLD_PATH` so the links into the old location are replaced
or removed.
