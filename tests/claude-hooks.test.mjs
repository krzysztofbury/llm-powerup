import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync, symlinkSync, lstatSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { mergeHooks } from '../hooks/claude/install-hooks.mjs';
const installer = fileURLToPath(new URL('../hooks/claude/install-hooks.mjs', import.meta.url));
const template = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [
  { type: 'command', command: 'bash $HOME/.claude/hooks/block-dangerous.sh' },
  { type: 'command', command: 'bash $HOME/.claude/hooks/confirm-external-impact.sh' },
  { type: 'command', command: 'bash $HOME/.claude/hooks/guard-readonly-postgres.sh' },
] }] } };
test('Claude merges missing confirmations while preserving model, effort, other hooks and metadata', () => {
  const current = { model: 'user-model', effortLevel: 'xhigh', privateSetting: true,
    hooks: { SessionStart: [{ hooks: [{ command: 'unrelated' }] }],
      PreToolUse: [{ matcher: 'Bash', hooks: [
        { type: 'command', command: 'bash $HOME/.claude/hooks/block-dangerous.sh', timeout: 42 },
      ] }] } };
  const merged = mergeHooks(current, template);
  assert.equal(merged.model, current.model);
  assert.equal(merged.effortLevel, current.effortLevel);
  assert.deepEqual(merged.hooks.SessionStart, current.hooks.SessionStart);
  assert.equal(merged.hooks.PreToolUse[0].hooks.length, 3);
  assert.equal(merged.hooks.PreToolUse[0].hooks[0].timeout, 42);
  assert.deepEqual(mergeHooks(merged, template), merged);
  assert.equal(current.hooks.PreToolUse[0].hooks.length, 1);
});
test('Claude rejects malformed settings instead of replacing them', () => {
  for (const value of [null, [], { hooks: [] }, { hooks: { PreToolUse: {} } }]) {
    assert.throws(() => mergeHooks(value, template));
  }
});

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'claude-hooks-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = join(directory, 'template.json');
  const target = join(directory, 'settings.json');
  writeFileSync(source, JSON.stringify(template));
  return { directory, target, run: () => spawnSync(process.execPath, [installer, source, target], { encoding: 'utf8' }) };
}

test('Claude installer backs up exact settings, restricts permissions and is idempotent', t => {
  const { directory, target, run } = fixture(t);
  const original = JSON.stringify({ model: 'user-model', effortLevel: 'high', enabledPlugins: { fixture: true } }) + '\n';
  writeFileSync(target, original, { mode: 0o644 });
  assert.equal(run().status, 0);
  const backups = readdirSync(directory).filter(name => name.startsWith('settings.json.backup.'));
  assert.equal(backups.length, 1);
  assert.equal(readFileSync(join(directory, backups[0]), 'utf8'), original);
  assert.equal(statSync(join(directory, backups[0])).mode & 0o777, 0o600);
  assert.equal(statSync(target).mode & 0o777, 0o600);
  const installed = readFileSync(target, 'utf8');
  const settings = JSON.parse(installed);
  assert.equal(settings.model, 'user-model');
  assert.equal(settings.effortLevel, 'high');
  assert.deepEqual(settings.enabledPlugins, { fixture: true });
  assert.equal(run().status, 0);
  assert.equal(readFileSync(target, 'utf8'), installed);
  assert.deepEqual(readdirSync(directory).filter(name => name.startsWith('settings.json.backup.')), backups);
});

test('Claude installer leaves malformed settings untouched without creating a backup', t => {
  const { directory, target, run } = fixture(t);
  const original = '{invalid-json';
  writeFileSync(target, original);
  assert.notEqual(run().status, 0);
  assert.equal(readFileSync(target, 'utf8'), original);
  assert.deepEqual(readdirSync(directory).sort(), ['settings.json', 'template.json']);
});

test('Claude installer refuses existing and dangling symlinks without changing their owners', t => {
  const { directory, target, run } = fixture(t);
  const owner = join(directory, 'owner.json');
  writeFileSync(owner, '{}\n');
  symlinkSync(owner, target);
  assert.notEqual(run().status, 0);
  assert.ok(lstatSync(target).isSymbolicLink());
  assert.equal(readFileSync(owner, 'utf8'), '{}\n');
  rmSync(owner);
  assert.notEqual(run().status, 0);
  assert.ok(lstatSync(target).isSymbolicLink());
  assert.deepEqual(readdirSync(directory).sort(), ['settings.json', 'template.json']);
});
