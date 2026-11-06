import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(new URL('../integrations/claude/statusline-command.sh', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'statusline-'));
after(() => rmSync(scratch, {recursive:true, force:true}));
let configDirs = 0;
function newConfigDir() {
  const dir = join(scratch, `config-${configDirs++}`);
  mkdirSync(dir);
  return dir;
}
function render(input, configDir = newConfigDir()) {
  const env = {...process.env, CLAUDE_CONFIG_DIR:configDir};
  const result = spawnSync('/bin/bash', [script], { input, encoding:'utf8', timeout:5000, env });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.replace(/\x1b\[[0-9;]*m/g, '');
}
test('status line reflects live effort, thinking, duration, and native quotas', () => {
  const output = render(JSON.stringify({
    model: {display_name:'Opus'}, effort:{level:'xhigh'}, thinking:{enabled:true},
    cost:{total_duration_ms:120000}, context_window:{used_percentage:23.5},
    rate_limits:{five_hour:{used_percentage:51, resets_at:1790449627}, seven_day:{used_percentage:27}},
  }));
  assert.match(output, /Opus.*23%.*2m.*effort xhigh.*thinking on/);
  assert.match(output, /^current.*51%.*resets.* \| weekly.*27%$/m);
  assert.equal(output.trimEnd().split('\n').length, 2);
});
test('malformed fields still render the session row', () => {
  const output = render(JSON.stringify({
    model:{display_name:'Opus'}, context_window:{used_percentage:'bad'}, rate_limits:'bad',
  }));
  assert.match(output, /^Opus \| 0% \| thinking unknown\n$/);
});
test('text fields cannot shift into arithmetic and run commands', () => {
  const dir = mkdtempSync(join(tmpdir(), 'statusline-'));
  const marker = join(dir, 'pwned');
  try {
    const output = render(JSON.stringify({
      model:{display_name:`Opus\x1f\x1fa[$(touch ${marker})]`}, workspace:{current_dir:'/x/y\nz'},
    }));
    assert.equal(existsSync(marker), false);
    assert.match(output, /^Opus  a\[.*\] \| 0% \| y z \| thinking unknown\n$/);
  } finally {
    rmSync(dir, {recursive:true, force:true});
  }
});
test('missing quotas and thinking are unknown, not invented zero values', () => {
  const output = render(JSON.stringify({model:{display_name:'Fable'}, thinking:{enabled:false}}));
  assert.match(output, /thinking off/);
  assert.doesNotMatch(output, /weekly|current|effort/);
  assert.match(render('{}'), /thinking unknown/);
});
test('invalid input renders a quiet fallback', () => {
  assert.equal(render('invalid'), 'Claude\n');
});
const inOneHour = Math.floor(Date.now() / 1000) + 3600;
const inTwoHours = inOneHour + 3600;
const session = rate_limits => JSON.stringify({model:{display_name:'Opus'}, rate_limits});
test('a session with no quota data shows what another session reported', () => {
  const configDir = newConfigDir();
  render(session({five_hour:{used_percentage:40, resets_at:inOneHour}}), configDir);
  assert.match(render(session(undefined), configDir), /^current.*40%/m);
});
test('quotas are not shared across Claude config directories', () => {
  render(session({five_hour:{used_percentage:40, resets_at:inOneHour}}));
  assert.doesNotMatch(render(session(undefined)), /current/);
});
test('an idle session cannot lower the current window', () => {
  const configDir = newConfigDir();
  render(session({five_hour:{used_percentage:40, resets_at:inOneHour}}), configDir);
  const idle = render(session({five_hour:{used_percentage:30, resets_at:inOneHour}}), configDir);
  assert.match(idle, /^current.*40%/m);
  assert.match(render(session(undefined), configDir), /^current.*40%/m);
});
test('a new window replaces a fuller previous one', () => {
  const configDir = newConfigDir();
  render(session({five_hour:{used_percentage:90, resets_at:inOneHour}}), configDir);
  assert.match(render(session({five_hour:{used_percentage:5, resets_at:inTwoHours}}), configDir), /^current.*5%/m);
  assert.match(render(session(undefined), configDir), /^current.*5%/m);
});
test('a reported window that has reset is not shown again', () => {
  const configDir = newConfigDir();
  const longAgo = Math.floor(Date.now() / 1000) - 60;
  render(session({five_hour:{used_percentage:40, resets_at:longAgo}}), configDir);
  assert.doesNotMatch(render(session(undefined), configDir), /current/);
});
test('a damaged quota store still renders and heals', () => {
  const configDir = newConfigDir();
  mkdirSync(join(configDir, 'cache'));
  const store = join(configDir, 'cache', 'statusline-rate-limits.json');
  for (const damaged of ['{not json', '"text"', '{"five_hour":{"used_percentage":"$(id)","resets_at":"x"}}']) {
    writeFileSync(store, damaged);
    assert.match(render(session(undefined), configDir), /^Opus \| 0% \| thinking unknown\n$/);
  }
  assert.match(render(session({five_hour:{used_percentage:40, resets_at:inOneHour}}), configDir), /^current.*40%/m);
  assert.match(render(session(undefined), configDir), /^current.*40%/m);
});
test('the quota store is private to the user', () => {
  const configDir = newConfigDir();
  render(session({five_hour:{used_percentage:40, resets_at:inOneHour}}), configDir);
  const store = join(configDir, 'cache', 'statusline-rate-limits.json');
  assert.equal(statSync(store).mode & 0o777, 0o600);
});
