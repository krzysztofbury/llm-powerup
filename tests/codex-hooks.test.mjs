import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync, symlinkSync, readlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { patchPaths } from '../hooks/codex/auto-lint.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function workspace(t) {
  const directory = mkdtempSync(join(tmpdir(), 'skills-codex-hooks-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('hook installation preserves session hooks, creates a backup, and is idempotent', (t) => {
  const directory = workspace(t);
  const target = join(directory, 'hooks.json');
  const original = { description: 'existing metadata', hooks: {
    SessionStart: [{ hooks: [{ type: 'command', command: 'existing-monitor' }] }],
  } };
  writeFileSync(target, JSON.stringify(original));
  const run = () => spawnSync(process.execPath, [join(repository, 'hooks/codex/install-hooks.mjs'), join(repository, 'hooks/codex/hooks.json'), target], { encoding: 'utf8' });
  assert.equal(run().status, 0);
  const merged = JSON.parse(readFileSync(target, 'utf8'));
  assert.deepEqual(merged.hooks.SessionStart, original.hooks.SessionStart);
  assert.equal(merged.description, original.description);
  assert.equal(merged.hooks.PostToolUse.length, 1);
  const backups = readdirSync(directory).filter((name) => name.includes('.backup-'));
  assert.equal(backups.length, 1);
  assert.deepEqual(JSON.parse(readFileSync(join(directory, backups[0]), 'utf8')), original);
  assert.equal(run().status, 0);
  assert.equal(readdirSync(directory).filter((name) => name.includes('.backup-')).length, 1);
  merged.hooks.PostToolUse[0].hooks[0].timeout = 1;
  const conflicting = JSON.stringify(merged);
  writeFileSync(target, conflicting);
  assert.notEqual(run().status, 0);
  assert.equal(readFileSync(target, 'utf8'), conflicting);
});

test('hook installation refuses both existing and dangling symlinks', (t) => {
  const directory = workspace(t);
  const target = join(directory, 'hooks.json');
  const owner = join(directory, 'owner.json');
  for (const existing of [false, true]) {
    if (existing) writeFileSync(owner, '{"hooks":{}}');
    symlinkSync(owner, target);
    const result = spawnSync(process.execPath, [join(repository, 'hooks/codex/install-hooks.mjs'), join(repository, 'hooks/codex/hooks.json'), target], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.equal(readlinkSync(target), owner);
    if (existing) assert.equal(readFileSync(owner, 'utf8'), '{"hooks":{}}');
    rmSync(target);
  }
});

test('patch lint selects moved destinations and excludes deleted files', () => {
  assert.deepEqual(patchPaths('*** Begin Patch\n*** Add File: new.sh\n+echo ok\n*** Update File: old.py\n*** Move to: renamed.py\n@@\n*** Delete File: gone.sql\n*** End Patch'), ['new.sh', 'renamed.py']);
});

test('patch lint returns Codex context from a real linter without rewriting the file', (t) => {
  if (spawnSync('shellcheck', ['--version']).status !== 0) return t.skip('shellcheck unavailable');
  const directory = workspace(t);
  const path = join(directory, 'example.sh');
  const original = '#!/usr/bin/env bash\nprintf "%s\\n" $value\n';
  writeFileSync(path, original);
  const result = spawnSync(process.execPath, [join(repository, 'hooks/codex/auto-lint.mjs')], {
    input: JSON.stringify({ cwd: directory, tool_input: { command: '*** Begin Patch\n*** Add File: example.sh\n+printf bad\n*** End Patch' } }),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(output.hookSpecificOutput.additionalContext, /SC2086/);
  assert.equal(readFileSync(path, 'utf8'), original);
});
