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
  assert.equal(run('block-dangerous', "find . -name '*.pyc' -delete"), 'ask');
  assert.equal(run('block-dangerous', "find . -name '*.log' -delete"), 'ask');
  // build/ is ignored but holds a tracked file.
  assert.equal(run('block-dangerous', 'rm -rf build'), 'ask');
  assert.equal(run('block-dangerous', 'rm -rf src'), 'ask');
  assert.equal(run('block-dangerous', 'rm -f .env'), 'ask');
  assert.equal(run('block-dangerous', 'cd /tmp && rm -rf dist'), 'ask');
  assert.equal(run('block-dangerous', `docker exec app rm -rf ${repo}/dist`), 'ask');
  assert.equal(decision('block-dangerous', 'rm -rf dist'), 'ask');
});

test('artifact-like find matches never establish ownership', t => {
  const { repo, run } = fixture(t);
  writeFileSync(join(repo, 'tracked.pyc'), 'source fixture\n');
  git(repo, 'add', '-f', 'tracked.pyc');
  assert.equal(run('block-dangerous', "find . -name '*.pyc' -delete"), 'ask');
  assert.equal(run('block-dangerous', 'find . -name build -delete'), 'ask');
  assert.equal(run('block-dangerous', 'find . -name __pycache__ -delete'), 'ask');
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
    'git -c remote.origin.push=HEAD:main push origin',
    'git -c push.default=matching push',
    'git -c remote.origin.mirror=true push origin',
    'git --config-env=remote.origin.push=PUSH_SPEC push origin',
  ]) {
    assert.equal(run('confirm-external-impact', command), 'ask', command);
  }
  git(repo, 'switch', '-q', 'main');
  assert.equal(run('confirm-external-impact', 'git push'), 'ask');
  git(repo, 'config', 'push.default', 'matching');
  assert.equal(run('confirm-external-impact', 'git push origin feature/example'), 'ask');
});

test('a leading cd to an existing directory sets the working directory', t => {
  const { base, repo, scratch, run } = fixture(t);
  const elsewhere = { cwd: base };
  for (const command of [`cd ${repo} && git push -u origin feature/example`, `cd ${repo}; git push origin HEAD`]) {
    assert.equal(run('confirm-external-impact', command, elsewhere), undefined, command);
  }
  assert.equal(run('confirm-external-impact', 'cd .. && git push origin feature/example', { cwd: join(repo, 'src') }), undefined);
  assert.equal(run('confirm-external-impact', 'cd ~/repo && git push origin feature/example', { cwd: base, env: { HOME: base } }), undefined);
  assert.equal(run('confirm-external-impact', 'cd ~other/repo && git push origin feature/example', { cwd: base, env: { HOME: base } }), 'ask');
  assert.equal(run('block-dangerous', `cd ${scratch} && rm -rf build out.log`), undefined);
  assert.equal(run('block-dangerous', `cd ${scratch}/missing && rm -rf build`), 'ask');
  for (const command of [
    `cd ${repo} && git push origin main`,
    `(cd ${repo}); git push origin feature/example`,
    `true || cd ${repo}; git push origin feature/example`,
    `echo start && cd ${repo} && git push origin feature/example`,
    `cd ${repo} || exit; git push origin feature/example`,
    `cd ${repo} | cat; git push origin feature/example`,
    `cd ${repo} && cd ${base} && git push origin feature/example`,
    `cd "$HOME" && git push origin feature/example`,
    'cd - && git push origin feature/example',
  ]) {
    assert.equal(run('confirm-external-impact', command, elsewhere), 'ask', command);
  }
  assert.equal(run('confirm-external-impact', `cd ${repo} && git fetch -q | cat; git push origin feature/example`, elsewhere), undefined);
  assert.equal(run('confirm-external-impact', `cd ${repo} && . ./env.sh && git push origin feature/example`, elsewhere), 'ask');
  assert.equal(run('confirm-external-impact', `HOME=/ cd ~/repo && git push origin feature/example`, { cwd: base, env: { HOME: base } }), 'ask');
  // A substitution in the cd itself runs before the cd, in the old directory.
  assert.equal(run('block-dangerous', `cd ${scratch} 2>"$(rm -rf build)"`), 'ask');
  for (const command of [`cd ${scratch} | true; rm -rf build`, `cd ${base} && rm -rf repo`, `(cd ${scratch}) && rm -rf dist`, `cd ${scratch} & rm -rf build`]) {
    assert.equal(run('block-dangerous', command), 'ask', command);
  }
});

test('rm resolves variables assigned from mktemp or a disposable literal', t => {
  const { scratch, run } = fixture(t);
  for (const command of [
    'S=$(mktemp -d) && rm -rf "$S"',
    'S="$(mktemp -d)"; echo work; rm -rf "$S"',
    'S=$(mktemp -d -p /tmp example.XXXXXX) && touch "$S/a" && rm -rf "$S/a" "${S}"',
    `S=${scratch}/run; mkdir -p "$S"; rm -rf "$S" $S/out`,
    'S=$(mktemp -d)\necho "$(cat <<<x\necho y)"\nrm -rf "$S"',
    // ${S:?} stops the command when S is empty, so a suffix cannot become /suffix.
    'S=$(mktemp -d); rm -rf "${S:?}" "${S:?}/data"',
    // A pipeline or a tracked cd before the rm does not hide the assignment.
    'S=$(mktemp -d) && echo "$S" | cat; rm -rf "${S:?}"',
    `cd ${scratch} && S=$(mktemp -d) && ls "$S" | cat; rm -rf "\${S:?}/a"`,
  ]) {
    assert.equal(run('block-dangerous', command), undefined, command);
  }
  for (const command of [
    'rm -rf "$UNKNOWN"',
    'S=/etc; rm -rf "$S"',
    'S=$(mktemp -d); S=/etc; rm -rf "$S"',
    'S=$(mktemp -d); export S=/etc; rm -rf "$S"',
    'S=$(mktemp -d); read -r S; rm -rf "$S"',
    'S=$(mktemp -d); for S in /etc; do rm -rf "$S"; done',
    'S=$(mktemp -d); eval S=/etc; rm -rf "$S"',
    'S=$(mktemp -d); S[0]=/etc; rm -rf "$S"',
    'S=$(mktemp -u); rm -rf "$S"',
    'S=$(mktemp -d); rm -rf "$S/.."',
    'S=$(mktemp -d); rm -rf "$S/x"',
    'S=$(mktemp -d) /bin/true; rm -rf "$S"',
    'false && S=$(mktemp -d); rm -rf "$S"',
    'S=$(mktemp -d) || S=/etc; rm -rf "$S"',
    '(S=$(mktemp -d)); rm -rf "$S"',
    'S=$(mktemp -d) && rm -rf "$S"/*',
    'S=$(mktemp -d) && rm -rf "$S$T"',
    `S="${scratch}/a b"; rm -rf $S`,
    'S=$(mktemp -d); rm -rf "${S:-/etc}"',
    'S=$(mktemp -d); rm -rf ${S:?}/*',
    // Builtins can rebind a variable without naming it as a word.
    'S=$(mktemp -d); declare -n R=S; R=/etc; rm -rf "$S"',
    'S=$(mktemp -d); eval "$X"; rm -rf "$S"',
    'S=$(mktemp -d); . ./env.sh; rm -rf "$S"',
    'S=$(mktemp -d); N=S; printf -v "$N" /etc; rm -rf "$S"',
    // Unquoted expansions are split on IFS.
    'S=$(mktemp -d); rm -rf $S',
    `S=${scratch}/run; IFS=/; rm -rf $S/out`,
    'S=$(mktemp --dry -d); rm -rf "$S"',
    'echo "$(rm -rf "$S")"; S=$(mktemp -d)',
    `if false\nthen\nS=${scratch}/x\nfi\nrm -rf "$S/y"`,
    'echo | S=$(mktemp -d) && rm -rf "$S/a"',
    'S=$(mktemp -d) & rm -rf "$S"',
    'true && S=$(mktemp -d); rm -rf "$S/a"',
  ]) {
    assert.equal(run('block-dangerous', command), 'ask', command);
  }
});

test('a here-document inside a command substitution is skipped as text', t => {
  const { run } = fixture(t);
  const body = "--body \"$(cat <<'EOF'\nIt doesn't parse (yet); see `notes`.\nEOF\n)\"";
  assert.equal(run('confirm-external-impact', `gh issue create --title example ${body}`), undefined);
  assert.equal(run('block-dangerous', `git commit -q -m example ${body}`), undefined);
  // An unquoted delimiter still expands substitutions in the body.
  assert.equal(run('block-dangerous', 'echo "$(cat <<EOF\n$(rm -rf /)\nEOF\n)"'), 'ask');
  assert.equal(run('confirm-external-impact', `gh pr create --title example ${body}`), 'ask');
});

test('auto mode defers only the opted-in confirmations to the classifier', t => {
  const { repo } = fixture(t);
  const defer = { CLAUDE_HOOK_AUTO_DEFER: 'pr-create,pr-merge,push-protected', TMPDIR: '/nonexistent' };
  const run = (command, mode, env) => decision('confirm-external-impact', command, { cwd: repo, session_id: 'session-1', permission_mode: mode }, env);
  for (const command of ['gh pr create --title example --body example', 'gh pr merge 1 --merge', 'git push origin main', 'git push origin feature/example:main']) {
    assert.equal(run(command, 'auto', defer), undefined, command);
    assert.equal(run(command, 'default', defer), 'ask', command);
    assert.equal(run(command, 'auto', {}), 'ask', command);
  }
  for (const command of ['gh release create v1', 'git push --force origin main', 'git push origin --delete feature/example', 'git push --tags', 'git push origin "$branch"']) {
    assert.equal(run(command, 'auto', defer), 'ask', command);
  }
  assert.equal(run('gh pr merge 1', 'auto', { CLAUDE_HOOK_AUTO_DEFER: 'pr-create' }), 'ask');
  assert.equal(run('gh pr merge 1 --subject "gh pr create"', 'auto', { CLAUDE_HOOK_AUTO_DEFER: 'pr-create' }), 'ask');
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

test('libpq routing overrides cannot inherit a development exemption', t => {
  const { run } = fixture(t);
  for (const command of [
    "psql 'postgresql://localhost:5433/app_dev?host=prod' -c 'DELETE FROM example'",
    "psql 'postgresql://localhost:5433/app_dev?hostaddr=192.0.2.1' -c 'DELETE FROM example'",
    "PGHOSTADDR=192.0.2.1 psql -h localhost -p 5433 -d app_dev -c 'DELETE FROM example'",
    "psql 'hostaddr=192.0.2.1 host=localhost port=5433 dbname=app_dev' -c 'DELETE FROM example'",
    "psql 'postgresql://prod/app_prod' -h localhost -p 5433 -d app_dev -c 'DELETE FROM example'",
    "psql -h localhost -p 5433 -d 'host=prod dbname=app_dev' -c 'DELETE FROM example'",
    "sudo psql -h localhost -p 5433 -d app_dev -c 'DELETE FROM example'",
  ]) {
    for (const hook of ['guard-readonly-postgres', 'block-dangerous']) {
      assert.equal(run(hook, command), 'ask', `${hook}: ${command}`);
    }
  }
  for (const env of [{ PGHOSTADDR: '192.0.2.1' }, { PGSERVICE: 'production' }, { PGSERVICEFILE: '/example' }]) {
    assert.equal(run('guard-readonly-postgres', "psql -h localhost -p 5433 -d app_dev -c 'DELETE FROM example'", { env }), 'ask');
  }
});

test('inline credentials are checked before the development exemption', t => {
  const { run } = fixture(t);
  for (const command of [
    "PGPASSWORD=example psql -h localhost -p 5433 -d app_dev -c 'SELECT 1'",
    "psql postgresql://user:example@localhost:5433/app_dev -c 'SELECT 1'",
    "psql 'host=localhost port=5433 dbname=app_dev password=example' -c 'SELECT 1'",
  ]) assert.equal(run('guard-readonly-postgres', command), 'ask', command);
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
