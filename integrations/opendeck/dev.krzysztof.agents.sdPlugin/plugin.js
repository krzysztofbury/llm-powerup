'use strict';

const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const ACTIONS = Object.freeze({
  pulse: 'dev.krzysztof.agents.pulse',
  session: 'dev.krzysztof.agents.session',
  quota: 'dev.krzysztof.agents.quota',
  activity: 'dev.krzysztof.agents.activity',
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

function resolveCodexExecutable(configured = 'codex') {
  if (configured.includes('/')) return configured.replace(/^~(?=\/)/, os.homedir());
  for (const directory of (process.env.PATH || '').split(path.delimiter)) {
    const candidate = path.join(directory, configured);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {}
  }
  const miseCandidate = path.join(os.homedir(), '.local/share/mise/installs/codex/latest/bin/codex');
  return fs.existsSync(miseCandidate) ? miseCandidate : configured;
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
    if (instance.action === ACTIONS.quota) setImage(context, image);
  }
}

async function refreshQuota(force = false) {
  const quotaContexts = [...contexts.entries()].filter(([, instance]) => instance.action === ACTIONS.quota);
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
  const activityContexts = [...contexts.entries()].filter(([, instance]) => instance.action === ACTIONS.activity);
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
    if (action === ACTIONS.quota) await refreshQuota();
    if (action === ACTIONS.activity) await refreshActivity();
    return;
  }
  if (event === 'willDisappear') {
    contexts.delete(context);
    lastImages.delete(context);
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
  if (instance.action === ACTIONS.quota) await refreshQuota(true);
  if (instance.action === ACTIONS.activity) await refreshActivity();
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
  setInterval(() => { void refreshQuota(); }, 30_000);
}

if (require.main === module) startPlugin();

module.exports = {
  ACTIONS,
  agentIdentity,
  compactNumber,
  decorateAgents,
  durationLabel,
  fetchCodexQuota,
  highestPriorityAgent,
  normalizeQuota,
  parseArgs,
  queryActivity,
  reconcileAgentSlots,
  requestHerdr,
  renderActivity,
  renderCard,
  renderPulse,
  renderQuota,
  renderSession,
  statusPriority,
};
