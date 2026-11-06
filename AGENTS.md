# Working In This Repository

This repository is public. Read [SPEC.md](SPEC.md) before changing anything.

- Everything here is English and free of personal data: no names, private
  hosts, local paths, credentials, or owner-specific examples. User-specific
  behavior belongs in documented configuration, not in a skill.
- `rules/AGENTS.md` is not about this repository. It holds the global base
  rules that `scripts/install.sh` installs for every harness.
- Skills must stay portable across Claude Code, Codex, and OpenCode. Hooks and
  `integrations/` may be harness-specific and must say so.
- Run the validation commands from SPEC.md before proposing a change.
- Every merge to `main` is released. Follow [RELEASE.md](RELEASE.md): set the
  `release:major` / `release:minor` label (none means patch) and add the
  version's `CHANGELOG.md` section. Never create tags or releases by hand.
