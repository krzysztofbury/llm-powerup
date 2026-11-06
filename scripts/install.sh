#!/usr/bin/env bash
# Installs skills, hooks and generated rules for Claude Code, Codex, OpenCode
# and Gemini CLI. The work happens in install.mjs; see docs/INSTALL.md.
set -euo pipefail

command -v node >/dev/null 2>&1 || { printf 'The installer requires Node.js 20 or newer.\n' >&2; exit 1; }
exec node "$(dirname "${BASH_SOURCE[0]}")/install.mjs" "$@"
