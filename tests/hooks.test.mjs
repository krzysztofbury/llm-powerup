import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hooks = existsSync(resolve(root, 'claude/hooks')) ? resolve(root, 'claude/hooks') : resolve(root, 'integrations/claude/hooks');
function decision(hook, command, payload = {}, env = {}) {
  // These commands are input strings only; they are never executed.
  const result = spawnSync('/bin/bash', [resolve(hooks, hook + '.sh')], {
    input: JSON.stringify({ ...payload, tool_input: { command } }), encoding: 'utf8',
    env: { ...process.env, CLAUDE_HOOK_DISPOSABLE_ROOTS: '', CLAUDE_HOOK_POSTGRES_DEV_TARGETS: '/nonexistent', ...env },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim() ? JSON.parse(result.stdout).hookSpecificOutput.permissionDecision : undefined;
}
const cases = [
  ['confirm-external-impact', 'gcloud compute instances delete list', 'ask'],
  ['confirm-external-impact', 'gcloud projects delete list', 'ask'],
  ['block-dangerous', 'git reset --hard', 'ask'],
  ['block-dangerous', 'git -C /tmp/example reset --hard', 'ask'],
  ['block-dangerous', 'git --git-dir=/tmp/example clean -fd', 'ask'],
  ['block-dangerous', 'git -c advice.detachedHead=false push --force', 'ask'],
  ['block-dangerous', 'git -C /tmp/example status', undefined],
  ['block-dangerous', 'rm -rf /tmp/example', 'ask'],
  ['block-dangerous', 'find /tmp/example -delete', 'ask'],
  ['block-dangerous', 'kubectl --context example delete pod example', 'ask'],
  ['guard-readonly-postgres', 'psql -c "SELECT 1"', undefined],
  ['guard-readonly-postgres', 'psql -c "EXPLAIN SELECT 1"', undefined],
  ['guard-readonly-postgres', 'psql -c "EXPLAIN ANALYZE SELECT 1"', 'ask'],
  ['guard-readonly-postgres', 'psql -c "EXPLAIN (ANALYZE TRUE) SELECT 1"', 'ask'],
  ['guard-readonly-postgres', 'psql -c "EXPLAIN (BUFFERS, ANALYZE) SELECT 1"', 'ask'],
  ['guard-readonly-postgres', 'psql -c "EXPLAIN (ANALYZE OFF) SELECT 1"', 'ask'],
  ['guard-readonly-postgres', 'psql -c "SELECT 1" -c "DELETE FROM example"', 'ask'],
  ['guard-readonly-postgres', 'psql -c "SELECT nextval(\'example\')"', 'ask'],
  ['guard-readonly-postgres', 'cat example.sql | psql', 'ask'],
  ['guard-readonly-postgres', 'psql --file example.sql', 'ask'],
  ['guard-readonly-postgres', 'PGPASSWORD=example psql -c "SELECT 1"', 'ask'],
  ['confirm-external-impact', 'kubectl --context example apply -f example.yaml', 'ask'],
  ['confirm-external-impact', 'terraform -chdir=/tmp/example apply', 'ask'],
  ['confirm-external-impact', 'git -C /tmp/example push', 'ask'],
  ['confirm-external-impact', 'gh --repo owner/example pr merge 1', 'ask'],
  ['confirm-external-impact', 'aws sts get-caller-identity', undefined],
  ['confirm-external-impact', 'aws --profile example ec2 describe-instances', undefined],
  ['confirm-external-impact', 'aws s3api delete-bucket --bucket example', 'ask'],
  ['confirm-external-impact', 'aws sts get-caller-identity && aws s3api delete-bucket --bucket example', 'ask'],
  // Each aws invocation is inspected on its own, so a later read-only or
  // unrelated command no longer forces review.
  ['confirm-external-impact', 'aws sts get-caller-identity; echo example', undefined],
  ['confirm-external-impact', 'gcloud compute instances list', undefined],
  ['confirm-external-impact', 'gcloud compute instances delete example', 'ask'],
  ['confirm-external-impact', 'kubectl --context example get pods', undefined],

  // Flag values containing hyphens must not hide the subcommand.
  ['block-dangerous', 'git -C my-repo reset --hard', 'ask'],
  ['block-dangerous', 'git -C my-repo push --force origin main', 'ask'],
  ['block-dangerous', 'kubectl --context prod-eu delete ns payments', 'ask'],
  ['confirm-external-impact', 'kubectl --context prod-eu apply -f example.yaml', 'ask'],
  ['confirm-external-impact', 'helm --kube-context prod-eu uninstall api', 'ask'],
  ['confirm-external-impact', 'git -C my-repo push origin main', 'ask'],

  // Tool names only count where a command runs, not inside arguments.
  ['block-dangerous', 'grep -rn "DELETE FROM " src && echo psql', undefined],
  ['block-dangerous', 'git commit -m "git reset --hard is bad"', undefined],
  ['guard-readonly-postgres', 'rg psql README.md', undefined],
  ['confirm-external-impact', 'ls ~/.netlify', undefined],
  ['confirm-external-impact', "rg 'make deploy' docs", undefined],
  ['confirm-external-impact', 'make deploy', 'ask'],
  ['confirm-external-impact', 'make -C infra deploy-prod', 'ask'],
  ['confirm-external-impact', 'flyctl deploy', 'ask'],
  ['confirm-external-impact', 'aws --version', undefined],
  ['confirm-external-impact', 'aws s3 ls', undefined],
  ['confirm-external-impact', 'aws s3 rm s3://example/key', 'ask'],
  ['confirm-external-impact', 'aws-vault exec example -- aws s3 rm s3://example/key', 'ask'],
  ['confirm-external-impact', 'npm publish', 'ask'],
  ['confirm-external-impact', 'gh pr create --fill', 'ask'],

  // Removal that cannot be resolved still asks.
  ['block-dangerous', 'rm -rf "$tmp"', 'ask'],
  ['block-dangerous', 'rm -rf $(cat list)', 'ask'],
  ['block-dangerous', 'echo "$(rm -rf /example)"', 'ask'],
  ['block-dangerous', 'ls | xargs rm', 'ask'],
  ['block-dangerous', 'find . -name __pycache__ -exec rm -rf {} +', 'ask'],
  ['block-dangerous', "trap 'rm -rf \"$tmp\"' EXIT", undefined],
  ['block-dangerous', "cat > notes.sh <<'EOF'\nrm -rf /\nEOF", undefined],
  ['block-dangerous', "psql <<'SQL'\nDELETE FROM example;\nSQL", 'ask'],
  ['block-dangerous', 'docker rm -f example-db', undefined],
  ['block-dangerous', 'docker rm -fv example-db', 'ask'],
  ['block-dangerous', 'DOCKER_HOST=ssh://example docker rm -f api', 'ask'],
  ['block-dangerous', 'docker volume rm example-data', 'ask'],
  ['block-dangerous', 'sqlite3 /var/lib/example.db "DELETE FROM t"', 'ask'],
  ['block-dangerous', 'sqlite3 :memory: "CREATE TABLE t (id int)"', undefined],

  ['guard-readonly-postgres', 'psql --version', undefined],
  ['guard-readonly-postgres', 'psql -h localhost -l', undefined],
  ['guard-readonly-postgres', 'psql -c "select count(*) from example"', undefined],
  ['guard-readonly-postgres', 'psql -c "select 1; drop table example"', 'ask'],
  ['guard-readonly-postgres', "psql -c '\\dt'", undefined],
  ['guard-readonly-postgres', 'psql -c "\\d+ users"', undefined],
  ['guard-readonly-postgres', "psql -c '\\! rm -rf /'", 'ask'],
  ['guard-readonly-postgres', 'psql -c "SELECT $value"', 'ask'],
  ['guard-readonly-postgres', "docker exec db psql -U postgres -c 'DELETE FROM example'", 'ask'],
  ['guard-readonly-postgres', 'psql "postgresql://user:secret@db/example" -c "SELECT 1"', 'ask'],
];
for (const [hook, command, expected] of cases) {
  test(hook + ': ' + command, () => assert.equal(decision(hook, command), expected));
}
for (const hook of ['block-dangerous', 'guard-readonly-postgres', 'confirm-external-impact']) {
  test(hook + ': malformed input requests review', () => {
    const result = spawnSync('/bin/bash', [resolve(hooks, hook + '.sh')], {input:'not-json', encoding:'utf8'});
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, 'ask');
  });
}

// Context-aware decisions need a real work tree, a session directory, and a
// remote with a default branch.
function git(cwd, ...args) {
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd, stdio: 'ignore' });
}
function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'hooks-fixture-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repo = join(base, 'repo');
  const remote = join(base, 'remote.git');
  const temp = join(base, 'tmp');
  const session = join(temp, 'claude-' + process.getuid(), 'project', 'session-1');
  const scratch = join(session, 'scratchpad');
  mkdirSync(scratch, { recursive: true });
  for (const directory of ['dist', 'node_modules/pkg', 'src/__pycache__', 'build']) mkdirSync(join(repo, directory), { recursive: true });
  writeFileSync(join(repo, '.gitignore'), 'dist/\nnode_modules/\n__pycache__/\n*.pyc\n.env\nbuild/\n');
  writeFileSync(join(repo, 'build/keep.txt'), 'tracked\n');
  writeFileSync(join(repo, 'README.md'), 'fixture\n');
  git(base, 'init', '-q', '--bare', '-b', 'main', remote);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'add', '.gitignore', 'README.md');
  git(repo, 'add', '-f', 'build/keep.txt');
  git(repo, 'commit', '-q', '-m', 'fixture');
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'push', '-q', 'origin', 'main');
  git(repo, 'remote', 'set-head', 'origin', 'main');
  git(repo, 'switch', '-q', '-c', 'feature/example');
  const targets = join(base, 'postgres-dev-targets');
  writeFileSync(targets, '# host[:port]/dbname\nlocalhost:5433/app_dev\n');
  const run = (hook, command, { cwd = repo, env = {} } = {}) =>
    decision(hook, command, { cwd, session_id: 'session-1' }, { TMPDIR: temp, CLAUDE_HOOK_POSTGRES_DEV_TARGETS: targets, ...env });
  return { base, repo, session, scratch, run };
}

test('rm and find -delete pass inside the session directory only', t => {
  const { base, session, scratch, run } = fixture(t);
  assert.equal(run('block-dangerous', `rm -rf ${scratch}/build ${scratch}/*.log`), undefined);
  assert.equal(run('block-dangerous', `find ${scratch} -name '*.tmp' -delete`), undefined);
  assert.equal(run('block-dangerous', `rm -rf ${session}`), 'ask');
  assert.equal(run('block-dangerous', `rm -rf ${scratch}/../../other-session`), 'ask');
  assert.equal(run('block-dangerous', `rm -rf ${scratch}/.*`), 'ask');
  assert.equal(run('block-dangerous', `rm -rf ${base}/repo`), 'ask');
  assert.equal(run('block-dangerous', `sudo rm -rf ${scratch}/build`), 'ask');
});

test('configured disposable roots are honored but shared roots are not', t => {
  const { base, run } = fixture(t);
  mkdirSync(join(base, 'sandbox'));
  assert.equal(run('block-dangerous', `rm -rf ${base}/sandbox/out`, { env: { CLAUDE_HOOK_DISPOSABLE_ROOTS: join(base, 'sandbox') } }), undefined);
  assert.equal(run('block-dangerous', 'rm -rf /tmp/example', { env: { CLAUDE_HOOK_DISPOSABLE_ROOTS: '/tmp' } }), 'ask');
});

test('ignored build output in the work tree can be removed', t => {
  const { repo, run } = fixture(t);
  assert.equal(run('block-dangerous', 'rm -rf dist node_modules'), undefined);
  assert.equal(run('block-dangerous', 'rm -f src/__pycache__/*.pyc'), undefined);
  assert.equal(run('block-dangerous', "find . -name '*.pyc' -delete"), undefined);
  assert.equal(run('block-dangerous', "find . -name '*.log' -delete"), 'ask');
  // build/ is ignored but holds a tracked file.
  assert.equal(run('block-dangerous', 'rm -rf build'), 'ask');
  assert.equal(run('block-dangerous', 'rm -rf src'), 'ask');
  assert.equal(run('block-dangerous', 'rm -f .env'), 'ask');
  assert.equal(run('block-dangerous', 'cd /tmp && rm -rf dist'), 'ask');
  assert.equal(run('block-dangerous', `docker exec app rm -rf ${repo}/dist`), 'ask');
  assert.equal(decision('block-dangerous', 'rm -rf dist'), 'ask');
});

test('sqlite3 on a work tree or session file is not gated', t => {
  const { scratch, run } = fixture(t);
  assert.equal(run('block-dangerous', `sqlite3 ${scratch}/test.db 'CREATE TABLE t (id int); INSERT INTO t VALUES (1)'`), undefined);
  assert.equal(run('block-dangerous', "sqlite3 local.db 'DELETE FROM t'"), undefined);
  assert.equal(run('block-dangerous', "sqlite3 /var/lib/example.db 'DELETE FROM t'"), 'ask');
});

test('git push passes for feature branches and asks for protected or forced pushes', t => {
  const { repo, run } = fixture(t);
  for (const command of ['git push', 'git push -u origin feature/example', 'git push origin HEAD', `git -C ${repo} push origin feature/example`]) {
    assert.equal(run('confirm-external-impact', command), undefined, command);
  }
  for (const command of [
    'git push origin main', 'git push origin feature/example:main', 'git push origin HEAD:refs/heads/master',
    'git push --force-with-lease origin feature/example', 'git push origin +feature/example',
    'git push origin --delete feature/example', 'git push origin :feature/example', 'git push --tags',
    'git push --mirror', 'cd /tmp && git push', 'git push origin "$branch"',
  ]) {
    assert.equal(run('confirm-external-impact', command), 'ask', command);
  }
  git(repo, 'switch', '-q', 'main');
  assert.equal(run('confirm-external-impact', 'git push'), 'ask');
  git(repo, 'config', 'push.default', 'matching');
  assert.equal(run('confirm-external-impact', 'git push origin feature/example'), 'ask');
});

test('allowlisted development databases may be changed', t => {
  const { run } = fixture(t);
  for (const command of [
    "psql -h localhost -p 5433 -d app_dev -c 'TRUNCATE example'",
    "psql postgresql://localhost:5433/app_dev -c 'DROP TABLE example'",
    "PGHOST=localhost PGPORT=5433 psql -d app_dev -c 'DELETE FROM example'",
    "psql 'host=localhost port=5433 dbname=app_dev' -f migrate.sql",
  ]) {
    assert.equal(run('guard-readonly-postgres', command), undefined, command);
    assert.equal(run('block-dangerous', command), undefined, command);
  }
  for (const command of [
    "psql -h localhost -d app_dev -c 'TRUNCATE example'",
    "psql -d app_dev -c 'TRUNCATE example'",
    "psql -h localhost -p 5433 -d app_prod -c 'TRUNCATE example'",
    "docker exec db psql -h localhost -p 5433 -d app_dev -c 'TRUNCATE example'",
  ]) {
    assert.equal(run('guard-readonly-postgres', command), 'ask', command);
  }
});

test('a missing helper fails closed', t => {
  const { base } = fixture(t);
  const copy = join(base, 'block-dangerous.sh');
  execFileSync('cp', [resolve(hooks, 'block-dangerous.sh'), copy]);
  const result = spawnSync('/bin/bash', [copy], { input: JSON.stringify({ tool_input: { command: 'ls' } }), encoding: 'utf8' });
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, 'ask');
});

test('large heredocs are scanned quickly', () => {
  const body = 'echo "line with $(date) and some text"\n'.repeat(500);
  const started = Date.now();
  assert.equal(decision('block-dangerous', `cat > big.sh <<'EOF'\n${body}EOF`), undefined);
  assert.ok(Date.now() - started < 3000, 'block-dangerous took ' + (Date.now() - started) + 'ms');
});
