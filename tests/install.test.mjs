import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const installer = join(repository, 'scripts/install.sh');

function workspace(t) {
  const directory = mkdtempSync(join(tmpdir(), 'skills-install-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function skill(root, name, body = 'Test skill.') {
  mkdirSync(join(root, name), { recursive: true });
  writeFileSync(join(root, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${body}\n---\n\n${body}\n`);
}

function run(home, ...args) {
  return spawnSync('/bin/bash', [installer, ...args], {
    env: { ...process.env, HOME: home, CODEX_HOME: join(home, '.codex'), XDG_CACHE_HOME: join(home, '.cache') },
    encoding: 'utf8',
    timeout: 30000,
  });
}

test('default sources link every skill of this repository for every harness directory', (t) => {
  const home = workspace(t);
  const result = run(home, '--claude', '--agents');
  assert.equal(result.status, 0, result.stderr);
  for (const directory of ['.claude/skills', '.agents/skills']) {
    assert.equal(readlinkSync(join(home, directory, 'retro')), join(repository, 'skills/retro'));
  }
  assert.equal(run(home, '--claude', '--agents').stdout.includes('Linked'), false, 'second run must be a no-op');
});

test('a sources file combines repositories and refuses name clashes before changing anything', (t) => {
  const home = workspace(t);
  const privateSkills = join(home, 'private/skills');
  skill(privateSkills, 'diary');
  const sources = join(home, 'private/sources.json');
  writeFileSync(sources, JSON.stringify([{ source: 'self' }, { path: './skills' }]));
  assert.equal(run(home, '--agents', '--sources', sources).status, 0);
  assert.equal(readlinkSync(join(home, '.agents/skills/diary')), join(privateSkills, 'diary'));
  assert.ok(existsSync(join(home, '.agents/skills/retro')));

  skill(privateSkills, 'retro', 'A private retro.');
  rmSync(join(home, '.agents/skills/diary'));
  const clash = run(home, '--agents', '--sources', sources);
  assert.equal(clash.status, 1);
  assert.match(clash.stderr, /Skill name clash: retro/);
  assert.equal(existsSync(join(home, '.agents/skills/diary')), false, 'nothing is linked when sources clash');

  writeFileSync(sources, JSON.stringify([{ source: 'self' }, { path: './skills', rename: { retro: 'private-retro' } }]));
  assert.equal(run(home, '--agents', '--sources', sources).status, 0);
  assert.equal(readlinkSync(join(home, '.agents/skills/private-retro')), join(privateSkills, 'retro'));
});

test('links into a source that no longer provides a skill are pruned, foreign links are kept', (t) => {
  const home = workspace(t);
  const privateSkills = join(home, 'private/skills');
  skill(privateSkills, 'diary');
  skill(privateSkills, 'journal');
  const sources = join(home, 'private/sources.json');
  writeFileSync(sources, JSON.stringify([{ path: './skills' }]));
  assert.equal(run(home, '--agents', '--sources', sources).status, 0);

  const foreign = join(home, 'elsewhere/omarchy');
  mkdirSync(foreign, { recursive: true });
  symlinkSync(foreign, join(home, '.agents/skills/omarchy'));
  symlinkSync(join(home, 'gone/tool'), join(home, '.agents/skills/dangling-foreign'));
  rmSync(join(privateSkills, 'journal'), { recursive: true });

  const result = run(home, '--agents', '--sources', sources);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Pruned .*journal/);
  assert.equal(existsSync(join(home, '.agents/skills/journal')), false);
  assert.equal(readlinkSync(join(home, '.agents/skills/omarchy')), foreign);
  assert.equal(lstatSync(join(home, '.agents/skills/dangling-foreign')).isSymbolicLink(), true);
});

test('a prune root retires links left behind by a moved repository', (t) => {
  const home = workspace(t);
  const old = join(home, 'old-repo');
  mkdirSync(join(home, '.agents/skills'), { recursive: true });
  symlinkSync(join(old, 'skills/retro'), join(home, '.agents/skills/retro'));
  symlinkSync(join(old, 'skills/removed'), join(home, '.agents/skills/removed'));
  const result = run(home, '--agents', '--prune-root', old);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readlinkSync(join(home, '.agents/skills/retro')), join(repository, 'skills/retro'));
  assert.equal(existsSync(join(home, '.agents/skills/removed')), false);
  assert.equal(lstatSync(join(home, '.agents/skills/removed'), { throwIfNoEntry: false }), undefined);
});

test('unmanaged files and directories are never replaced', (t) => {
  const home = workspace(t);
  mkdirSync(join(home, '.agents/skills/retro'), { recursive: true });
  writeFileSync(join(home, '.agents/skills/retro/SKILL.md'), 'local');
  const result = run(home, '--agents');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Conflict: .*retro already exists/);
  assert.equal(readFileSync(join(home, '.agents/skills/retro/SKILL.md'), 'utf8'), 'local');
});

test('rules are generated from the base and an overlay, and hand-written files are kept', (t) => {
  const home = workspace(t);
  const overlay = join(home, 'personal.md');
  writeFileSync(overlay, '## Personal\n\n- Prefer short answers.\n');
  assert.equal(run(home, '--agents', '--rules-overlay', overlay).status, 0);
  const generated = readFileSync(join(home, '.config/opencode/AGENTS.md'), 'utf8');
  assert.match(generated, /^<!-- Generated by the skills installer/);
  assert.ok(generated.includes(readFileSync(join(repository, 'rules/AGENTS.md'), 'utf8').trim()));
  assert.ok(generated.trimEnd().endsWith('- Prefer short answers.'));
  assert.equal(readFileSync(join(home, '.codex/AGENTS.md'), 'utf8'), generated);

  writeFileSync(join(home, '.codex/AGENTS.md'), 'my own rules\n');
  const result = run(home, '--agents', '--rules-overlay', overlay);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /was not generated by this installer/);
  assert.equal(readFileSync(join(home, '.codex/AGENTS.md'), 'utf8'), 'my own rules\n');
});

test('rules replace a link into a pruned repository but not a foreign link', (t) => {
  const home = workspace(t);
  const old = join(home, 'old-repo');
  mkdirSync(old, { recursive: true });
  writeFileSync(join(old, 'AGENTS.md'), 'old rules');
  mkdirSync(join(home, '.claude'), { recursive: true });
  symlinkSync(join(old, 'AGENTS.md'), join(home, '.claude/CLAUDE.md'));
  assert.equal(run(home, '--claude', '--prune-root', old).status, 0);
  assert.equal(lstatSync(join(home, '.claude/CLAUDE.md')).isSymbolicLink(), false);

  const other = join(home, 'other-rules.md');
  writeFileSync(other, 'other');
  rmSync(join(home, '.claude/CLAUDE.md'));
  symlinkSync(other, join(home, '.claude/CLAUDE.md'));
  const result = run(home, '--claude');
  assert.equal(result.status, 1);
  assert.equal(readlinkSync(join(home, '.claude/CLAUDE.md')), other);
});

test('a git source is fetched at its pinned commit and only the listed skills are linked', (t) => {
  const home = workspace(t);
  const upstream = join(home, 'upstream');
  skill(join(upstream, 'skills'), 'animate');
  skill(join(upstream, 'skills'), 'unwanted');
  const git = (...args) => {
    const result = spawnSync('git', ['-C', upstream, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '--quiet');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '--quiet', '-m', 'init');
  git('config', 'uploadpack.allowReachableSHA1InWant', 'true');
  const commit = git('rev-parse', 'HEAD');
  const sources = join(home, 'sources.json');
  writeFileSync(sources, JSON.stringify([{ git: `file://${upstream}`, commit, skills: ['animate'] }]));
  const result = run(home, '--agents', '--sources', sources);
  assert.equal(result.status, 0, result.stderr);
  const target = readlinkSync(join(home, '.agents/skills/animate'));
  assert.ok(target.startsWith(join(home, '.cache/agent-skills')), target);
  assert.equal(existsSync(join(home, '.agents/skills/unwanted')), false);

  writeFileSync(sources, JSON.stringify([{ git: `file://${upstream}`, commit: 'main' }]));
  const unpinned = run(home, '--agents', '--sources', sources);
  assert.equal(unpinned.status, 1);
  assert.match(unpinned.stderr, /full 40-character SHA/);
});
