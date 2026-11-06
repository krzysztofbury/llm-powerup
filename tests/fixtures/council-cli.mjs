#!/usr/bin/env node
import { basename } from 'node:path';
import { writeFileSync } from 'node:fs';
const member = basename(process.argv[1]);
const args = process.argv.slice(2);
let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;
writeFileSync(process.env.COUNCIL_TEST_TRACE + '.' + member, JSON.stringify({
  member, args, prompt, cwd: process.cwd(),
  configDir: process.env.OPENCODE_CONFIG_DIR,
  config: process.env.OPENCODE_CONFIG_CONTENT,
}));
if (process.env.COUNCIL_TEST_FAIL === member) process.exit(1);
const answer = 'Independent test opinion from ' + member;
if (member === 'claude') console.log(JSON.stringify({
  type: 'result', result: answer, modelUsage: { 'resolved-test-claude': {} },
}));
if (member === 'codex') console.log(JSON.stringify({
  type: 'item.completed', item: { type: 'agent_message', text: answer },
}));
if (member === 'opencode') console.log(JSON.stringify({
  type: 'text', part: { text: answer },
}));
