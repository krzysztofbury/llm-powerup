#!/usr/bin/env node
import { readFileSync, realpathSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Reuse the imported lint-only policy without copying public-owned code.
const repositoryRoot = resolve(dirname(realpathSync(fileURLToPath(import.meta.url))), '../..');

export function patchPaths(patch) {
  const paths = new Set();
  let current;
  for (const line of patch.split('\n')) {
    const header = line.match(/^\*\*\* (Add|Update|Delete) File: (.+)$/);
    if (header) {
      if (current) paths.add(current);
      current = header[1] === 'Delete' ? undefined : header[2];
    } else if (line.startsWith('*** Move to: ')) {
      current = line.slice('*** Move to: '.length);
    }
  }
  if (current) paths.add(current);
  return [...paths];
}

function main() {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const patch = input.tool_input?.command;
  if (typeof patch !== 'string') return;
  const paths = patchPaths(patch);
  const findings = [];
  const deadline = Date.now() + 45000;
  for (const path of paths.slice(0, 64)) {
    if (Date.now() >= deadline) {
      findings.push('Lint time limit reached; run the project lint command for the remaining files.');
      break;
    }
    const filePath = resolve(input.cwd || process.cwd(), path);
    if (!existsSync(filePath)) continue;
    const result = spawnSync('bash', [resolve(repositoryRoot, 'claude/hooks/auto-lint.sh')], {
      input: JSON.stringify({ tool_input: { file_path: filePath } }),
      encoding: 'utf8', timeout: 10000, maxBuffer: 256 * 1024,
    });
    if (result.error || result.status !== 0 || result.stderr) {
      findings.push(`${path}: ${result.error?.message || result.stderr || `linter exited ${result.status}`}`);
    }
  }
  if (paths.length > 64) findings.push('Lint limited to 64 edited files; run the project lint command for the full batch.');
  if (findings.length) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: {
      hookEventName: 'PostToolUse', additionalContext: findings.join('\n').slice(0, 12000),
    } }));
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch {
    process.stderr.write('auto-lint: could not inspect the hook input.\n');
    process.exitCode = 1;
  }
}
