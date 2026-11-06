#!/usr/bin/env node
import { copyFileSync, existsSync, lstatSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const [sourcePath, targetPath] = process.argv.slice(2);
if (!sourcePath || !targetPath) throw new Error('Usage: node codex/install-hooks.mjs SOURCE TARGET');
let targetStat;
try { targetStat = lstatSync(targetPath); } catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (targetStat?.isSymbolicLink()) {
  throw new Error(`Conflict: ${targetPath} is a symlink; review its owner before merging hooks.`);
}
const addition = JSON.parse(readFileSync(sourcePath, 'utf8'));
const existing = existsSync(targetPath) ? JSON.parse(readFileSync(targetPath, 'utf8')) : { hooks: {} };
if (!existing || typeof existing !== 'object' || Array.isArray(existing)) throw new Error('Invalid hooks config.');
existing.hooks ??= {};
if (!existing.hooks || typeof existing.hooks !== 'object' || Array.isArray(existing.hooks)) throw new Error('Invalid hooks table.');
let changed = false;
for (const [event, groups] of Object.entries(addition.hooks)) {
  existing.hooks[event] ??= [];
  if (!Array.isArray(existing.hooks[event])) throw new Error(`Invalid hook event ${event}.`);
  for (const group of groups) {
    const command = group.hooks[0].command;
    const matches = existing.hooks[event].filter((candidate) =>
      candidate.hooks?.some((hook) => hook.command === command));
    if (matches.length) {
      if (matches.length !== 1 || matches[0].matcher !== group.matcher ||
          !isDeepStrictEqual(matches[0].hooks.find((hook) => hook.command === command), group.hooks[0])) {
        throw new Error(`Conflict: existing ${event} lint hook differs; it was not replaced.`);
      }
      continue;
    }
    existing.hooks[event].push(group);
    changed = true;
  }
}
if (changed) {
  const suffix = `${Date.now()}-${process.pid}`;
  if (existsSync(targetPath)) {
    const backupPath = `${targetPath}.backup-${suffix}`;
    copyFileSync(targetPath, backupPath);
    console.log(`Codex hooks backup: ${backupPath}`);
  }
  const temporaryPath = resolve(`${targetPath}.tmp-${suffix}`);
  writeFileSync(temporaryPath, `${JSON.stringify(existing, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  renameSync(temporaryPath, targetPath);
  console.log('Codex lint hook merged. Restart Codex and review the new hook with /hooks.');
} else {
  console.log('Codex lint hook already configured.');
}
