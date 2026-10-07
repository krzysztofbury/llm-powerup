'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');
const vm = require('node:vm');

async function waitFor(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'runtime did not reach the expected state');
    await delay(10);
  }
}

test('quota runtime retains failed cached samples and age until a successful refresh', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'opendeck-quota-runtime-'));
  const executable = path.join(directory, 'codex');
  const responseFile = path.join(directory, 'response.json');
  const holdFile = path.join(directory, 'hold');
  const children = [];
  const messages = [];
  const errors = [];
  const intervals = new Map();
  let socket;
  let now = 1_800_000_000_000;
  class Clock extends Date {
    static now() { return now; }
  }
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
  const runtimeRequire = (name) => {
    if (name === 'node:child_process') {
      return { spawn: (...args) => {
        const child = spawn(...args);
        children.push(child);
        return child;
      } };
    }
    return require(name);
  };
  runtimeRequire.main = runtimeModule;
  const settings = { codexExecutable: executable, codexHome: directory, refreshMinutes: 5 };
  const event = (name, context = 'quota') => socket.emit('message', JSON.stringify({
    event: name, action: 'dev.krzysztof.agents.quota', context, payload: { settings },
  }));
  const image = (context = 'quota') => {
    const message = messages.findLast((item) => item.event === 'setImage' && item.context === context);
    return message ? Buffer.from(message.payload.image.split(',')[1], 'base64').toString('utf8') : '';
  };
  const reply = (value) => fs.writeFileSync(responseFile, JSON.stringify({ id: 2, ...value }));
  const success = (usedPercent) => reply({ result: { rateLimits: {
    primary: { usedPercent, windowDurationMins: 300 },
    secondary: { usedPercent: 5, windowDurationMins: 10080 },
  } } });

  try {
    fs.writeFileSync(executable, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
if (process.argv.slice(2).join(' ') !== 'app-server --stdio') process.exit(1);
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') console.log(JSON.stringify({ id: message.id, result: {} }));
  if (message.method === 'account/rateLimits/read') {
    const timer = setInterval(() => {
      if (fs.existsSync(path.join(process.env.CODEX_HOME, 'hold'))) return;
      clearInterval(timer);
      console.log(fs.readFileSync(path.join(process.env.CODEX_HOME, 'response.json'), 'utf8'));
    }, 10);
  }
});
`, { mode: 0o755 });
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../plugin.js'), 'utf8'), {
      require: runtimeRequire, module: runtimeModule, Buffer, Date: Clock,
      WebSocket: DeckSocket, setTimeout, clearTimeout,
      setInterval: (callback, milliseconds) => intervals.set(milliseconds, callback),
      console: { error: (...args) => errors.push(args.join(' ')) },
      process: { argv: ['node', 'plugin.js', '-port', '12345', '-pluginUUID', 'fixture', '-registerEvent', 'registerPlugin'], env: process.env },
    }, { filename: 'plugin.js' });
    socket.emit('open');
    assert.deepEqual(messages[0], { event: 'registerPlugin', uuid: 'fixture' });

    reply({ error: { message: 'fixture unavailable' } });
    event('willAppear');
    await waitFor(() => image().includes('OFFLINE'));
    assert.match(image(), /fixture unavailable/);

    success(30);
    event('keyDown');
    await waitFor(() => image().includes('CODEX LEFT'));
    assert.match(image(), /70% \| 95%/);
    const initialCalls = children.length;

    now += 60_000;
    reply({ error: { message: 'fixture unavailable' } });
    event('keyDown');
    await waitFor(() => image().includes('CODEX STALE'));
    assert.match(image(), /70% \| 95%/);
    assert.match(image(), /1M old/);
    assert.equal(children.length, initialCalls + 1);

    now += 60_000;
    intervals.get(30_000)();
    assert.match(image(), /CODEX STALE/);
    assert.match(image(), /2M old/);
    event('didReceiveSettings');
    assert.match(image(), /CODEX STALE/);
    event('willDisappear');
    event('willAppear');
    assert.match(image(), /CODEX STALE/);
    assert.match(image(), /2M old/);
    assert.equal(children.length, initialCalls + 1, 'cache hits must not query the CLI');

    // Expiration is measured from success, not the failed forced refresh.
    now += 3 * 60_000;
    fs.writeFileSync(holdFile, '');
    success(40);
    intervals.get(30_000)();
    assert.equal(children.length, initialCalls + 2);
    assert.match(image(), /5M old/);
    event('willAppear', 'second');
    assert.match(image('second'), /CODEX STALE/);
    event('keyDown');
    intervals.get(30_000)();
    assert.equal(children.length, initialCalls + 2, 'pending requests must be deduplicated');
    fs.unlinkSync(holdFile);
    await waitFor(() => image().includes('CODEX LEFT') && image('second').includes('CODEX LEFT'));
    assert.match(image(), /60% \| 95%/);
    assert.doesNotMatch(image(), /old|STALE/);

    // An expired sample is stale even before the next request fails or succeeds.
    now += 5 * 60_000;
    fs.writeFileSync(holdFile, '');
    intervals.get(30_000)();
    assert.match(image(), /CODEX STALE/);
    assert.match(image(), /5M old/);
    assert.match(image(), /60% \| 95%/);
    fs.unlinkSync(holdFile);
    await waitFor(() => image().includes('CODEX LEFT'));
    assert.equal(errors.length, 2);
    assert.ok(errors.every((error) => error.includes('fixture unavailable')));
  } finally {
    await Promise.all(children.map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const closed = once(child, 'close');
      child.kill('SIGKILL');
      await closed;
    }));
    fs.rmSync(directory, { recursive: true });
  }
});
