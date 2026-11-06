import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { invocation } from '../skills/council/scripts/member.mjs';

const root = mkdtempSync(join(tmpdir(), 'council-opencode-check-'));
const cwd = join(root, 'workspace');
let child;
let cancelled = false;
const stop = () => {
  cancelled = true;
  if (child?.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ } }
};
for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM']) process.once(signal, stop);
try {
  mkdirSync(cwd, { mode: 0o700 });
  // A harmless ancestor sentinel makes a no-inheritance result meaningful.
  writeFileSync(join(root, 'opencode.json'), JSON.stringify({ agents: {
    'council-inheritance-sentinel': { system: 'Local configuration test only' },
  } }), { mode: 0o600 });
  mkdirSync(join(cwd, 'config'), { mode: 0o700 });
  const spec = invocation('opencode', 'openai/council-fixture', '', cwd);
  const mode = process.argv[2] || 'both';
  if (!['both', 'documented', 'compatibility', 'control'].includes(mode)) throw new Error('Expected both, documented, compatibility or control');
  if (mode === 'documented' || mode === 'control') delete spec.env.OPENCODE_CONFIG_PROJECT_DISABLE;
  if (mode === 'compatibility' || mode === 'control') delete spec.env.OPENCODE_DISABLE_PROJECT_CONFIG;
  const fixture = JSON.parse(spec.env.OPENCODE_CONFIG_CONTENT);
  fixture.providers = { openai: { models: { 'council-fixture': {
    modelID: 'council-fixture', name: 'Configuration test only', limit: { context: 1000, output: 100 },
  } } } };
  spec.env.OPENCODE_CONFIG_CONTENT = JSON.stringify(fixture);
  writeFileSync(join(cwd, 'config', 'opencode.json'), spec.env.OPENCODE_CONFIG_CONTENT, { mode: 0o600 });
  spec.env.OPENCODE_DISABLE_MODELS_FETCH = 'true';
  const password = randomBytes(24).toString('hex');
  spec.env.OPENCODE_SERVER_PASSWORD = password;
  child = spawn('opencode', ['serve', '--stdio', '--hostname', '127.0.0.1', '--port', '0'], {
    cwd, env: spec.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stderr.resume(); // Never print auth, provider or configuration payloads.
  const url = await new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('Private server startup timed out')), 10000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', () => { clearTimeout(timer); reject(new Error('Private server exited before ready')); });
    child.stdout.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 65536) { clearTimeout(timer); reject(new Error('Startup output exceeded limit')); stop(); return; }
      for (const line of buffer.split('\n')) {
        try {
          const info = JSON.parse(line);
          if (info.url) { clearTimeout(timer); resolve(info.url); return; }
        } catch { /* await a complete JSON line */ }
      }
    });
  });
  async function get(path) {
    const response = await fetch(url + path, {
      headers: { Authorization: 'Basic ' + Buffer.from('opencode:' + password).toString('base64') },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Private server diagnostic HTTP ' + response.status);
    return response.json();
  }
  let agents, agent;
  const deadline = Date.now() + 5000;
  do {
    agents = await get('/api/agent');
    agent = agents.data?.find(item => item.id === 'council' || item.name === 'council');
    if (!agent) await new Promise(resolve => setTimeout(resolve, 100));
  } while (!agent && Date.now() < deadline);
  const config = await get('/api/config');
  const inherited = agents.data?.some(item => (item.id || item.name) === 'council-inheritance-sentinel');
  if (inherited !== (mode === 'control')) throw new Error(mode === 'control' ? 'Control did not discover the ancestor sentinel' : 'Ancestor sentinel inherited');
  if (!agent || !agent.permissions.some(rule => rule.action === '*' && rule.resource === '*' && rule.effect === 'deny')) {
    throw new Error('Isolated deny-all council agent was not loaded');
  }
  const paths = config.flatMap(entry => entry.path ? [entry.path] : []);
  if (paths.some(path => !path.startsWith(cwd) && !(mode === 'control' && path === join(root, 'opencode.json')))) throw new Error('Inherited configuration source detected');
  const mcp = await get('/api/mcp');
  if (Array.isArray(mcp.data) ? mcp.data.length : Object.keys(mcp.data || {}).length) {
    throw new Error('Inherited MCP server detected');
  }
  const plugins = await get('/api/plugin');
  if (plugins.data?.some(plugin => !(plugin.id || '').startsWith('opencode.'))) {
    throw new Error('Non-built-in plugin detected');
  }
  if (plugins.data?.some(plugin => /^opencode\.(tool\.|tools($|\.)|browser$|websearch\.|config\.instruction$|config\.skill$|skill$|warming$|wellknown$)/.test(plugin.id))) {
    throw new Error('Tool or context-discovery plugin remained enabled');
  }
  if (cancelled) throw new Error('Diagnostic cancelled');
  console.log(mode === 'control'
    ? 'Native private OpenCode control: ancestor sentinel discovered with both isolation variables absent; no model called'
    : `Native private OpenCode server (${mode}): council loaded, deny-all permissions, ancestor sentinel excluded, no inherited config or MCP, only built-in plugins; no model called`);
} finally {
  if (child?.pid) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ }
    await new Promise((resolve, reject) => {
      if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
      const timer = setTimeout(() => reject(new Error('Server did not stop; retained diagnostic scratch: ' + root)), 5000);
      child.once('close', () => { clearTimeout(timer); resolve(); });
    });
  }
  rmSync(root, { recursive: true, force: true });
  for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM']) process.removeListener(signal, stop);
}
