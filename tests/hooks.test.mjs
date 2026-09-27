import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hooks = existsSync(resolve(root, 'claude/hooks')) ? resolve(root, 'claude/hooks') : resolve(root, 'integrations/claude/hooks');
function decision(hook, command) {
  // These commands are input strings only; they are never executed.
  const result = spawnSync('/bin/bash', [resolve(hooks, hook + '.sh')], {
    input: JSON.stringify({ tool_input: { command } }), encoding: 'utf8',
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
  ['confirm-external-impact', 'aws sts get-caller-identity; echo example', 'ask'],
  ['confirm-external-impact', 'gcloud compute instances list', undefined],
  ['confirm-external-impact', 'gcloud compute instances delete example', 'ask'],
  ['confirm-external-impact', 'kubectl --context example get pods', undefined],
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
