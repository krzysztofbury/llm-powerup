'use strict';

const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ACTIONS = Object.freeze({
  pulse: 'dev.krzysztof.agents.pulse',
  session: 'dev.krzysztof.agents.session',
  quota: 'dev.krzysztof.agents.quota',
  activity: 'dev.krzysztof.agents.activity',
  command: 'dev.krzysztof.agents.command',
});

const COLORS = Object.freeze({
  blocked: '#ef4444',
  working: '#f59e0b',
  done: '#22c55e',
  idle: '#3b82f6',
  unknown: '#64748b',
  offline: '#475569',
  background: '#07111f',
  panel: '#0f1d2e',
  text: '#f8fafc',
  muted: '#94a3b8',
});

const contexts = new Map();
const lastImages = new Map();
const slotIds = Array(10).fill(null);
let deckSocket;
let latestAgents = [];
let herdrOnline = false;
let herdrRefreshPending = false;
let quotaRefreshPending = false;
let latestQuota;
let latestQuotaError;
let lastQuotaRefresh = 0;
let activityRefreshPending = false;
const activityByHours = new Map();
let latestClaudeRecord;
let latestClaudeRecordError;
let claudeRefreshPending = false;
const commandStates = new Map();

// Omarchy's agents panel rewrites the Claude record every 15 minutes, so twice
// that is stale.
const CLAUDE_STALE_MS = 30 * 60_000;
const CLAUDE_QUOTA_WINDOWS = Object.freeze([
  { label: '5H', match: /5-hour/i },
  { label: '7D', match: /^weekly \(7-day\)$/i },
]);

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '-port') parsed.port = argv[index + 1];
    if (argv[index] === '-pluginUUID') parsed.pluginUUID = argv[index + 1];
    if (argv[index] === '-registerEvent') parsed.registerEvent = argv[index + 1];
  }
  return parsed;
}

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function truncate(value, length) {
  const text = String(value ?? '').trim();
  return text.length <= length ? text : `${text.slice(0, Math.max(0, length - 1))}.`;
}

function renderCard({ accent, title, main, footer, focused = false }) {
  const ring = focused
    ? `<rect x="2" y="2" width="68" height="68" rx="13" fill="none" stroke="#7dd3fc" stroke-width="2"/>`
    : '';
  return `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72">
  <rect width="72" height="72" rx="14" fill="${COLORS.background}"/>
  <rect x="4" y="4" width="64" height="64" rx="11" fill="${COLORS.panel}"/>
  <rect x="4" y="4" width="64" height="5" rx="2.5" fill="${accent}"/>
  ${ring}
  <text x="36" y="22" text-anchor="middle" fill="${COLORS.muted}" font-family="sans-serif" font-size="8" font-weight="700">${escapeXml(title)}</text>
  <text x="36" y="43" text-anchor="middle" fill="${COLORS.text}" font-family="sans-serif" font-size="13" font-weight="800">${escapeXml(main)}</text>
  <text x="36" y="59" text-anchor="middle" fill="${COLORS.muted}" font-family="sans-serif" font-size="7">${escapeXml(footer)}</text>
</svg>`).toString('base64')}`;
}

function compactNumber(value) {
  const number = Number(value) || 0;
  if (number >= 1_000_000_000) return `${(number / 1_000_000_000).toFixed(1)}B`;
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1)}M`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(1)}K`;
  return String(number);
}

function statusPriority(agent) {
  const rank = { blocked: 0, done: 1, working: 2, idle: 3, unknown: 4 };
  return rank[agent?.agent_status] ?? 4;
}

function agentIdentity(agent) {
  return agent?.pane_id
    || [agent?.agent_session?.source, agent?.agent_session?.agent, agent?.agent_session?.kind, agent?.agent_session?.value]
      .filter(Boolean)
      .join(':')
    || agent?.terminal_id;
}

function reconcileAgentSlots(agents, existingSlots = slotIds) {
  const byId = new Map(agents.map((agent) => [agentIdentity(agent), agent]));
  const next = existingSlots.map((id) => (byId.has(id) ? id : null));
  const assigned = new Set(next.filter(Boolean));
  const additions = agents
    .filter((agent) => !assigned.has(agentIdentity(agent)))
    .sort((left, right) => {
      const leftTab = Number.parseInt(left.tab_id?.split('t').at(-1), 16);
      const rightTab = Number.parseInt(right.tab_id?.split('t').at(-1), 16);
      return (leftTab || 0) - (rightTab || 0);
    });

  for (const agent of additions) {
    const freeSlot = next.indexOf(null);
    if (freeSlot === -1) break;
    next[freeSlot] = agentIdentity(agent);
  }
  return next;
}

function highestPriorityAgent(agents) {
  return [...agents].sort((left, right) => {
    const priority = statusPriority(left) - statusPriority(right);
    if (priority !== 0) return priority;
    return (right.state_change_seq || 0) - (left.state_change_seq || 0);
  })[0];
}

function tabLabel(agent, snapshot) {
  const tab = snapshot?.tabs?.find((candidate) => candidate.tab_id === agent.tab_id);
  return tab?.label || agent.name || agent.display_agent || agent.agent || 'Agent';
}

function decorateAgents(snapshot) {
  return (snapshot?.agents || []).map((agent) => ({
    ...agent,
    displayLabel: tabLabel(agent, snapshot),
  }));
}

function renderPulse(agents, online) {
  if (!online) {
    return renderCard({ accent: COLORS.offline, title: 'HERDR', main: 'OFFLINE', footer: 'socket unavailable' });
  }
  const counts = Object.fromEntries(['blocked', 'working', 'done', 'idle', 'unknown'].map((status) => [
    status,
    agents.filter((agent) => agent.agent_status === status).length,
  ]));
  let accent = COLORS.offline;
  let main = 'NO AGENTS';
  if (!agents.length) {
    main = 'NO AGENTS';
  } else if (counts.blocked) {
    accent = COLORS.blocked;
    main = `${counts.blocked} BLOCKED`;
  } else if (counts.done) {
    accent = COLORS.done;
    main = `${counts.done} DONE`;
  } else if (counts.working) {
    accent = COLORS.working;
    main = `${counts.working} WORKING`;
  } else if (counts.unknown) {
    accent = COLORS.unknown;
    main = `${counts.unknown} UNKNOWN`;
  } else {
    accent = COLORS.idle;
    main = 'ALL IDLE';
  }
  return renderCard({
    accent,
    title: 'AGENT PULSE',
    main,
    footer: `${agents.length} live | ${counts.working} work | ${counts.blocked} block`,
  });
}

function renderSession(agent, online) {
  if (!online) {
    return renderCard({ accent: COLORS.offline, title: 'SESSION', main: 'OFFLINE', footer: 'Herdr unavailable' });
  }
  if (!agent) {
    return renderCard({ accent: COLORS.offline, title: 'SESSION', main: 'EMPTY', footer: 'waiting for agent' });
  }
  const status = agent.agent_status || 'unknown';
  return renderCard({
    accent: COLORS[status] || COLORS.unknown,
    title: truncate(agent.displayLabel, 13).toUpperCase(),
    main: status.toUpperCase(),
    footer: `${agent.agent || 'agent'} | ${agent.pane_id}`,
    focused: Boolean(agent.focused),
  });
}

function durationLabel(minutes) {
  if (!Number.isFinite(minutes)) return 'LIMIT';
  if (minutes >= 1440) return `${Math.round(minutes / 1440)}D`;
  if (minutes >= 60) return `${Math.round(minutes / 60)}H`;
  return `${minutes}M`;
}

function normalizeQuota(value) {
  const result = value?.result || value;
  const buckets = result?.rateLimitsByLimitId;
  const snapshot = buckets?.codex
    || Object.values(buckets || {}).find((bucket) => bucket?.limitId === 'codex')
    || result?.rateLimits;
  if (!snapshot) throw new Error('Codex returned no rate-limit snapshot');
  const rawWindows = [snapshot.primary, snapshot.secondary].filter(Boolean);
  if (!rawWindows.length) throw new Error('Codex returned no rate-limit windows');
  return rawWindows
    .map((window) => {
      const usedPercent = window.usedPercent;
      if (typeof usedPercent !== 'number' || !Number.isFinite(usedPercent)) {
        throw new Error('Codex returned an invalid rate-limit percentage');
      }
      const clampedUsedPercent = Math.max(0, Math.min(100, usedPercent));
      return {
        usedPercent: clampedUsedPercent,
        remainingPercent: 100 - clampedUsedPercent,
        durationMinutes: Number.isFinite(window.windowDurationMins) ? window.windowDurationMins : null,
        resetsAt: window.resetsAt || null,
      };
    })
    .sort((left, right) => (left.durationMinutes ?? Infinity) - (right.durationMinutes ?? Infinity));
}

function renderQuota(windows, error, lastSuccess) {
  if (!windows) {
    return renderCard({
      accent: error ? COLORS.blocked : COLORS.working,
      title: 'CODEX LIMITS',
      main: error ? 'OFFLINE' : 'LOADING',
      footer: truncate(error || 'checking quota', 22),
    });
  }
  const minimum = Math.min(...windows.map((window) => window.remainingPercent));
  const accent = error ? COLORS.working : minimum <= 20 ? COLORS.blocked : minimum <= 50 ? COLORS.working : COLORS.done;
  const age = Number.isFinite(lastSuccess)
    ? `${durationLabel(Math.max(0, Math.floor((Date.now() - lastSuccess) / 60_000)))} old`
    : 'STALE';
  return renderCard({
    accent,
    title: error ? 'CODEX STALE' : 'CODEX LEFT',
    main: windows.map((window) => `${window.remainingPercent}%`).join(' | '),
    footer: `${windows.map((window) => durationLabel(window.durationMinutes)).join(' | ')}${error ? ` | ${age}` : ''}`,
  });
}

function queryActivity(hours, databasePath = process.env.OPENCODE_DB || path.join(os.homedir(), '.local/share/opencode/opencode.db')) {
  // Loaded lazily so the other keys still work on a Node without node:sqlite.
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const row = db.prepare(`
      SELECT
        COUNT(DISTINCT m.session_id) AS sessions,
        COUNT(*) AS messages,
        COALESCE(SUM(CAST(json_extract(m.data, '$.tokens.input') AS INTEGER)), 0) AS input,
        COALESCE(SUM(CAST(json_extract(m.data, '$.tokens.output') AS INTEGER)), 0) AS output,
        COALESCE(SUM(CAST(json_extract(m.data, '$.tokens.reasoning') AS INTEGER)), 0) AS reasoning,
        COALESCE(SUM(CAST(json_extract(m.data, '$.tokens.cache.read') AS INTEGER)), 0) AS cache_read
      FROM message m
      JOIN session s ON s.id = m.session_id
      WHERE s.parent_id IS NULL
        AND json_extract(m.data, '$.role') = 'assistant'
        AND m.time_created >= ?
    `).get(Date.now() - (hours * 60 * 60 * 1000));
    return { ...row };
  } finally {
    db.close();
  }
}

function renderActivity(hours, activity) {
  if (activity?.error) {
    return renderCard({ accent: COLORS.blocked, title: `OPENCODE ${hours === 24 ? '24H' : '7D'}`, main: 'NO DATA', footer: truncate(activity.error, 22) });
  }
  if (!activity) {
    return renderCard({ accent: COLORS.working, title: `OPENCODE ${hours === 24 ? '24H' : '7D'}`, main: 'LOADING', footer: 'local activity' });
  }
  const tokens = Number(activity.input) + Number(activity.output) + Number(activity.reasoning);
  return renderCard({
    accent: COLORS.idle,
    title: `OPENCODE ${hours === 24 ? '24H' : '7D'}`,
    main: `${compactNumber(tokens)} TOK`,
    footer: `${activity.sessions} sess | ${compactNumber(activity.cache_read)} cache`,
  });
}

// With `source: "claude"`, the quota and activity keys read the record that
// Omarchy's omarchy-agent-usage-claude collector writes for its agents panel.
// The collector owns the OAuth usage call and the transcript scan, so the deck
// never touches Claude credentials and does not poll the endpoint a second time.
function claudeUsageRecordPath() {
  const stateHome = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local/state');
  return process.env.CLAUDE_USAGE_RECORD || path.join(stateHome, 'omarchy/agents/usage/claude.json');
}

function readClaudeUsageRecord(recordPath = claudeUsageRecordPath()) {
  const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  if (record?.id !== 'claude') throw new Error('not a Claude usage record');
  return record;
}

// The record stores each limit as a used fraction from 0 to 1, or -1 when unknown.
function normalizeClaudeQuota(record, now = Date.now()) {
  const limits = Array.isArray(record?.limits) ? record.limits : [];
  const windows = CLAUDE_QUOTA_WINDOWS.map(({ label, match }) => {
    const limit = limits.find((candidate) => match.test(String(candidate?.label || '')));
    const fraction = limit?.percent;
    if (typeof fraction !== 'number' || !Number.isFinite(fraction) || fraction < 0) return null;
    const resetsAt = Date.parse(limit.resetsAt || '');
    // A window that reset after the record was written starts again from zero.
    const usedPercent = resetsAt <= now ? 0 : Math.round(Math.min(1, fraction) * 100);
    return { label, usedPercent, remainingPercent: 100 - usedPercent, resetsAt: Number.isFinite(resetsAt) ? resetsAt : null };
  }).filter(Boolean);
  if (!windows.length) throw new Error(record?.usageStatusText || 'no limits in record');
  const updatedAt = Date.parse(record.updatedAt || '');
  return { windows, updatedAt: Number.isFinite(updatedAt) ? updatedAt : null };
}

function ageLabel(updatedAt, now = Date.now()) {
  if (!updatedAt) return '?';
  const minutes = Math.max(0, Math.round((now - updatedAt) / 60_000));
  return minutes < 1 ? 'NOW' : durationLabel(minutes);
}

function renderClaudeQuota(record, error, now = Date.now()) {
  let quota;
  try {
    if (record) quota = normalizeClaudeQuota(record, now);
  } catch (quotaError) {
    error = quotaError.message;
  }
  if (!quota) {
    return renderCard({
      accent: error ? COLORS.blocked : COLORS.working,
      title: 'CLAUDE LIMITS',
      main: error ? 'NO DATA' : 'LOADING',
      footer: truncate(error || 'reading usage', 18),
    });
  }
  const stale = Boolean(error) || !quota.updatedAt || now - quota.updatedAt > CLAUDE_STALE_MS;
  const minimum = Math.min(...quota.windows.map((window) => window.remainingPercent));
  const accent = stale ? COLORS.working : minimum <= 20 ? COLORS.blocked : minimum <= 50 ? COLORS.working : COLORS.done;
  return renderCard({
    accent,
    title: stale ? 'CLAUDE STALE' : 'CLAUDE LEFT',
    main: quota.windows.map((window) => `${window.remainingPercent}%`).join(' | '),
    footer: `${quota.windows.map((window) => window.label).join(' | ')} | ${ageLabel(quota.updatedAt, now)}`,
  });
}

// Token totals include cache reads, matching the Omarchy panel.
function summarizeClaudeActivity(record, hours) {
  if (hours <= 24) {
    return {
      title: 'CLAUDE TODAY',
      tokens: Number(record.todayTotalTokens) || 0,
      footer: `${Number(record.todaySessions) || 0} sessions`,
    };
  }
  const days = (Array.isArray(record.recentDays) ? record.recentDays : []).slice(-Math.max(1, Math.round(hours / 24)));
  // recentDays[].messageCount is a token total despite its legacy name.
  const counts = days.map((day) => Number(day?.messageCount) || 0);
  return {
    title: `CLAUDE ${days.length}D`,
    tokens: counts.reduce((sum, count) => sum + count, 0),
    footer: `${counts.filter((count) => count > 0).length} active days`,
  };
}

function renderClaudeActivity(hours, record, error) {
  const title = hours <= 24 ? 'CLAUDE TODAY' : `CLAUDE ${Math.round(hours / 24)}D`;
  if (!record) {
    return renderCard({
      accent: error ? COLORS.blocked : COLORS.working,
      title,
      main: error ? 'NO DATA' : 'LOADING',
      footer: truncate(error || 'local activity', 18),
    });
  }
  const activity = summarizeClaudeActivity(record, hours);
  return renderCard({ accent: COLORS.idle, title: activity.title, main: compactNumber(activity.tokens), footer: activity.footer });
}

// Asks Omarchy to rewrite the Claude record, as its panel's refresh does.
// Resolves either way; a failure only means the deck keeps the old record.
function runClaudeUsageRefresh(args = [], timeoutMs = 60_000) {
  const executable = process.env.OMARCHY_AGENT_USAGE_UPDATE || 'omarchy-agent-usage-update';
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(executable, [...args, 'claude'], { stdio: 'ignore' });
    } catch (error) {
      resolve({ ok: false, error: error.message });
      return;
    }
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, error: error.message });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve(code === 0 ? { ok: true } : { ok: false, error: signal ? 'usage refresh timed out' : `usage refresh exited with ${code}` });
    });
  });
}

function usesClaudeSource(instance) {
  return String(instance?.settings?.source || '').toLowerCase() === 'claude';
}

function requestHerdr(method, params = {}, timeoutMs = 2000) {
  const socketPath = process.env.HERDR_SOCKET || path.join(os.homedir(), '.config/herdr/herdr.sock');
  return new Promise((resolve, reject) => {
    const id = `streamdeck-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const socket = net.createConnection(socketPath);
    let buffer = '';
    let settled = false;
    const timer = setTimeout(() => finish(new Error(`Herdr ${method} timed out`)), timeoutMs);

    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    }

    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${JSON.stringify({ id, method, params })}\n`));
    socket.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let response;
        try {
          response = JSON.parse(line);
        } catch (error) {
          finish(error);
          return;
        }
        if (response.id !== id) continue;
        if (response.error) finish(new Error(response.error.message || JSON.stringify(response.error)));
        else finish(null, response.result);
      }
    });
    socket.on('error', finish);
    socket.on('end', () => finish(new Error('Herdr closed the socket before replying')));
  });
}

// Expands a leading `~/` and resolves a bare name through PATH, then through
// the extra directories. A desktop-started OpenDeck often lacks ~/.local/bin on
// PATH. Returns the configured value unchanged when nothing matches, so spawn
// reports ENOENT for it.
function resolveExecutable(configured, extraCandidates = []) {
  if (configured.includes('/')) return configured.replace(/^~(?=\/)/, os.homedir());
  const candidates = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
    .map((directory) => path.join(directory, configured))
    .concat(extraCandidates);
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {}
  }
  return configured;
}

function resolveCodexExecutable(configured = 'codex') {
  return resolveExecutable(configured, [path.join(os.homedir(), '.local/share/mise/installs/codex/latest/bin/codex')]);
}

function fetchCodexQuota(settings = {}, timeoutMs = 10_000) {
  const executable = resolveCodexExecutable(settings.codexExecutable || 'codex');
  const codexHome = String(settings.codexHome || '~/.codex').replace(/^~(?=\/)/, os.homedir());
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['app-server', '--stdio'], {
      env: { ...process.env, CODEX_HOME: codexHome },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let buffer = '';
    let stderr = '';
    let finishing = false;
    let settled = false;
    let outcome;
    let cleanupTimer;
    const timer = setTimeout(() => finish(new Error('Codex quota request timed out')), timeoutMs);

    function finish(error, value) {
      if (finishing || settled) return;
      finishing = true;
      outcome = { error, value };
      clearTimeout(timer);
      child.stdin.destroy();
      if (child.exitCode === null && child.pid) child.kill('SIGTERM');
      cleanupTimer = setTimeout(() => {
        if (child.exitCode === null && child.pid) child.kill('SIGKILL');
        cleanupTimer = setTimeout(settle, 500);
      }, 500);
      if (child.exitCode !== null || !child.pid) settle();
    }

    function settle() {
      if (settled || !outcome) return;
      settled = true;
      clearTimeout(cleanupTimer);
      if (outcome.error) reject(outcome.error);
      else resolve(outcome.value);
    }

    child.on('error', finish);
    child.stdin.on('error', finish);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4096); });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let response;
        try {
          response = JSON.parse(line);
        } catch (error) {
          finish(error);
          return;
        }
        if (response.id === 0) {
          if (response.error) {
            finish(new Error(response.error.message || 'Codex initialization failed'));
            return;
          }
          child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`);
          child.stdin.write(`${JSON.stringify({ method: 'account/rateLimits/read', id: 2 })}\n`);
        }
        if (response.id === 2) {
          if (response.error) finish(new Error(response.error.message || 'Codex quota request failed'));
          else {
            try {
              finish(null, normalizeQuota(response));
            } catch (error) {
              finish(error);
            }
          }
        }
      }
    });
    child.on('close', (code) => {
      if (finishing) settle();
      else finish(new Error(stderr.trim() || `Codex app-server exited with code ${code}`));
    });
    child.stdin.write(`${JSON.stringify({
      method: 'initialize',
      id: 0,
      params: { clientInfo: { name: 'opendeck_agents', title: 'OpenDeck Agents', version: '1.0.0' } },
    })}\n`);
  });
}

// Run Command keys take everything from their action settings. The command is
// started directly with an argument vector, never through a shell, so no
// quoting, globbing, variable or `~` expansion happens inside arguments.
const COMMAND_STATUS_WORDS = Object.freeze({
  on: 'on', true: 'on', yes: 'on', active: 'on', enabled: 'on', 1: 'on',
  off: 'off', false: 'off', no: 'off', inactive: 'off', disabled: 'off', 0: 'off',
});
const COMMAND_OUTPUT_LIMIT = 4096;

function clampSeconds(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Math.max(minimum, Math.min(maximum, Number.isFinite(number) && number > 0 ? number : fallback)) * 1000;
}

function stringList(value, name) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && !item.includes('\0'))) {
    throw new Error(`${name} must be a list of strings`);
  }
  return [...value];
}

function commandSettings(settings = {}) {
  const command = typeof settings.command === 'string' ? settings.command.trim() : '';
  if (!command || command.includes('\0')) throw new Error('command is not set');
  const statusArgs = settings.statusArgs === undefined || settings.statusArgs === null
    ? null
    : stringList(settings.statusArgs, 'statusArgs');
  const onColor = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(String(settings.onColor || '')) ? settings.onColor : COLORS.done;
  return {
    command,
    args: stringList(settings.args, 'args'),
    statusArgs,
    title: String(settings.title || path.basename(command)).toUpperCase(),
    onText: String(settings.onText || 'ON'),
    offText: String(settings.offText || 'OFF'),
    onColor,
    intervalMs: clampSeconds(settings.intervalSeconds, 5, 1, 3600),
    timeoutMs: clampSeconds(settings.timeoutSeconds, 15, 1, 600),
  };
}

// Resolves with { code, stdout, error } and never rejects. The child gets its
// own process group, so a timeout kills anything it started in the
// foreground as well. Without captureOutput, stdout is discarded and the
// promise settles when the command exits, even if it left a background child
// holding the inherited descriptors.
function runCommand(command, args = [], { timeoutMs = 15_000, captureOutput = false } = {}) {
  return new Promise((resolve) => {
    let child;
    let stdout = '';
    let timedOut = false;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    try {
      child = spawn(resolveExecutable(command, [path.join(os.homedir(), '.local/bin', command)]), args, {
        cwd: os.homedir(),
        detached: true,
        shell: false,
        stdio: ['ignore', captureOutput ? 'pipe' : 'ignore', 'ignore'],
      });
    } catch (error) {
      resolve({ code: -1, stdout: '', error: error.message });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }, timeoutMs);
    if (captureOutput) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        if (stdout.length < COMMAND_OUTPUT_LIMIT) stdout = `${stdout}${chunk}`.slice(0, COMMAND_OUTPUT_LIMIT);
      });
    }
    child.on('error', (error) => finish({ code: -1, stdout, error: error.message }));
    child.on(captureOutput ? 'close' : 'exit', (code, signal) => {
      if (timedOut) finish({ code: -1, stdout, error: 'timed out' });
      else finish({ code: code ?? -1, stdout, ...(signal ? { error: `killed by ${signal}` } : {}) });
    });
  });
}

// A first stdout line such as `on` or `off` wins; otherwise exit status 0
// means on and any other exit status means off.
function interpretCommandStatus(result) {
  if (result.error) return 'error';
  const word = String(result.stdout || '').trim().split('\n')[0].trim().toLowerCase();
  if (Object.hasOwn(COMMAND_STATUS_WORDS, word)) return COMMAND_STATUS_WORDS[word];
  return result.code === 0 ? 'on' : 'off';
}

function renderCommand({ title = 'COMMAND', state = 'idle', onText = 'ON', offText = 'OFF', onColor = COLORS.done } = {}) {
  const looks = {
    idle: { fill: COLORS.panel, ink: COLORS.text, text: COLORS.text, label: 'RUN' },
    pending: { fill: COLORS.working, ink: COLORS.background, text: COLORS.background, label: 'WAIT' },
    on: { fill: onColor, ink: COLORS.text, text: COLORS.text, label: onText },
    off: { fill: COLORS.background, ink: COLORS.offline, text: COLORS.muted, label: offText, slash: true },
    error: { fill: COLORS.background, ink: COLORS.blocked, text: COLORS.blocked, label: 'ERROR' },
  };
  const look = looks[state] || looks.idle;
  const slash = look.slash
    ? `<line x1="16" y1="52" x2="56" y2="20" stroke="${COLORS.muted}" stroke-width="4" stroke-linecap="round"/>`
    : '';
  return `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72">
  <rect width="72" height="72" rx="14" fill="${look.fill}"/>
  <text x="36" y="15" text-anchor="middle" fill="${look.text}" font-family="sans-serif" font-size="9" font-weight="700">${escapeXml(truncate(title, 12))}</text>
  <rect x="16" y="22" width="40" height="28" rx="4" fill="none" stroke="${look.ink}" stroke-width="3"/>
  <path d="M23 30l6 6-6 6" fill="none" stroke="${look.ink}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  <line x1="33" y1="43" x2="45" y2="43" stroke="${look.ink}" stroke-width="3" stroke-linecap="round"/>
  ${slash}
  <text x="36" y="65" text-anchor="middle" fill="${look.text}" font-family="sans-serif" font-size="11" font-weight="800">${escapeXml(truncate(look.label, 10))}</text>
</svg>`).toString('base64')}`;
}

function safeSend(payload) {
  if (deckSocket?.readyState === WebSocket.OPEN) deckSocket.send(JSON.stringify(payload));
}

function setImage(context, image) {
  if (lastImages.get(context) === image) return;
  safeSend({ event: 'setImage', context, payload: { image, target: 0 } });
  lastImages.set(context, image);
}

function showFeedback(event, context) {
  safeSend({ event, context });
}

function renderHerdrContexts() {
  const byId = new Map(latestAgents.map((agent) => [agentIdentity(agent), agent]));
  for (const [context, instance] of contexts) {
    if (instance.action === ACTIONS.pulse) setImage(context, renderPulse(latestAgents, herdrOnline));
    if (instance.action === ACTIONS.session) {
      const slot = Math.max(0, Math.min(9, Number(instance.settings.slot) || 0));
      setImage(context, renderSession(byId.get(slotIds[slot]), herdrOnline));
    }
  }
}

async function refreshHerdr() {
  if (herdrRefreshPending || ![...contexts.values()].some((instance) => instance.action === ACTIONS.pulse || instance.action === ACTIONS.session)) return;
  herdrRefreshPending = true;
  try {
    const result = await requestHerdr('session.snapshot');
    latestAgents = decorateAgents(result.snapshot);
    const reconciled = reconcileAgentSlots(latestAgents);
    slotIds.splice(0, slotIds.length, ...reconciled);
    herdrOnline = true;
  } catch (error) {
    herdrOnline = false;
    console.error('[Agents] Herdr refresh failed:', error.message);
  } finally {
    herdrRefreshPending = false;
    renderHerdrContexts();
  }
}

function renderQuotaContexts(refreshMinutes) {
  const expired = latestQuota && Date.now() - lastQuotaRefresh >= refreshMinutes * 60_000;
  const image = renderQuota(latestQuota, latestQuotaError || (expired ? 'Quota refresh overdue' : undefined), lastQuotaRefresh);
  for (const [context, instance] of contexts) {
    if (instance.action === ACTIONS.quota && !usesClaudeSource(instance)) setImage(context, image);
  }
}

async function refreshQuota(force = false) {
  const quotaContexts = [...contexts.entries()].filter(([, instance]) => instance.action === ACTIONS.quota && !usesClaudeSource(instance));
  if (!quotaContexts.length) return;
  const refreshMinutes = Math.max(1, Math.min(1440, Number(quotaContexts[0][1].settings.refreshMinutes) || 5));
  renderQuotaContexts(refreshMinutes);
  if (quotaRefreshPending) return;
  if (!force && latestQuota && Date.now() - lastQuotaRefresh < refreshMinutes * 60_000) {
    return;
  }
  quotaRefreshPending = true;
  try {
    latestQuota = await fetchCodexQuota(quotaContexts[0][1].settings);
    latestQuotaError = undefined;
    lastQuotaRefresh = Date.now();
  } catch (error) {
    latestQuotaError = error.message;
    console.error('[Agents] Codex quota refresh failed:', error.message);
  } finally {
    quotaRefreshPending = false;
    renderQuotaContexts(refreshMinutes);
  }
}

async function refreshActivity() {
  if (activityRefreshPending) return;
  const activityContexts = [...contexts.entries()].filter(([, instance]) => instance.action === ACTIONS.activity && !usesClaudeSource(instance));
  if (!activityContexts.length) return;
  activityRefreshPending = true;
  try {
    for (const hours of new Set(activityContexts.map(([, instance]) => Number(instance.settings.hours) || 24))) {
      try {
        activityByHours.set(hours, queryActivity(hours));
      } catch (error) {
        activityByHours.set(hours, { error: error.message });
      }
    }
    for (const [context, instance] of activityContexts) {
      const hours = Number(instance.settings.hours) || 24;
      setImage(context, renderActivity(hours, activityByHours.get(hours)));
    }
  } finally {
    activityRefreshPending = false;
  }
}

// The Claude record is a small local file, so it is reread on every tick.
function refreshClaudeUsage() {
  const claudeContexts = [...contexts.entries()].filter(([, instance]) => (
    (instance.action === ACTIONS.quota || instance.action === ACTIONS.activity) && usesClaudeSource(instance)
  ));
  if (!claudeContexts.length) return;
  try {
    latestClaudeRecord = readClaudeUsageRecord();
    latestClaudeRecordError = undefined;
  } catch (error) {
    latestClaudeRecordError = error.code === 'ENOENT' ? 'no usage record' : error.message;
  }
  for (const [context, instance] of claudeContexts) {
    if (instance.action === ACTIONS.quota) setImage(context, renderClaudeQuota(latestClaudeRecord, latestClaudeRecordError));
    else setImage(context, renderClaudeActivity(Number(instance.settings.hours) || 24, latestClaudeRecord, latestClaudeRecordError));
  }
}

async function forceClaudeUsageRefresh(context, limitsOnly) {
  if (claudeRefreshPending) return;
  claudeRefreshPending = true;
  try {
    const result = await runClaudeUsageRefresh(limitsOnly ? ['--limits-only'] : []);
    if (!result.ok) console.error('[Agents] Claude usage refresh failed:', result.error);
    showFeedback(result.ok ? 'showOk' : 'showAlert', context);
  } finally {
    claudeRefreshPending = false;
    refreshClaudeUsage();
  }
}

function renderCommandContext(context) {
  const entry = commandStates.get(context);
  if (!entry || !contexts.has(context)) return;
  if (entry.error) {
    setImage(context, renderCommand({ title: 'COMMAND', state: 'error' }));
    return;
  }
  setImage(context, renderCommand({ ...entry.config, state: entry.pending ? 'pending' : entry.state }));
}

function prepareCommandContext(context, settings) {
  const entry = { state: 'idle', pending: false, polling: false, lastPoll: 0 };
  try {
    entry.config = commandSettings(settings);
    if (entry.config.statusArgs) entry.state = 'off';
  } catch (error) {
    entry.error = error.message;
    console.error('[Agents] Run Command settings invalid:', error.message);
  }
  commandStates.set(context, entry);
  renderCommandContext(context);
  return entry;
}

async function pollCommand(context) {
  const entry = commandStates.get(context);
  if (!entry?.config?.statusArgs || entry.pending || entry.polling) return;
  entry.polling = true;
  entry.lastPoll = Date.now();
  const { command, statusArgs, timeoutMs } = entry.config;
  const result = await runCommand(command, statusArgs, { timeoutMs: Math.min(timeoutMs, 5000), captureOutput: true });
  entry.polling = false;
  // Settings changed or the key went away while the status ran.
  if (commandStates.get(context) !== entry || entry.pending) return;
  entry.state = interpretCommandStatus(result);
  if (result.error) console.error('[Agents] Run Command status failed:', result.error);
  renderCommandContext(context);
}

async function pressCommand(context) {
  const entry = commandStates.get(context);
  if (!entry || entry.error) {
    showFeedback('showAlert', context);
    return;
  }
  if (entry.pending) return;
  entry.pending = true;
  renderCommandContext(context);
  const { command, args, timeoutMs } = entry.config;
  let result;
  try {
    result = await runCommand(command, args, { timeoutMs });
  } finally {
    entry.pending = false;
  }
  const ok = result.code === 0 && !result.error;
  if (!ok) console.error('[Agents] Run Command failed:', result.error || `exit status ${result.code}`);
  showFeedback(ok ? 'showOk' : 'showAlert', context);
  if (commandStates.get(context) !== entry) return;
  if (entry.config.statusArgs) {
    while (entry.polling) await new Promise((resolve) => setTimeout(resolve, 20));
    await pollCommand(context);
  } else {
    renderCommandContext(context);
  }
}

function refreshCommands(now = Date.now()) {
  for (const [context, entry] of commandStates) {
    if (entry.config?.statusArgs && now - entry.lastPoll >= entry.config.intervalMs) void pollCommand(context);
  }
}

async function focusAgent(context, agent) {
  if (!agent?.pane_id) {
    showFeedback('showAlert', context);
    return;
  }
  try {
    await requestHerdr('agent.focus', { target: agent.pane_id });
    showFeedback('showOk', context);
    await refreshHerdr();
  } catch (error) {
    console.error('[Agents] Focus failed:', error.message);
    showFeedback('showAlert', context);
  }
}

async function handleMessage(raw) {
  let message;
  try {
    message = JSON.parse(String(raw));
  } catch (error) {
    console.error('[Agents] Invalid OpenDeck message:', error.message);
    return;
  }
  const { event, action, context } = message;
  if (event === 'willAppear' || event === 'didReceiveSettings') {
    contexts.set(context, { action, settings: message.payload?.settings || {} });
    lastImages.delete(context);
    if (action === ACTIONS.pulse || action === ACTIONS.session) await refreshHerdr();
    const instance = contexts.get(context);
    if ((action === ACTIONS.quota || action === ACTIONS.activity) && usesClaudeSource(instance)) refreshClaudeUsage();
    else if (action === ACTIONS.quota) await refreshQuota();
    else if (action === ACTIONS.activity) await refreshActivity();
    if (action === ACTIONS.command && prepareCommandContext(context, instance.settings).config?.statusArgs) await pollCommand(context);
    return;
  }
  if (event === 'willDisappear') {
    contexts.delete(context);
    lastImages.delete(context);
    commandStates.delete(context);
    return;
  }
  if (event !== 'keyDown') return;
  const instance = contexts.get(context) || { action, settings: message.payload?.settings || {} };
  if (instance.action === ACTIONS.pulse) await focusAgent(context, highestPriorityAgent(latestAgents));
  if (instance.action === ACTIONS.session) {
    const slot = Math.max(0, Math.min(9, Number(instance.settings.slot) || 0));
    const targetId = slotIds[slot];
    await focusAgent(context, latestAgents.find((agent) => agentIdentity(agent) === targetId));
  }
  const claude = usesClaudeSource(instance);
  if (instance.action === ACTIONS.quota) await (claude ? forceClaudeUsageRefresh(context, true) : refreshQuota(true));
  if (instance.action === ACTIONS.activity) await (claude ? forceClaudeUsageRefresh(context, false) : refreshActivity());
  if (instance.action === ACTIONS.command) {
    if (!commandStates.has(context)) prepareCommandContext(context, instance.settings);
    await pressCommand(context);
  }
}

function startPlugin() {
  const { port, pluginUUID, registerEvent } = parseArgs();
  if (!port || !pluginUUID || !registerEvent) {
    console.error('[Agents] Missing OpenDeck startup arguments');
    process.exitCode = 1;
    return;
  }
  deckSocket = new WebSocket(`ws://127.0.0.1:${port}`);
  deckSocket.addEventListener('open', () => safeSend({ event: registerEvent, uuid: pluginUUID }));
  deckSocket.addEventListener('message', (event) => { void handleMessage(event.data); });
  deckSocket.addEventListener('error', (event) => console.error('[Agents] OpenDeck connection failed:', event.message || 'WebSocket error'));
  setInterval(() => { void refreshHerdr(); }, 2000);
  setInterval(() => { void refreshActivity(); }, 60_000);
  setInterval(() => {
    void refreshQuota();
    refreshClaudeUsage();
  }, 30_000);
  setInterval(refreshCommands, 1000);
}

if (require.main === module) startPlugin();

module.exports = {
  ACTIONS,
  agentIdentity,
  compactNumber,
  decorateAgents,
  commandSettings,
  durationLabel,
  fetchCodexQuota,
  highestPriorityAgent,
  interpretCommandStatus,
  normalizeClaudeQuota,
  normalizeQuota,
  parseArgs,
  queryActivity,
  readClaudeUsageRecord,
  reconcileAgentSlots,
  requestHerdr,
  renderActivity,
  renderCard,
  renderClaudeActivity,
  renderClaudeQuota,
  renderCommand,
  renderPulse,
  renderQuota,
  renderSession,
  resolveExecutable,
  runClaudeUsageRefresh,
  runCommand,
  statusPriority,
  summarizeClaudeActivity,
};
