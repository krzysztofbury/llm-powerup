import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, chmodSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { invocation, extract } from './member.mjs';

const scripts = dirname(fileURLToPath(import.meta.url));
function fixture(t, mode = 'ok') {
  const root = mkdtempSync(join(tmpdir(), 'council-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin'); mkdirSync(bin);
  const temp = join(root, 'temp'); mkdirSync(temp);
  for (const member of ['claude', 'codex', 'opencode']) {
    copyFileSync(join(scripts, 'fixture-cli.mjs'), join(bin, member)); chmodSync(join(bin, member), 0o700);
  }
  const prompt = join(root, 'input.md'); writeFileSync(prompt, 'Self-contained public fixture');
  const run = join(root, 'run');
  const env = { ...process.env, PATH: bin + ':' + process.env.PATH, TMPDIR: temp,
    FIXTURE_TRACE: join(root, 'trace'), FIXTURE_MODE: mode };
  const args = ['dispatch', prompt, '--run-dir', run, '--members', 'claude codex opencode',
    '--model', 'claude=fixture-alias', '--model', 'codex=fixture-codex', '--model', 'opencode=fixture/model#medium'];
  const call = (values = args, overrides = {}) => spawnSync('/bin/bash', [join(scripts, 'council.sh'), ...values],
    { env: { ...env, ...overrides }, encoding: 'utf8', timeout: 10000 });
  return { root, temp, run, env, args, call, load: path => JSON.parse(readFileSync(join(run, path), 'utf8')) };
}
function stopped(pid) {
  try {
    process.kill(pid, 0);
    // Linux may retain a killed orphan as a zombie until init reaps it.
    if (process.platform === 'linux') return readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].startsWith('Z');
    return false;
  } catch { return true; }
}
async function waitFor(check) {
  const deadline = Date.now() + 5000;
  while (!check()) { if (Date.now() > deadline) throw new Error('Fixture condition timed out'); await sleep(20); }
}
function assertTreeStopped(f) {
  for (const name of readdirSync(f.root).filter(name => name.startsWith('trace'))) {
    const value = readFileSync(join(f.root, name), 'utf8');
    const pid = name.includes('.helper.') ? Number(value) : JSON.parse(value).pid;
    assert.ok(stopped(pid), `Fixture process ${pid} survived`);
  }
  assert.deepEqual(readdirSync(f.temp), [], 'Member scratch remained');
}
test('adapter policies isolate context and require explicit models', () => {
  const claude = invocation('claude', 'fixture', '', '/isolated', { CLAUDECODE: '1', AUTH: 'preserved' });
  assert.equal(claude.env.CLAUDECODE, undefined); assert.equal(claude.env.AUTH, 'preserved');
  assert.equal(claude.args[claude.args.indexOf('--tools') + 1], '');
  assert.ok(claude.args.includes('--strict-mcp-config'));
  const codex = invocation('codex', 'fixture', 'medium', '/isolated', {});
  for (const flag of ['--ignore-user-config', '--ignore-rules', '--strict-config', 'features.hooks=false']) assert.ok(codex.args.includes(flag));
  const oc = invocation('opencode', 'fixture/model#medium', '', '/isolated', { OPENCODE_CONFIG: 'unsafe' });
  assert.equal(oc.env.OPENCODE_CONFIG, undefined);
  assert.equal(oc.env.OPENCODE_DISABLE_PROJECT_CONFIG, '1');
  const config = JSON.parse(oc.env.OPENCODE_CONFIG_CONTENT);
  assert.deepEqual(config.mcp.servers, {});
  assert.deepEqual(config.agents.council.permissions, [{ action: '*', resource: '*', effect: 'deny' }]);
  assert.throws(() => invocation('gemini', 'fixture', '', '/isolated'));
  assert.throws(() => invocation('claude', '', '', '/isolated'));
  assert.throws(() => extract('codex', '{"type":"turn.failed"}'));
});
test('real dispatch records requested versus reported models in isolated cwd', t => {
  const f = fixture(t); const result = f.call(); assert.equal(result.status, 0, result.stderr);
  const manifest = f.load('manifest.json'); assert.equal(manifest.status, 'complete');
  assert.equal(manifest.responses.length, 3);
  assert.equal(f.load('meta/claude.json').requestedModel, 'fixture-alias');
  assert.deepEqual(f.load('meta/claude.json').resolvedModels, ['actual-fixture']);
  assert.equal(f.load('meta/codex.json').modelVerified, false);
  for (const member of ['claude', 'codex', 'opencode']) {
    const trace = JSON.parse(readFileSync(join(f.root, 'trace.' + member), 'utf8'));
    assert.notEqual(trace.cwd, process.cwd()); assert.ok(trace.cwd.startsWith(f.temp));
    assert.match(trace.prompt, /Self-contained public fixture/);
    assert.doesNotMatch(trace.prompt, /operator already approved/);
    assert.equal(existsSync(trace.cwd), false);
  }
});
test('failed partial output never contributes to quorum', t => {
  const f = fixture(t); assert.equal(f.call(f.args, { FIXTURE_FAIL: 'codex' }).status, 0);
  assert.equal(f.load('manifest.json').responses.length, 2);
  assert.equal(existsSync(join(f.run, 'responses/codex.md')), false);
});
test('run reuse is refused without altering old evidence', t => {
  const f = fixture(t); assert.equal(f.call().status, 0);
  const before = readFileSync(join(f.run, 'manifest.json'), 'utf8');
  assert.equal(f.call().status, 1); assert.equal(readFileSync(join(f.run, 'manifest.json'), 'utf8'), before);
});
test('review consumes only manifest responses and rejects repeat review', t => {
  const f = fixture(t); assert.equal(f.call().status, 0);
  writeFileSync(join(f.run, 'anon/response-Z.md'), 'STALE OPINION');
  assert.equal(f.call(['review', f.run]).status, 0);
  assert.doesNotMatch(readFileSync(join(f.run, 'review-prompt.md'), 'utf8'), /STALE OPINION/);
  assert.equal(f.load('review-manifest.json').dispatchRunId, f.load('manifest.json').runId);
  const before = readFileSync(join(f.run, 'review-manifest.json'), 'utf8');
  assert.equal(f.call(['review', f.run]).status, 1);
  assert.equal(readFileSync(join(f.run, 'review-manifest.json'), 'utf8'), before);
});
test('review rejects changed evidence before dispatch', t => {
  const f = fixture(t); assert.equal(f.call().status, 0);
  writeFileSync(join(f.run, f.load('manifest.json').responses[0].file), 'MODIFIED');
  assert.equal(f.call(['review', f.run]).status, 1);
  assert.equal(existsSync(join(f.run, 'reviews')), false);
});
test('a failed review cannot be rerun or reuse old ranking files', t => {
  const f = fixture(t); assert.equal(f.call().status, 0);
  assert.equal(f.call(['review', f.run], { FIXTURE_MODE: 'opinion' }).status, 2);
  assert.equal(f.load('review-manifest.json').status, 'failed');
  assert.deepEqual(readdirSync(join(f.run, 'reviews')), []);
  assert.equal(f.call(['review', f.run]).status, 1);
  assert.equal(f.load('review-manifest.json').status, 'failed');
});
test('missing models and duplicate members fail before any CLI starts', t => {
  const f = fixture(t);
  assert.equal(f.call(['dispatch', join(f.root, 'input.md'), '--members', 'claude codex']).status, 1);
  assert.equal(f.call(['--mock', 'members', '--members', 'claude claude']).status, 1);
  assert.equal(readdirSync(f.root).some(name => name.startsWith('trace')), false);
});
test('mock discovery keeps OpenCode alongside Codex and dry-run cannot be reviewed', t => {
  const f = fixture(t);
  assert.match(f.call(['--mock', 'members']).stdout, /codex\nopencode/);
  assert.equal(f.call([...f.args, '--dry-run']).status, 0);
  assert.equal(f.call(['review', f.run]).status, 1);
  assert.equal(readdirSync(f.root).some(name => name.startsWith('trace')), false);
});
for (const mode of ['stdout', 'stderr', 'opinion']) test(`${mode} overflow fails closed with bounded disk output`, t => {
  const f = fixture(t, mode); const result = f.call([...f.args, '--timeout', '3']);
  assert.equal(result.status, 2, result.stderr);
  assert.equal(f.load('manifest.json').responses.length, 0);
  for (const member of ['claude', 'codex', 'opencode']) {
    assert.match(f.load(`meta/${member}.json`).error, /limit exceeded/);
    assert.ok(statSync(join(f.run, `meta/${member}.err`)).size <= 65536);
  }
  assertTreeStopped(f);
});
for (const mode of ['hang', 'leader-exits']) test(`${mode}: kills TERM-ignoring process group and cleans scratch`, t => {
  const f = fixture(t, mode); const start = Date.now();
  const result = f.call([...f.args, '--timeout', '1']);
  assert.equal(result.status, 2, result.stderr); assert.ok(Date.now() - start < 5000);
  assertTreeStopped(f);
});
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) test(`${signal} cancels active members before cleanup`, async t => {
  const f = fixture(t, 'hang');
  const child = spawn('/bin/bash', [join(scripts, 'council.sh'), ...f.args], { env: f.env, stdio: 'ignore' });
  const done = new Promise(resolve => child.once('close', (code, exitSignal) => resolve({ code, exitSignal })));
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  await waitFor(() => ['claude', 'codex', 'opencode'].every(member => existsSync(join(f.root, 'trace.helper.' + member))));
  child.kill(signal);
  const outcome = await Promise.race([done, sleep(5000, null, { ref: false }).then(() => { throw new Error('Cancellation timed out'); })]);
  assert.equal(outcome.exitSignal, null); assert.notEqual(outcome.code, 0);
  assert.equal(f.load('manifest.json').status, 'cancelled'); assertTreeStopped(f);
});
