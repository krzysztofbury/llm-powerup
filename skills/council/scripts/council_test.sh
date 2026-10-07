#!/usr/bin/env bash
# Fixture CLIs only; no credentials, network or paid model calls.
set -euo pipefail
exec node --test "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/council.test.mjs"
