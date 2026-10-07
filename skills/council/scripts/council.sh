#!/usr/bin/env bash
# Keep the CLI entrypoint; Node owns child lifecycle and bounded streams.
set -euo pipefail
exec node "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/runner.mjs" "$@"
