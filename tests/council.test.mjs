// Repository-level council checks with fixture CLIs; no credentials, network or
// model calls. Lifecycle tests ship with the skill: bash skills/council/scripts/council_test.sh
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, chmodSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { invocation, extract } from '../skills/council/scripts/member.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
test('Claude disables tools and inherited customizations but preserves auth', () => {
  const spec = invocation('claude', 'opus', 'medium', '/tmp/isolated', { AUTH: 'fixture', CLAUDECODE: '1' });
  assert.ok(spec.args.includes('--safe-mode'));
  assert.equal(spec.args[spec.args.indexOf('--tools') + 1], '');
  assert.ok(spec.args.includes('--strict-mcp-config'));
  assert.ok(spec.args.includes('--no-session-persistence'));
  assert.equal(spec.env.AUTH, 'fixture');
  assert.equal(spec.env.CLAUDECODE, undefined);
});
test('Codex does not inherit MCP configuration and disables execution integrations', () => {
  const spec = invocation('codex', 'test-model', 'medium', '/tmp/isolated', {});
  for (const flag of ['--ignore-user-config', '--ignore-rules', '--strict-config', '--ephemeral']) assert.ok(spec.args.includes(flag));
  for (const key of ['shell_tool', 'unified_exec', 'apps', 'plugins', 'hooks', 'multi_agent']) assert.ok(spec.args.includes(`features.${key}=false`));
  assert.ok(spec.args.includes('model_reasoning_effort="medium"'));
});
test('OpenCode v2 isolates configuration and denies all tools', () => {
  const spec = invocation('opencode', 'provider/test-model#medium', '', '/tmp/isolated', { OPENCODE_CONFIG: '/unsafe', OPENCODE_CONFIG_DIR: '/unsafe' });
  assert.equal(spec.env.OPENCODE_CONFIG, undefined);
  assert.equal(spec.env.OPENCODE_CONFIG_DIR, '/tmp/isolated/config');
  assert.equal(spec.env.OPENCODE_CONFIG_PROJECT_DISABLE, 'true');
  assert.equal(spec.env.OPENCODE_DISABLE_PROJECT_CONFIG, '1');
  const config = JSON.parse(spec.env.OPENCODE_CONFIG_CONTENT);
  assert.equal(spec.env.OPENCODE_CLI_CONFIG_CONTENT, undefined);
  assert.deepEqual(config.mcp.servers, {});
  assert.equal(config.agents.council.model, 'provider/test-model#medium');
  assert.equal(config.model, 'provider/test-model');
  assert.ok(config.plugins.includes('-opencode.tool.*'));
  assert.ok(config.plugins.includes('-opencode.config.instruction'));
  assert.deepEqual(config.agents.council.permissions, [{ action: '*', resource: '*', effect: 'deny' }]);
  assert.ok(spec.args.includes('--standalone'));
});
test('missing models, invalid OpenCode effort and non-isolated legacy adapters fail', () => {
  assert.throws(() => invocation('codex', '', '', '/tmp'));
  assert.throws(() => invocation('opencode', 'alias', '', '/tmp'));
  assert.throws(() => invocation('opencode', 'provider/model', 'high', '/tmp'));
  assert.throws(() => invocation('gemini', 'model', '', '/tmp'));
});
test('JSON extraction distinguishes requested and actually reported models', () => {
  assert.deepEqual(extract('claude', '{"type":"result","result":"opinion","modelUsage":{"actual-model":{}}}'), { text: 'opinion', resolvedModels: ['actual-model'] });
  assert.deepEqual(extract('codex', '{"type":"item.completed","item":{"type":"agent_message","text":"opinion"}}'), { text: 'opinion', resolvedModels: [] });
  assert.throws(() => extract('claude', '{"type":"result","is_error":true}'));
  assert.throws(() => extract('codex', '{"type":"turn.failed"}'));
});
test('real runner path passes explicit models, isolates cwd and records honest metadata', t => {
  const directory = mkdtempSync(join(tmpdir(), 'council-runtime-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bin = join(directory, 'bin');
  mkdirSync(bin);
  for (const member of ['claude', 'codex', 'opencode']) {
    const path = join(bin, member);
    copyFileSync(join(root, 'tests/fixtures/council-cli.mjs'), path);
    chmodSync(path, 0o700);
  }
  const prompt = join(directory, 'prompt.md');
  writeFileSync(prompt, 'Public technical fixture. No personal data.');
  const run = join(directory, 'run');
  const result = spawnSync('/bin/bash', [join(root, 'skills/council/scripts/council.sh'),
    'dispatch', prompt, '--run-dir', run, '--members', 'claude codex opencode',
    '--model', 'claude=opus', '--model', 'codex=test-model',
    '--model', 'opencode=provider/test-model#medium', '--effort', 'codex=medium',
  ], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`,
    COUNCIL_TEST_TRACE: join(directory, 'trace') }, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  for (const member of ['claude', 'codex', 'opencode']) {
    assert.match(readFileSync(join(run, 'responses', member + '.md'), 'utf8'), /Independent test opinion/);
    const trace = JSON.parse(readFileSync(join(directory, 'trace.' + member), 'utf8'));
    assert.notEqual(trace.cwd, root);
    assert.match(trace.prompt, /Public technical fixture/);
  }
  const claude = JSON.parse(readFileSync(join(run, 'meta/claude.json'), 'utf8'));
  assert.equal(claude.requestedModel, 'opus');
  assert.deepEqual(claude.resolvedModels, ['resolved-test-claude']);
  assert.equal(claude.modelVerified, true);
  const codex = JSON.parse(readFileSync(join(run, 'meta/codex.json'), 'utf8'));
  assert.equal(codex.requestedModel, 'test-model');
  assert.equal(codex.modelVerified, false);
  const trace = JSON.parse(readFileSync(join(directory, 'trace.codex'), 'utf8'));
  assert.equal(trace.args[trace.args.indexOf('-m') + 1], 'test-model');
});
