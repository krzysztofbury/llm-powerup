# Agent scratch lifecycle

## Ownership and layout

- `rules/AGENTS.md` holds the cross-harness cleanup policy; the installer
  generates each harness's rules file from it.
- `scripts/agent-scratch.sh` implements one-command cleanup. It is not an
  OpenCode plugin or a Claude-only hook.
- `scripts/install.sh --agents`, `--claude`, and `--codex` symlink the helper
  to `~/.local/bin/agent-scratch`. The default install also includes it.
- `tests/agent-scratch.test.mjs` exercises real command exits and signals.

No daemon, automatic sweeper, session-exit hook, or global `TMPDIR` override
is installed. Agents must invoke the helper; rules alone do not enforce it.

## One shell task

In OpenCode, use its approved scratch root:

```bash
~/.local/bin/agent-scratch --root /tmp/opencode -- bash -euo pipefail -c '
  uv venv "$AGENT_SCRATCH_DIR/venv"
  # Install test dependencies and run the complete disposable check here.
  # Use "$AGENT_SCRATCH_DIR" for copied databases, builds, and archives.
'
```

Before installation, invoke `bash scripts/agent-scratch.sh` from this checkout.
Other harnesses can omit `--root` to use their existing `TMPDIR`, or specify
another approved location. Use a disk-backed root for large builds if the
harness permits it; `/tmp` can be RAM-backed.

The helper preserves the working directory and command arguments. It exports
`AGENT_SCRATCH_DIR`, `TMPDIR`, `TMP`, and `TEMP` only to the command. Tools with
independent output or cache settings still need those paths set explicitly;
for example, set `TF_DATA_DIR="$AGENT_SCRATCH_DIR/terraform"` for Terraform.
Existing shared package caches are not swept or deleted.

The wrapper installs an `EXIT` trap and forwards `HUP`, `INT`, or `TERM` to
the command's process group. It waits before cleanup and preserves the command's
failure status. If processes remain or deletion fails, it reports the retained
path and returns failure rather than silently claiming cleanup.

## Retain reports, not environments

Create a durable report directory outside scratch and pass it to the task.
Keep private evidence out of public repositories.

```bash
report_dir=$(mktemp -d "${HOME}/agent-report.XXXXXXXX")
REPORT_DIR="$report_dir" ~/.local/bin/agent-scratch --root /tmp/opencode -- \
  bash -euo pipefail -c '
    trap '\''cp "$AGENT_SCRATCH_DIR/check.log" "$REPORT_DIR/check.log"'\'' EXIT
    printf "Check started\n" > "$AGENT_SCRATCH_DIR/check.log"
    # Run the check, appending its diagnostics to check.log.
  '
printf 'Retained report: %s\n' "$report_dir/check.log"
```

For actual deliverables, use the requested destination instead. Reports have
their own retention decision; the wrapper never deletes them automatically.

## Limits

- Files disappear when the wrapped command exits, not when the chat ends.
  Do not expect them to survive another tool call. Commands must not detach
  background processes or move descendants into separate process groups.
- For multi-call scratch, record the allocated path, owning task, and retention
  reason. Clean it explicitly when done and report any leftovers and their size.
- Git worktrees and source changes belong outside disposable scratch.
  Use Git's worktree lifecycle and check changes before removing a worktree.
- A command ignoring termination can delay cleanup. The wrapper does not
  force-kill it or delete files it may still use.
- `SIGKILL`, machine crashes, and power loss bypass traps. Safe orphan sweeping
  is a separate feature, not included here.
- The helper cannot constrain tools that ignore temporary-directory settings.

## Verification

```bash
TMPDIR=/tmp/opencode node --test tests/agent-scratch.test.mjs
bash -n scripts/agent-scratch.sh scripts/install.sh
```
