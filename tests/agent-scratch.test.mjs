import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(repository, 'scripts/agent-scratch.sh');

function workspace(t) {
  const directory = mkdtempSync(join(tmpdir(), 'agent-scratch-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function run(root, command, options = {}) {
  return spawnSync('/bin/bash', [script, '--root', root, '--', ...command], {
    encoding: 'utf8', timeout: 10000, ...options,
  });
}

test('success cleans private scratch and preserves arguments, input, cwd, and neighboring files', (t) => {
  const directory = workspace(t);
  const root = join(directory, 'scratch with spaces');
  mkdirSync(root);
  writeFileSync(join(root, 'keep.txt'), 'another task');
  const result = run(root, [process.execPath, '-e', `
    const fs = require('node:fs');
    const scratch = process.env.AGENT_SCRATCH_DIR;
    fs.writeFileSync(scratch + '/build.db', 'generated');
    fs.symlinkSync(process.cwd() + '/scratch with spaces/keep.txt', scratch + '/external-link');
    console.log(JSON.stringify({ scratch, mode: fs.statSync(scratch).mode & 0o777,
      tmp: process.env.TMP, temp: process.env.TEMP, tmpdir: process.env.TMPDIR,
      cwd: process.cwd(), arg: process.argv[1], input: fs.readFileSync(0, 'utf8') }));
    console.error('diagnostic');
  `, 'argument with spaces'], { cwd: directory, input: 'stdin survives' });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(dirname(output.scratch), root);
  assert.equal(output.mode, 0o700);
  assert.equal(output.tmpdir, output.scratch);
  assert.equal(output.tmp, output.scratch);
  assert.equal(output.temp, output.scratch);
  assert.equal(output.cwd, directory);
  assert.equal(output.arg, 'argument with spaces');
  assert.equal(output.input, 'stdin survives');
  assert.match(result.stderr, /diagnostic/);
  assert.equal(existsSync(output.scratch), false);
  assert.deepEqual(readdirSync(root), ['keep.txt']);
  assert.equal(readFileSync(join(root, 'keep.txt'), 'utf8'), 'another task');
});

test('failure preserves exit status and explicitly copied diagnostics, but deletes the build', (t) => {
  const directory = workspace(t);
  const root = join(directory, 'scratch');
  const report = join(directory, 'failure.log');
  const result = run(root, ['/bin/bash', '-euo', 'pipefail', '-c', `
    trap 'cp "$AGENT_SCRATCH_DIR/check.log" "$REPORT_PATH"' EXIT
    printf 'failure evidence\n' > "$AGENT_SCRATCH_DIR/check.log"
    mkdir "$AGENT_SCRATCH_DIR/build"
    exit 7
  `], { env: { ...process.env, REPORT_PATH: report } });
  assert.equal(result.status, 7, result.stderr);
  assert.deepEqual(readdirSync(root), []);
  assert.equal(readFileSync(report, 'utf8'), 'failure evidence\n');
});

test('a missing executable fails without leaving scratch', (t) => {
  const root = workspace(t);
  const result = run(root, [join(root, 'does-not-exist')]);
  assert.equal(result.status, 127);
  assert.deepEqual(readdirSync(root), []);
});

test('a replaced scratch directory cannot redirect cleanup into retained files', (t) => {
  const directory = workspace(t);
  const root = join(directory, 'scratch');
  const retained = join(directory, 'retained');
  mkdirSync(retained);
  writeFileSync(join(retained, 'keep.txt'), 'retained evidence');
  const result = run(root, [process.execPath, '-e', `
    const fs = require('node:fs');
    const scratch = process.env.AGENT_SCRATCH_DIR;
    fs.rmdirSync(scratch);
    fs.symlinkSync(process.argv[1], scratch, 'dir');
  `, retained]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Scratch path changed; refusing cleanup/);
  assert.equal(readFileSync(join(retained, 'keep.txt'), 'utf8'), 'retained evidence');
});

test('background descendants cause visible retention instead of premature cleanup', (t) => {
  const root = workspace(t);
  const result = run(root, [process.execPath, '-e', `
    const { spawn } = require('node:child_process');
    const worker = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    worker.unref();
    console.log(JSON.stringify({ scratch: process.env.AGENT_SCRATCH_DIR, pid: worker.pid }));
  `]);
  const output = JSON.parse(result.stdout);
  // Stop this deliberately leaked fixture before removing its scratch.
  process.kill(output.pid, 'SIGTERM');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Scratch retained: task processes still running/);
  assert.equal(existsSync(output.scratch), true);
});

test('default root follows the caller TMPDIR without changing the caller environment', (t) => {
  const root = workspace(t);
  const env = { ...process.env, TMPDIR: root };
  const result = spawnSync('/bin/bash', [script, '--', '/bin/bash', '-c', 'printf "%s" "$AGENT_SCRATCH_DIR"'], {
    env, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(dirname(result.stdout), root);
  assert.equal(env.TMPDIR, root);
  assert.deepEqual(readdirSync(root), []);
});

for (const [signal, status] of [['SIGHUP', 129], ['SIGINT', 130], ['SIGTERM', 143]]) {
  test(`${signal} reaches the task and cleans scratch before the wrapper exits`, { timeout: 10000 }, async (t) => {
    const root = workspace(t);
    const child = spawn('/bin/bash', [script, '--root', root, '--', process.execPath, '-e', `
      const fs = require('node:fs');
      fs.writeFileSync(process.env.AGENT_SCRATCH_DIR + '/active.db', 'generated');
      console.log(process.env.AGENT_SCRATCH_DIR);
      setInterval(() => {}, 1000);
    `], { stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
    let stderr = '';
    child.stderr.on('data', (data) => { stderr += data; });
    const closed = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    const scratch = await new Promise((resolve, reject) => {
      let output = '';
      child.stdout.on('data', (data) => {
        output += data;
        if (output.includes('\n')) resolve(output.trim());
      });
      child.once('error', reject);
      child.once('exit', () => reject(new Error(`Exited before readiness: ${stderr}`)));
    });
    assert.equal(existsSync(join(scratch, 'active.db')), true);
    assert.equal(child.kill(signal), true);
    assert.deepEqual(await closed, { code: status, signal: null }, stderr);
    assert.equal(existsSync(scratch), false, stderr);
    assert.deepEqual(readdirSync(root), []);
  });
}

test('cancellation waits for the task to reap its signaled descendants', { timeout: 10000 }, async (t) => {
  const root = workspace(t);
  const marker = join(root, 'descendant-stopped.txt');
  const child = spawn('/bin/bash', [script, '--root', root, '--', process.execPath, '-e', `
    const { spawn } = require('node:child_process');
    const task = spawn(process.execPath, ['-e', \`
      const fs = require('node:fs');
      process.on('SIGTERM', () => {
        fs.writeFileSync(process.env.STOP_MARKER, String(fs.existsSync(process.env.AGENT_SCRATCH_DIR)));
        process.exit(0);
      });
      console.log('ready');
      setInterval(() => {}, 1000);
    \`]);
    task.stdout.once('data', () => console.log(process.env.AGENT_SCRATCH_DIR));
    process.on('SIGTERM', () => task.once('close', () => process.exit(0)));
  `], { env: { ...process.env, STOP_MARKER: marker }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  let stderr = '';
  child.stderr.on('data', (data) => { stderr += data; });
  const closed = new Promise((resolve) => child.once('close', (code) => resolve(code)));
  const scratch = await new Promise((resolve) => child.stdout.once('data', (data) => resolve(data.toString().trim())));
  child.kill('SIGTERM');
  assert.equal(await closed, 143, stderr);
  assert.equal(readFileSync(marker, 'utf8'), 'true');
  assert.equal(existsSync(scratch), false, stderr);
});

test('cleanup failures are visible and preserve an existing command failure', (t) => {
  if (process.getuid?.() === 0) return t.skip('root bypasses directory permissions');
  const directory = workspace(t);
  const root = join(directory, 'scratch');
  for (const status of [0, 7]) {
    const result = run(root, ['/bin/bash', '-c', `
      mkdir "$AGENT_SCRATCH_DIR/locked"
      printf 'artifact' > "$AGENT_SCRATCH_DIR/locked/file"
      chmod 500 "$AGENT_SCRATCH_DIR/locked"
      printf '%s' "$AGENT_SCRATCH_DIR"
      exit "$1"
    `, 'cleanup-test', String(status)]);
    // Restore only this fixture's directory so test teardown can remove it.
    spawnSync('chmod', ['700', join(result.stdout, 'locked')]);
    assert.equal(result.status, status || 1);
    assert.match(result.stderr, /Scratch cleanup failed/);
    assert.equal(existsSync(join(result.stdout, 'locked/file')), true);
  }
});

test('the installer links the shared helper idempotently and refuses conflicting files', (t) => {
  const home = workspace(t);
  const runInstall = () => spawnSync('/bin/bash', [join(repository, 'scripts/install.sh'), '--agents'], {
    env: { ...process.env, HOME: home, CODEX_HOME: join(home, '.codex') }, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(runInstall().status, 0);
  const target = join(home, '.local/bin/agent-scratch');
  assert.equal(statSync(target).mode & 0o111, 0o111);
  assert.equal(runInstall().status, 0);
  assert.equal(spawnSync(target, ['--help'], { encoding: 'utf8' }).status, 0);
  rmSync(target);
  writeFileSync(target, 'unrelated local tool');
  const conflicting = runInstall();
  assert.equal(conflicting.status, 1);
  assert.match(conflicting.stderr, /Conflict:/);
  assert.equal(readFileSync(target, 'utf8'), 'unrelated local tool');
});
