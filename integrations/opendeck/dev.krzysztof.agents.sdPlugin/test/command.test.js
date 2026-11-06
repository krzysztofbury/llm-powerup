'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');
const vm = require('node:vm');

const {
  commandSettings,
  interpretCommandStatus,
  renderCommand,
  runCommand,
} = require('../plugin');

function decodeSvg(dataUri) {
  return Buffer.from(dataUri.split(',')[1], 'base64').toString('utf8');
}

function fixtureDirectory(t, prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function writeScript(file, body) {
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return file;
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(predicate, message = 'expected state not reached') {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, message);
    await delay(10);
  }
}

test('Run Command settings come only from the action settings, with safe defaults', () => {
  const settings = commandSettings({ command: '/usr/local/bin/cam-toggle' });
  assert.equal(settings.title, 'CAM-TOGGLE');
  assert.deepEqual(settings.args, []);
  assert.equal(settings.statusArgs, null);
  assert.equal(settings.intervalMs, 5000);
  assert.equal(settings.timeoutMs, 15_000);

  const full = commandSettings({
    command: 'cam-toggle', args: ['toggle'], statusArgs: ['status'], title: 'Cam',
    onText: 'LIVE', offText: 'IDLE', onColor: '#dc2626', intervalSeconds: 0.1, timeoutSeconds: 9999,
  });
  assert.deepEqual([full.args, full.statusArgs, full.title, full.onText, full.offText, full.onColor], [['toggle'], ['status'], 'CAM', 'LIVE', 'IDLE', '#dc2626']);
  assert.equal(full.intervalMs, 1000);
  assert.equal(full.timeoutMs, 600_000);

  assert.throws(() => commandSettings({}), /command is not set/);
  assert.throws(() => commandSettings({ command: '   ' }), /command is not set/);
  assert.throws(() => commandSettings({ command: 'x', args: 'toggle' }), /args must be a list of strings/);
  assert.throws(() => commandSettings({ command: 'x', args: [1] }), /args must be a list of strings/);
  assert.throws(() => commandSettings({ command: 'x', statusArgs: [null] }), /statusArgs must be a list of strings/);
  assert.equal(commandSettings({ command: 'x', onColor: 'red"/><script' }).onColor, '#22c55e');
});

test('status output words win over the exit status', () => {
  assert.equal(interpretCommandStatus({ code: 0, stdout: 'on\n' }), 'on');
  assert.equal(interpretCommandStatus({ code: 0, stdout: ' OFF \nextra' }), 'off');
  assert.equal(interpretCommandStatus({ code: 3, stdout: 'active' }), 'on');
  assert.equal(interpretCommandStatus({ code: 0, stdout: '' }), 'on');
  assert.equal(interpretCommandStatus({ code: 3, stdout: 'something else' }), 'off');
  assert.equal(interpretCommandStatus({ code: -1, stdout: '', error: 'spawn x ENOENT' }), 'error');
});

test('arguments reach the command verbatim, without a shell', async (t) => {
  const directory = fixtureDirectory(t, 'opendeck-command-args-');
  const marker = path.join(directory, 'injected');
  const executable = writeScript(path.join(directory, 'echo-args'), 'for arg in "$@"; do printf "%s\\n" "$arg"; done\nexit 4');
  const args = [`$(touch ${marker})`, `; touch ${marker}`, '*', '~/x', '$HOME'];
  const result = await runCommand(executable, args, { captureOutput: true });
  assert.equal(result.code, 4);
  assert.deepEqual(result.stdout.trimEnd().split('\n'), args);
  assert.equal(fs.existsSync(marker), false);
});

test('a bare command name falls back to ~/.local/bin, and a missing one reports an error', async (t) => {
  const home = fixtureDirectory(t, 'opendeck-command-home-');
  fs.mkdirSync(path.join(home, '.local/bin'), { recursive: true });
  writeScript(path.join(home, '.local/bin', 'deck-fixture-command'), 'echo on');
  const previous = { HOME: process.env.HOME, PATH: process.env.PATH };
  process.env.HOME = home;
  process.env.PATH = '/usr/bin:/bin';
  t.after(() => Object.assign(process.env, previous));
  assert.deepEqual(await runCommand('deck-fixture-command', [], { captureOutput: true }), { code: 0, stdout: 'on\n' });
  const missing = await runCommand('deck-fixture-missing', [], { captureOutput: true });
  assert.equal(missing.code, -1);
  assert.match(missing.error, /ENOENT/);
  assert.equal(interpretCommandStatus(missing), 'error');
});

test('a timeout kills the whole process group', async (t) => {
  const directory = fixtureDirectory(t, 'opendeck-command-timeout-');
  const pidFile = path.join(directory, 'pid');
  const executable = writeScript(path.join(directory, 'hang'), `sleep 30 &\necho $! > "${pidFile}"\nwait`);
  const result = await runCommand(executable, [], { timeoutMs: 300, captureOutput: true });
  assert.equal(result.error, 'timed out');
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  await waitFor(() => !processAlive(pid), 'background child survived the timeout');
});

test('a press settles when the command exits, even if it left a background child', async (t) => {
  const directory = fixtureDirectory(t, 'opendeck-command-background-');
  const pidFile = path.join(directory, 'pid');
  const executable = writeScript(path.join(directory, 'spawn-and-exit'), `sleep 30 &\necho $! > "${pidFile}"`);
  t.after(() => {
    try { process.kill(Number(fs.readFileSync(pidFile, 'utf8')), 'SIGKILL'); } catch {}
  });
  const started = Date.now();
  assert.deepEqual(await runCommand(executable, [], { timeoutMs: 10_000 }), { code: 0, stdout: '' });
  assert.ok(Date.now() - started < 5000);
});

test('the key image reflects state and escapes the configured title', () => {
  const on = decodeSvg(renderCommand({ title: 'a<b>', state: 'on', onText: 'LIVE', onColor: '#dc2626' }));
  assert.match(on, /fill="#dc2626"/);
  assert.match(on, />a&lt;b&gt;</);
  assert.match(on, /LIVE/);
  assert.doesNotMatch(on, /<line x1="16" y1="52"/);
  const off = decodeSvg(renderCommand({ title: 'cam', state: 'off' }));
  assert.match(off, /OFF/);
  assert.match(off, /<line x1="16" y1="52"/);
  assert.match(decodeSvg(renderCommand({ state: 'pending' })), /WAIT/);
  assert.match(decodeSvg(renderCommand({ state: 'error' })), /ERROR/);
  assert.match(decodeSvg(renderCommand({ title: 'DEPLOY' })), /DEPLOY[\s\S]*RUN/);
});

test('runtime: a status key polls, toggles on press, and rejects invalid settings', async (t) => {
  const directory = fixtureDirectory(t, 'opendeck-command-runtime-');
  const stateFile = path.join(directory, 'state');
  const logFile = path.join(directory, 'log');
  fs.writeFileSync(stateFile, 'off\n');
  const executable = writeScript(path.join(directory, 'toggle-fixture'), `printf '%s\\n' "$*" >> "${logFile}"
case "$1" in
  status) cat "${stateFile}" ;;
  toggle) if [ "$(cat "${stateFile}")" = on ]; then echo off > "${stateFile}"; else echo on > "${stateFile}"; fi ;;
  *) exit 2 ;;
esac`);

  const messages = [];
  const errors = [];
  const intervals = new Map();
  let socket;
  class DeckSocket {
    static OPEN = 1;
    readyState = 1;
    listeners = new Map();
    constructor() { socket = this; }
    addEventListener(event, callback) { this.listeners.set(event, callback); }
    send(raw) { messages.push(JSON.parse(raw)); }
    emit(event, data) { this.listeners.get(event)({ data }); }
  }
  const runtimeModule = { exports: {} };
  const runtimeRequire = (name) => require(name);
  runtimeRequire.main = runtimeModule;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../plugin.js'), 'utf8'), {
    require: runtimeRequire, module: runtimeModule, Buffer, Date, WebSocket: DeckSocket, setTimeout, clearTimeout,
    setInterval: (callback, milliseconds) => intervals.set(milliseconds, callback),
    console: { error: (...args) => errors.push(args.join(' ')) },
    process: {
      argv: ['node', 'plugin.js', '-port', '12345', '-pluginUUID', 'fixture', '-registerEvent', 'registerPlugin'],
      env: process.env,
      kill: process.kill.bind(process),
    },
  }, { filename: 'plugin.js' });
  socket.emit('open');

  const settings = {
    command: executable, args: ['toggle'], statusArgs: ['status'], title: 'Camera', onText: 'LIVE', onColor: '#dc2626',
  };
  const event = (name, context, payloadSettings) => socket.emit('message', JSON.stringify({
    event: name, action: 'dev.krzysztof.agents.command', context, payload: { settings: payloadSettings },
  }));
  const image = (context) => {
    const message = messages.findLast((item) => item.event === 'setImage' && item.context === context);
    return message ? decodeSvg(message.payload.image) : '';
  };
  const feedback = (context) => messages.filter((item) => item.context === context && /^show/.test(item.event)).map((item) => item.event);

  event('willAppear', 'cam', settings);
  await waitFor(() => fs.existsSync(logFile) && image('cam').includes('OFF'));
  assert.match(image('cam'), /CAMERA/);

  event('keyDown', 'cam', settings);
  await waitFor(() => image('cam').includes('LIVE'));
  assert.match(image('cam'), /fill="#dc2626"/);
  assert.deepEqual(feedback('cam'), ['showOk']);
  assert.deepEqual(fs.readFileSync(logFile, 'utf8').trim().split('\n'), ['status', 'toggle', 'status']);

  // An outside change is picked up by the next poll tick.
  fs.writeFileSync(stateFile, 'off\n');
  await delay(5);
  intervals.get(1000)(Date.now() + 60_000);
  await waitFor(() => image('cam').includes('OFF'));

  event('willAppear', 'broken', { args: ['toggle'] });
  await waitFor(() => image('broken').includes('ERROR'));
  event('keyDown', 'broken', { args: ['toggle'] });
  await waitFor(() => feedback('broken').length === 1);
  assert.deepEqual(feedback('broken'), ['showAlert']);
  assert.ok(errors.some((error) => /command is not set/.test(error)));

  event('willAppear', 'plain', { command: executable, args: ['bogus'] });
  await waitFor(() => image('plain').includes('RUN'));
  event('keyDown', 'plain', { command: executable, args: ['bogus'] });
  await waitFor(() => feedback('plain').length === 1);
  assert.deepEqual(feedback('plain'), ['showAlert']);
  assert.ok(errors.some((error) => /exit status 2/.test(error)));
});
