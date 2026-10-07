#!/usr/bin/env node
import { basename } from 'node:path';
import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const member = basename(process.argv[1]);
const mode = process.env.FIXTURE_MODE || 'ok';
let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;
const trace = process.env.FIXTURE_TRACE;
writeFileSync(trace + '.' + member, JSON.stringify({ pid: process.pid, cwd: process.cwd(), prompt,
  args: process.argv.slice(2), config: process.env.OPENCODE_CONFIG_CONTENT }));
if (['hang', 'leader-exits'].includes(mode)) {
  process.on('SIGTERM', () => {});
  spawn(process.execPath, ['-e', `
    const fs = require('node:fs');
    process.on('SIGTERM', () => {});
    fs.writeFileSync(process.env.FIXTURE_TRACE + '.helper.' + process.env.FIXTURE_MEMBER, String(process.pid));
    setInterval(() => {}, 100);
  `], { env: { ...process.env, FIXTURE_MEMBER: member }, stdio: 'inherit' });
  if (mode === 'leader-exits') setTimeout(() => process.exit(0), 200);
  else setInterval(() => {}, 100);
} else if (mode === 'stdout' || mode === 'stderr') {
  const stream = mode === 'stdout' ? process.stdout : process.stderr;
  function flood() { while (stream.write('x'.repeat(16384))) {} stream.once('drain', flood); }
  flood();
} else {
  if (process.env.FIXTURE_FAIL === member) { console.log('Partial response must not count'); process.exit(1); }
  const text = mode === 'opinion' ? 'x'.repeat(70000) : 'Independent fixture opinion';
  if (member === 'claude') console.log(JSON.stringify({ type: 'result', result: text, modelUsage: { 'actual-fixture': {} } }));
  if (member === 'codex') console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } }));
  if (member === 'opencode') console.log(JSON.stringify({ type: 'text', part: { text }, info: { providerID: 'fixture', modelID: 'actual' } }));
}
