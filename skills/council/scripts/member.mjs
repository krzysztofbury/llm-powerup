import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Provider credentials remain available; project instructions, tools and MCP do not.
// This is harness isolation, not a general-purpose OS security boundary.
export function invocation(member, model, effort, cwd, parentEnv = process.env) {
  if (!model || model.startsWith('-')) throw new Error('An explicit model is required');
  const env = { ...parentEnv };
  env.TMPDIR = cwd;
  env.TMP = cwd;
  env.TEMP = cwd;
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.CLAUDECODE;
  const deny = { action: '*', resource: '*', effect: 'deny' };
  switch (member) {
    case 'claude':
      return { command: 'claude', env, args: [
        '-p', '--safe-mode', '--tools', '', '--strict-mcp-config',
        '--mcp-config', '{"mcpServers":{}}', '--setting-sources', '',
        '--disable-slash-commands', '--no-session-persistence', '--no-chrome',
        '--permission-prompts', 'none', '--output-format', 'json',
        '--model', model, ...(effort ? ['--effort', effort] : []),
      ] };
    case 'codex': {
      const disabled = ['shell_tool', 'unified_exec', 'multi_agent', 'apps',
        'plugins', 'hooks', 'view_image', 'browser_use', 'computer_use',
        'image_generation', 'memories', 'skill_search', 'code_mode_host'];
      return { command: 'codex', env, args: [
        'exec', '-s', 'read-only', '--ignore-user-config', '--ignore-rules',
        '--strict-config', '--ephemeral', '--skip-git-repo-check', '--json',
        '-c', 'web_search="disabled"', '-c', 'project_doc_max_bytes=0',
        ...disabled.flatMap(key => ['-c', `features.${key}=false`]),
        '-c', 'features.skip_host_skill_discovery=true',
        ...(effort ? ['-c', `model_reasoning_effort="${effort}"`] : []),
        '-m', model, '-',
      ] };
    }
    case 'opencode': {
      if (!model.includes('/')) throw new Error('OpenCode requires provider/model');
      if (effort) throw new Error('Use provider/model#variant for OpenCode effort');
      // OpenCode v2 uses CONFIG_DIR as the global configuration root.
      // Keep the normal data directory for auth, but isolate all configuration.
      for (const key of Object.keys(env)) {
        if (key.startsWith('OPENCODE_CONFIG') || key === 'OPENCODE_CLI_CONFIG_CONTENT' || key === 'OPENCODE_DISABLE_PROJECT_CONFIG') delete env[key];
      }
      env.OPENCODE_CONFIG_DIR = join(cwd, 'config');
      // V2 documents DISABLE_PROJECT_CONFIG; 2.0.21 also has the older name.
      // Set both and verify effective discovery with the model-free diagnostic.
      env.OPENCODE_DISABLE_PROJECT_CONFIG = '1';
      env.OPENCODE_CONFIG_PROJECT_DISABLE = 'true';
      env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
        $schema: 'https://opencode.ai/config.json',
        model: model.split('#')[0],
        update: 'disable', snapshots: false,
        plugins: ['opencode.*', '-opencode.browser', '-opencode.websearch.*',
          '-opencode.tool.*', '-opencode.tools', '-opencode.tools.*',
          '-opencode.config.instruction', '-opencode.config.skill', '-opencode.skill',
          '-opencode.warming', '-opencode.wellknown'], skills: [],
        mcp: { servers: {} },
        agents: { council: { model, mode: 'primary', steps: 1,
          system: 'Answer the self-contained problem. Do not use tools or delegate.',
          permissions: [deny] } },
      });
      return { command: 'opencode', env, args: [
        'run', '--standalone', '--agent', 'council', '--format', 'json', '--model', model,
      ] };
    }
    default:
      throw new Error(`${member}: no isolated adapter; use claude, codex or opencode`);
  }
}

export function extract(member, stdout) {
  const events = [];
  for (const line of stdout.split('\n').filter(Boolean)) {
    try { events.push(JSON.parse(line)); } catch { /* not a JSON event */ }
  }
  if (member === 'claude') {
    const result = events.findLast(event => event.type === 'result');
    if (result?.is_error) throw new Error('Claude returned an error result');
    return { text: result?.result || '', resolvedModels: Object.keys(result?.modelUsage || {}) };
  }
  if (events.some(event => event.type === 'error' || event.type === 'turn.failed')) {
    throw new Error('Member returned an error event');
  }
  const models = new Set();
  const texts = [];
  for (const event of events) {
    if (typeof event.model === 'string') models.add(event.model);
    if (event.info?.modelID) models.add(`${event.info.providerID || 'unknown'}/${event.info.modelID}`);
    if (member === 'codex' && event.type === 'item.completed' && event.item?.type === 'agent_message') texts.push(event.item.text);
    if (member === 'opencode' && event.type === 'text' && typeof event.part?.text === 'string') texts.push(event.part.text);
  }
  return { text: texts.join('\n\n'), resolvedModels: [...models] };
}

export const limits = { raw: 8 * 1024 * 1024, stderr: 65536, opinion: 65536, prompt: 1024 * 1024 };

// All supported CLIs run in a new POSIX process group. Kill that group even
// when its leader exits first, so inherited pipes and helpers cannot outlive it.
// This does not contain a malicious process that deliberately calls setsid().
export function runProcess(spec, { cwd, prompt = '', timeout, signal }) {
  if (process.platform === 'win32') throw new Error('Council requires POSIX process groups');
  return new Promise((resolveResult, reject) => {
    if (signal?.aborted) { reject(new Error('Cancelled')); return; }
    const child = spawn(spec.command, spec.args, { cwd, env: spec.env,
      detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [], stderr = [];
    let bytes = 0, errBytes = 0, reason = '', spawnError;
    const kill = () => {
      if (!child.pid) return;
      try { process.kill(-child.pid, 'SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') child.kill('SIGKILL'); }
    };
    const stop = value => { reason ||= value; kill(); };
    const abort = () => stop('Cancelled');
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => stop('Member timed out'), timeout * 1000);
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > limits.raw) { stop('Output limit exceeded'); return; }
      stdout.push(chunk);
    });
    child.stderr.on('data', chunk => {
      bytes += chunk.length;
      errBytes += chunk.length;
      if (bytes > limits.raw || errBytes > limits.stderr) { stop('Output limit exceeded'); return; }
      stderr.push(chunk);
    });
    child.on('error', error => { spawnError = error; });
    child.on('exit', kill);
    child.on('close', code => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (spawnError) { reject(spawnError); return; }
      resolveResult({ code, reason, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
  });
}

export async function runMember({ member, model, effort = '', prompt, timeout, signal }) {
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 86400) throw new Error('Invalid timeout');
  if (effort && !['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(effort)) throw new Error('Invalid effort');
  if (Buffer.byteLength(prompt) > limits.prompt) throw new Error('Prompt limit exceeded');
  const cwd = mkdtempSync(join(tmpdir(), 'council-member-'));
  const metadata = { member, requestedModel: model, requestedEffort: effort || null,
    resolvedModels: [], modelVerified: false, isolation: 'self-contained', status: 'failed' };
  let stderr = '';
  try {
    mkdirSync(join(cwd, 'config'), { mode: 0o700 });
    const spec = invocation(member, model, effort, cwd);
    if (member === 'opencode') {
      writeFileSync(join(cwd, 'config', 'opencode.json'), spec.env.OPENCODE_CONFIG_CONTENT, { mode: 0o600 });
    }
    const outcome = await runProcess(spec, { cwd, prompt, timeout, signal });
    stderr = outcome.stderr;
    if (outcome.reason || outcome.code !== 0) throw new Error(outcome.reason || `Member exited ${outcome.code}`);
    const result = extract(member, outcome.stdout);
    if (!result.text.trim()) throw new Error('No usable opinion in member output');
    if (Buffer.byteLength(result.text + '\n') > limits.opinion) throw new Error('Opinion limit exceeded');
    Object.assign(metadata, { resolvedModels: result.resolvedModels,
      modelVerified: result.resolvedModels.length > 0, status: 'ok' });
    return { metadata, text: result.text + '\n', stderr };
  } catch (error) {
    metadata.error = error.message;
    if (signal?.aborted) metadata.status = 'cancelled';
    return { metadata, text: '', stderr };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

async function main() {
  const [member, model, effort, promptPath, metadataPath, timeoutString] = process.argv.slice(2);
  const controller = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, () => controller.abort());
  const result = await runMember({ member, model, effort, prompt: readFileSync(promptPath, 'utf8'),
    timeout: Number(timeoutString), signal: controller.signal });
  writeFileSync(metadataPath, JSON.stringify(result.metadata, null, 2) + '\n', { mode: 0o600 });
  process.stderr.write(result.stderr);
  process.stdout.write(result.text);
  if (result.metadata.status !== 'ok') { process.stderr.write(result.metadata.error + '\n'); process.exitCode = 1; }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}
