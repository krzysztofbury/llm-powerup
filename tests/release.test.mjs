import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function nextVersion(bump, tags) {
  const result = spawnSync('bash', [join(repository, 'scripts/next-version.sh'), bump], { input: tags.join('\n'), encoding: 'utf8' });
  return { status: result.status, out: result.stdout.trim() };
}

function notes(version, changelog) {
  const directory = mkdtempSync(join(tmpdir(), 'skills-release-test-'));
  try {
    writeFileSync(join(directory, 'CHANGELOG.md'), changelog);
    const result = spawnSync('bash', [join(repository, 'scripts/release-notes.sh'), version, join(directory, 'CHANGELOG.md')], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('the first release is v1.0.0 whatever the bump', () => {
  for (const bump of ['major', 'minor', 'patch']) assert.equal(nextVersion(bump, []).out, 'v1.0.0');
  assert.equal(nextVersion('patch', ['not-a-tag', 'v2.0.0-rc1']).out, 'v1.0.0');
});

test('bumps follow semantic versioning from the highest release tag', () => {
  const tags = ['v1.0.0', 'v1.2.3', 'v1.10.0', 'v0.9.9'];
  assert.equal(nextVersion('patch', tags).out, 'v1.10.1');
  assert.equal(nextVersion('minor', tags).out, 'v1.11.0');
  assert.equal(nextVersion('major', tags).out, 'v2.0.0');
});

test('an unknown bump is refused', () => {
  assert.equal(nextVersion('medium', ['v1.0.0']).status, 2);
});

test('release notes are the changelog section of that version only', () => {
  const changelog = '# Changelog\n\nIntro.\n\n## [1.1.0] - 2026-11-07\n\n### Added\n\n- New skill.\n\n## [1.0.0] - 2026-11-06\n\n- First.\n\n## Earlier changes\n\n- Old.\n';
  assert.equal(notes('v1.1.0', changelog), '### Added\n\n- New skill.\n');
  assert.equal(notes('1.0.0', changelog), '- First.\n');
  assert.equal(notes('v9.9.9', changelog), '');
});

test('the repository changelog has notes for its newest version', () => {
  const result = spawnSync('bash', ['-c', `grep -m1 -oE '^## \\[[0-9]+\\.[0-9]+\\.[0-9]+\\]' CHANGELOG.md`], { cwd: repository, encoding: 'utf8' });
  const version = result.stdout.trim().replace(/^## \[|\]$/g, '');
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.ok(notes(version, readChangelog()).length > 0);
});

function readChangelog() {
  return spawnSync('cat', [join(repository, 'CHANGELOG.md')], { encoding: 'utf8' }).stdout;
}
