'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');
const vm = require('node:vm');

const {
  normalizeClaudeQuota,
  readClaudeUsageRecord,
  renderClaudeActivity,
  renderClaudeQuota,
  runClaudeUsageRefresh,
  summarizeClaudeActivity,
} = require('../plugin');

function decodeSvg(dataUri) {
  return Buffer.from(dataUri.split(',')[1], 'base64').toString('utf8');
}

const NOW = Date.parse('2026-10-19T12:45:00Z');
function record(overrides = {}) {
  return {
    id: 'claude',
    updatedAt: '2026-10-19T12:40:00Z',
    limits: [
      { label: 'Session (5-hour)', percent: 0.41, resetsAt: '2026-10-19T14:09:59Z' },
      { label: 'Weekly (7-day)', percent: 0.06, resetsAt: '2026-10-24T20:00:00Z' },
      { label: 'Model Weekly', percent: 0.9, resetsAt: '2026-10-24T20:00:00Z' },
    ],
    todayTotalTokens: 221_502_536,
    todaySessions: 26,
    todayPrompts: 1094,
    recentDays: [0, 1, 2, 0, 4, 5, 6].map((tokens, day) => ({ date: `2026-10-1${3 + day}`, messageCount: tokens * 1_000_000 })),
    ...overrides,
  };
}

test('reads the Claude 5-hour and 7-day windows, not model-specific ones', () => {
  const quota = normalizeClaudeQuota(record(), NOW);
  assert.deepEqual(quota.windows.map((window) => [window.label, window.remainingPercent]), [['5H', 59], ['7D', 94]]);
  assert.equal(quota.updatedAt, Date.parse('2026-10-19T12:40:00Z'));
});

test('a window whose reset passed after the record was written shows full allowance', () => {
  const later = Date.parse('2026-10-19T15:00:00Z');
  assert.deepEqual(normalizeClaudeQuota(record(), later).windows.map((window) => window.remainingPercent), [100, 94]);
});

test('unknown Claude limits are reported, not shown as full allowance', () => {
  assert.throws(() => normalizeClaudeQuota(record({ limits: [{ label: 'Session (5-hour)', percent: -1 }] }), NOW), /no limits/);
  assert.throws(() => normalizeClaudeQuota(record({ limits: [], usageStatusText: 'Sign in to Claude' }), NOW), /Sign in to Claude/);
  assert.match(decodeSvg(renderClaudeQuota(record({ limits: [] }), undefined, NOW)), /NO DATA/);
});

test('an old Claude record is marked stale with its age', () => {
  assert.match(decodeSvg(renderClaudeQuota(record(), undefined, NOW)), /CLAUDE LEFT[\s\S]*59% \| 94%[\s\S]*5H \| 7D \| 5M/);
  const hourLater = NOW + 60 * 60_000;
  assert.match(decodeSvg(renderClaudeQuota(record(), undefined, hourLater)), /CLAUDE STALE[\s\S]*5H \| 7D \| 1H/);
  assert.match(decodeSvg(renderClaudeQuota(record(), 'record unreadable', NOW)), /CLAUDE STALE/);
});

test('Claude activity shows today and the last seven days from the record', () => {
  assert.deepEqual(summarizeClaudeActivity(record(), 24), { title: 'CLAUDE TODAY', tokens: 221_502_536, footer: '26 sessions' });
  assert.deepEqual(summarizeClaudeActivity(record(), 168), { title: 'CLAUDE 7D', tokens: 18_000_000, footer: '5 active days' });
  assert.match(decodeSvg(renderClaudeActivity(24, undefined, 'no usage record')), /CLAUDE TODAY[\s\S]*NO DATA/);
});

test('only a Claude usage record is accepted', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'opendeck-claude-record-'));
  try {
    const file = path.join(directory, 'claude.json');
    fs.writeFileSync(file, JSON.stringify(record()));
    assert.equal(readClaudeUsageRecord(file).todaySessions, 26);
    fs.writeFileSync(file, JSON.stringify({ id: 'codex' }));
    assert.throws(() => readClaudeUsageRecord(file), /not a Claude usage record/);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test('a Claude key press asks the collector to refresh only the Claude record', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'opendeck-collector-'));
  const executable = path.join(directory, 'omarchy-agent-usage-update');
  const argsFile = path.join(directory, 'args');
  fs.writeFileSync(executable, `#!/bin/sh\nprintf '%s\\n' "$@" > "${argsFile}"\n`);
  fs.chmodSync(executable, 0o755);
  const previous = process.env.OMARCHY_AGENT_USAGE_UPDATE;
  process.env.OMARCHY_AGENT_USAGE_UPDATE = executable;
  try {
    assert.deepEqual(await runClaudeUsageRefresh(['--limits-only']), { ok: true });
    assert.deepEqual(fs.readFileSync(argsFile, 'utf8').trim().split('\n'), ['--limits-only', 'claude']);
    process.env.OMARCHY_AGENT_USAGE_UPDATE = path.join(directory, 'missing');
    assert.equal((await runClaudeUsageRefresh()).ok, false);
  } finally {
    if (previous === undefined) delete process.env.OMARCHY_AGENT_USAGE_UPDATE;
    else process.env.OMARCHY_AGENT_USAGE_UPDATE = previous;
    fs.rmSync(directory, { recursive: true });
  }
});

test('runtime: keys with source claude read the record and refresh it on press', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'opendeck-claude-runtime-'));
  const recordFile = path.join(directory, 'claude.json');
  const argsFile = path.join(directory, 'args');
  const collector = path.join(directory, 'collector');
  fs.writeFileSync(collector, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${argsFile}"\n`, { mode: 0o755 });
  const future = new Date(Date.now() + 60 * 60_000).toISOString();
  const limits = record().limits.map((limit) => ({ ...limit, resetsAt: future }));
  fs.writeFileSync(recordFile, JSON.stringify(record({ updatedAt: new Date().toISOString(), limits })));
  const messages = [];
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
    setInterval: () => {}, console: { error: () => {} },
    process: {
      argv: ['node', 'plugin.js', '-port', '1', '-pluginUUID', 'fixture', '-registerEvent', 'registerPlugin'],
      env: { ...process.env, CLAUDE_USAGE_RECORD: recordFile, OMARCHY_AGENT_USAGE_UPDATE: collector },
    },
  }, { filename: 'plugin.js' });
  socket.emit('open');
  const event = (name, action, context, settings) => socket.emit('message', JSON.stringify({ event: name, action, context, payload: { settings } }));
  const image = (context) => {
    const message = messages.findLast((item) => item.event === 'setImage' && item.context === context);
    return message ? decodeSvg(message.payload.image) : '';
  };
  try {
    event('willAppear', 'dev.krzysztof.agents.quota', 'quota', { source: 'claude' });
    event('willAppear', 'dev.krzysztof.agents.activity', 'week', { source: 'claude', hours: 168 });
    assert.match(image('quota'), /CLAUDE LEFT[\s\S]*59% \| 94%/);
    assert.match(image('week'), /CLAUDE 7D[\s\S]*18\.0M/);
    event('keyDown', 'dev.krzysztof.agents.quota', 'quota', { source: 'claude' });
    const deadline = Date.now() + 5000;
    while (!messages.some((item) => item.event === 'showOk')) {
      assert.ok(Date.now() < deadline, 'press did not complete');
      await delay(10);
    }
    assert.equal(fs.readFileSync(argsFile, 'utf8').trim(), '--limits-only claude');
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});
