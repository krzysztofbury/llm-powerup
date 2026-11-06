import { existsSync, lstatSync, readFileSync, copyFileSync, writeFileSync, renameSync, unlinkSync, chmodSync, constants } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function mergeHooks(current, template) {
  if (!current || typeof current !== 'object' || Array.isArray(current)) throw new Error('Invalid settings');
  const result = structuredClone(current);
  result.hooks ??= {};
  if (typeof result.hooks !== 'object' || Array.isArray(result.hooks)) throw new Error('Invalid hooks table');
  for (const [event, groups] of Object.entries(template.hooks)) {
    result.hooks[event] ??= [];
    if (!Array.isArray(result.hooks[event])) throw new Error('Invalid hook event');
    for (const group of groups) {
      const matching = result.hooks[event].filter(existing => existing.matcher === group.matcher);
      for (const hook of group.hooks) {
        const filename = hook.command.match(/\/([^/]+\.sh)/)?.[1];
        const existingHooks = matching.flatMap(existing => existing.hooks || []);
        const found = existingHooks.find(existing => existing.command === hook.command);
        if (!found && filename && existingHooks.some(existing => existing.command?.includes('/' + filename))) {
          throw new Error('Conflicting hook command; review its owner before merging');
        }
        if (found) {
          if (found.type !== hook.type) throw new Error('Conflicting hook type');
          // Keep existing timeout/status choices; never replace unrelated settings.
          continue;
        }
        const destination = matching[0];
        if (destination) destination.hooks.push(structuredClone(hook));
        else {
          const addition = { matcher: group.matcher, hooks: [structuredClone(hook)] };
          result.hooks[event].push(addition);
          matching.push(addition);
        }
      }
    }
  }
  return result;
}

function main() {
  const [source, target] = process.argv.slice(2);
  if (!source || !target) throw new Error('Usage: node claude/install-hooks.mjs TEMPLATE SETTINGS');
  let stat;
  try { stat = lstatSync(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (stat?.isSymbolicLink()) throw new Error('Refusing a settings symlink; review its owner');
  const original = existsSync(target) ? readFileSync(target, 'utf8') : '{}\n';
  const merged = mergeHooks(JSON.parse(original), JSON.parse(readFileSync(source, 'utf8')));
  if (JSON.stringify(JSON.parse(original)) === JSON.stringify(merged)) {
    console.log('Claude hook settings already match');
    return;
  }
  const temporary = target + '.' + process.pid + '.tmp';
  try {
    writeFileSync(temporary, JSON.stringify(merged, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    if (existsSync(target)) {
      const backup = target + '.backup.' + new Date().toISOString().replace(/[:.]/g, '-');
      copyFileSync(target, backup, constants.COPYFILE_EXCL);
      chmodSync(backup, 0o600);
      console.log('Settings backup: ' + backup);
    }
    renameSync(temporary, target);
    console.log('Missing Claude hooks merged; restart Claude Code to reload them');
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
