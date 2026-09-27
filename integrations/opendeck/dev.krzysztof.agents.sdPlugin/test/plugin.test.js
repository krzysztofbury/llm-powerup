'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');

const {
  compactNumber,
  decorateAgents,
  fetchCodexQuota,
  highestPriorityAgent,
  normalizeQuota,
  queryActivity,
  reconcileAgentSlots,
  renderQuota,
  renderPulse,
  requestHerdr,
} = require('../plugin');

function decodeSvg(dataUri) {
  return Buffer.from(dataUri.split(',')[1], 'base64').toString('utf8');
}

test('keeps existing agents in stable slots and fills gaps', () => {
  const agents = [
    { pane_id: 'w1:p1', terminal_id: 'one', tab_id: 'w1:t1' },
    { pane_id: 'w1:p3', terminal_id: 'three', tab_id: 'w1:t3' },
  ];
  assert.deepEqual(reconcileAgentSlots(agents, ['w1:p3', null, 'missing']), ['w1:p3', 'w1:p1', null]);
});

test('uses pane identity when one native session appears in multiple panes', () => {
  const shared = { source: 'herdr:opencode', agent: 'opencode', kind: 'id', value: 'same' };
  const agents = [
    { pane_id: 'w1:p1', agent_session: shared },
    { pane_id: 'w1:p2', agent_session: shared },
  ];
  assert.deepEqual(reconcileAgentSlots(agents, [null, null]), ['w1:p1', 'w1:p2']);
});

test('selects blocked, then done, then working agents for attention', () => {
  const working = { pane_id: 'working', agent_status: 'working', state_change_seq: 9 };
  const done = { pane_id: 'done', agent_status: 'done', state_change_seq: 2 };
  const blocked = { pane_id: 'blocked', agent_status: 'blocked', state_change_seq: 1 };
  assert.equal(highestPriorityAgent([working, done, blocked]), blocked);
  assert.equal(highestPriorityAgent([working, done]), done);
});

test('decorates agents with their Herdr tab label', () => {
  const agents = decorateAgents({
    agents: [{ pane_id: 'p1', tab_id: 't1', agent: 'opencode' }],
    tabs: [{ tab_id: 't1', label: 'Example' }],
  });
  assert.equal(agents[0].displayLabel, 'Example');
});

test('communicates with a Herdr session.snapshot socket', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'opendeck-herdr-'));
  const socketPath = path.join(directory, 'herdr.sock');
  const server = net.createServer((socket) => {
    socket.once('data', (data) => {
      const request = JSON.parse(data.toString().trim());
      assert.equal(request.method, 'session.snapshot');
      socket.end(`${JSON.stringify({ id: request.id, result: { snapshot: { agents: [] } } })}\n`);
    });
  });
  try {
    await new Promise((resolve) => server.listen(socketPath, resolve));
    const previous = process.env.HERDR_SOCKET;
    process.env.HERDR_SOCKET = socketPath;
    try {
      assert.deepEqual(await requestHerdr('session.snapshot'), { snapshot: { agents: [] } });
    } finally {
      if (previous === undefined) delete process.env.HERDR_SOCKET;
      else process.env.HERDR_SOCKET = previous;
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(directory, { recursive: true });
  }
});

test('normalizes Codex 5-hour and 7-day windows', () => {
  const windows = normalizeQuota({
    result: {
      rateLimitsByLimitId: {
        codex: {
          primary: { usedPercent: 30, windowDurationMins: 300 },
          secondary: { usedPercent: 5, windowDurationMins: 10080 },
        },
      },
    },
  });
  assert.deepEqual(windows.map((window) => window.remainingPercent), [70, 95]);
  assert.deepEqual(windows.map((window) => window.durationMinutes), [300, 10080]);
});

test('rejects invalid Codex quota windows', () => {
  assert.throws(() => normalizeQuota({ rateLimits: {} }), /no rate-limit windows/);
  assert.throws(
    () => normalizeQuota({ rateLimits: { primary: { usedPercent: null } } }),
    /invalid rate-limit percentage/,
  );
});

test('rejects malformed Codex responses without escaping the promise', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'opendeck-codex-malformed-'));
  const executable = path.join(directory, 'codex');
  fs.writeFileSync(executable, `#!/bin/sh
IFS= read -r initialize
printf '%s\\n' '{"id":0,"result":{}}'
IFS= read -r initialized
IFS= read -r request
printf '%s\\n' '{"id":2,"result":{}}'
`);
  fs.chmodSync(executable, 0o755);
  try {
    await assert.rejects(
      fetchCodexQuota({ codexExecutable: executable, codexHome: directory }),
      /no rate-limit snapshot/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test('kills a Codex app-server that ignores the timeout signal', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'opendeck-codex-timeout-'));
  const executable = path.join(directory, 'codex');
  const pidFile = path.join(directory, 'pid');
  fs.writeFileSync(executable, `#!/bin/sh
printf '%s\\n' "$$" > "${pidFile}"
trap '' TERM
exec sleep 30
`);
  fs.chmodSync(executable, 0o755);
  try {
    await assert.rejects(
      fetchCodexQuota({ codexExecutable: executable, codexHome: directory }, 25),
      /timed out/,
    );
    const pid = fs.readFileSync(pidFile, 'utf8').trim();
    assert.equal(fs.existsSync(`/proc/${pid}`), false);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test('queries only root OpenCode sessions in the requested window', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'opendeck-agents-'));
  const databasePath = path.join(directory, 'opencode.db');
  const db = new DatabaseSync(databasePath);
  db.exec(`
    CREATE TABLE session (id TEXT PRIMARY KEY, parent_id TEXT);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
  `);
  const insertSession = db.prepare('INSERT INTO session VALUES (?, ?)');
  insertSession.run('root', null);
  insertSession.run('child', 'root');
  const insertMessage = db.prepare('INSERT INTO message VALUES (?, ?, ?, ?)');
  const data = JSON.stringify({ role: 'assistant', tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 300 } } });
  insertMessage.run('current-root', 'root', Date.now(), data);
  insertMessage.run('current-child', 'child', Date.now(), data);
  insertMessage.run('old-root', 'root', Date.now() - (48 * 60 * 60 * 1000), data);
  db.close();

  try {
    assert.deepEqual(queryActivity(24, databasePath), {
      sessions: 1,
      messages: 1,
      input: 100,
      output: 20,
      reasoning: 5,
      cache_read: 300,
    });
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test('renders self-contained SVG data and compact values', () => {
  assert.match(renderPulse([{ agent_status: 'blocked' }], true), /^data:image\/svg\+xml;base64,/);
  assert.match(decodeSvg(renderPulse([{ agent_status: 'unknown' }], true)), /1 UNKNOWN/);
  assert.match(decodeSvg(renderQuota([{ remainingPercent: 70, durationMinutes: 300 }], 'offline')), /CODEX STALE/);
  assert.equal(compactNumber(1_853_322), '1.9M');
});
