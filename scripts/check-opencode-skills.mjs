#!/usr/bin/env node
// Model-free smoke check against an isolated instance of the installed V2 CLI.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = mkdtempSync(join(tmpdir(), 'opencode-skills-'));
const ids = ['article-curator', 'ubiquiti-advisor'];
let child;
let interrupted = false;
let closed;
const stop = () => {
  interrupted = true;
  if (child?.pid) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  }
};
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, stop);
try {
  const config = join(root, 'config');
  mkdirSync(config);
  for (const id of [...ids, 'ordinary-fixture']) {
    const dir = join(config, 'skills', id);
    mkdirSync(dir, { recursive: true });
    const invocation = ids.includes(id) ? 'disable-model-invocation: true\nmetadata:\n  opencode/autoinvoke: false\n' : '';
    writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${id}\ndescription: Synthetic wiring fixture\n${invocation}---\nReturn a fixture.\n`);
  }
  writeFileSync(join(config, 'opencode.json'), JSON.stringify({
    update: 'disable', snapshots: false,
    plugins: ['*', '-opencode.provider.*', '-opencode.wellknown',
      '-opencode.config.compatibility', '-opencode.browser'],
    mcp: { servers: {} },
  }));
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('OPENCODE_CONFIG') || key === 'OPENCODE_DISABLE_PROJECT_CONFIG') delete env[key];
  }
  Object.assign(env, { OPENCODE_CONFIG_DIR: config, OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
    OPENCODE_CONFIG_PROJECT_DISABLE: 'true' });
  child = spawn('opencode', ['serve', '--hostname', '127.0.0.1', '--port', '0', '--log-level', 'warn', '--print-logs'], {
    cwd: root, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  closed = new Promise(resolve => { child.once('close', resolve); child.once('error', resolve); });
  let startup = '';
  let spawnError;
  child.once('error', error => { spawnError = error; });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => {
    if (startup.length < 65536) startup += data.toString();
  });
  const deadline = Date.now() + 20000;
  let result;
  while (Date.now() < deadline && !interrupted) {
    if (spawnError) throw spawnError;
    const url = startup.match(/server listening on (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
    const password = startup.match(/server password (\S+)/)?.[1];
    if (url && password) {
      const response = await fetch(`${url}/api/skill?location[directory]=${encodeURIComponent(root)}`, {
        headers: { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` },
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) throw new Error(`Skill API returned ${response.status}`);
      result = (await response.json()).data;
      if (result.some(skill => skill.id === 'ordinary-fixture') &&
          ids.every(id => result.some(skill => skill.id === id && skill.autoinvoke === false))) break;
    }
    await delay(100);
  }
  if (interrupted) throw new Error('Interrupted');
  assert.ok(result?.some(skill => skill.id === 'ordinary-fixture' && skill.autoinvoke !== false), 'Ordinary skill missing');
  for (const id of ids) {
    const skill = result.find(item => item.id === id);
    assert.ok(skill, `${id} must remain explicitly loadable`);
    assert.equal(skill.autoinvoke, false, `${id} must not be advertised`);
  }
  console.log('Installed OpenCode preserves explicit-only skill registration and ordinary discovery. No model calls.');
} finally {
  stop();
  if (closed) await closed;
  rmSync(root, { recursive: true, force: true });
}
