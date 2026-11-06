---
name: test-audit
description: Use when designing, adding, changing, reviewing, or auditing Python or SQL tests. Checks whether tests protect real behavior without duplicating stronger proof or requiring test-only production code.
---

# Test Audit - Python and SQL

Use the same evidence bar when writing a test and when deciding whether an
existing test should stay. Prefer confidence in behavior over test count or
deletion count. This skill adapts ideas from
[OpenClaw's test-audit](https://github.com/openclaw/openclaw/blob/main/.agents/skills/test-audit/SKILL.md);
see [the upstream MIT license](LICENSE.upstream).

## Start at the owning boundary

Read the repository and scoped agent instructions (`AGENTS.md`, or the
harness equivalent such as `CLAUDE.md`), the complete relevant
test, the production path it exercises, and overlapping tests. Identify the
entry point, callers, downstream dependencies, and the CI command that runs it.
For a dependency-backed claim, check the installed dependency's behavior or
documentation instead of assuming what a mock means.

For SQL, identify the database engine, schema version, transaction boundaries,
and whether the proof needs a real disposable database. Never run an audit's
DDL, DML, or performance probe against production merely to validate a test.

## Authoring gate

Before adding or changing a test, answer:

1. What externally observable result, invariant, or independent contract does
   it protect? Examples: a CLI response, a persisted row, a query result, or
   the schema after a migration.
2. What plausible change would make it fail for the intended reason? For a bug
   regression, show the failure before the fix when practical, then show it
   passing after the fix.
3. Which existing test owns that contract? Add a case to its parameter table or
   fixture instead of repeating the same behavior at every layer. A second
   layer needs a distinct risk, such as serialization, transaction rollback, or
   the wire protocol.
4. Does the test need an export, flag, wrapper, injection hook, or SQL function
   used only by tests? If so, first seek a real production boundary. Keep a
   seam when production callers genuinely need it.

Do not add a test only to raise coverage or to mirror the implementation.
Keep the project's policy for small, reversible changes: not every edit needs a
new test. A test that fails under a behavior-preserving refactor is a warning
that it may be checking structure rather than the contract.

## Low-value patterns to challenge

- An assertion-free smoke test, a self-comparison, or expected output built by
  the very helper, renderer, or SQL query being tested.
- A mock that supplies the outcome being asserted, including a fake database
  that always returns the expected rows without exercising the actual query.
- A source grep for a function name, import, exact SQL text, or a duplicated
  list of exports when executable behavior already provides stronger proof.
- A private helper call-count or internal call order that has no observable
  consequence, repeated across several suites.
- A negative case that passes at the wrong guard (for example, authorization
  rejects the request before the constraint or query under test is reached).
- A fixture named after a complex scenario that never includes its decisive
  condition, or a persistence test asserting against a store the path never
  writes.
- A test whose only justification is preserving otherwise unused production
  code or test-only scaffolding.

These are review candidates, not automatic deletions. Static checks can be the
best independent guard for package metadata, migration ordering, security
configuration, CLI bytes, or release wiring. Slow database tests may be the
only proof of transactional behavior. Identify the actual contract first.

## Python and SQL proof choices

For Python, prefer focused `pytest` cases at the public function, API, CLI,
worker, or persistence boundary. Patch external I/O when appropriate, but do
not patch away the behavior being asserted. For asynchronous code, exercise
the meaningful cancellation, timeout, and cleanup path rather than only an
awaited mock.

A hand-written fake of an external tool (a Docker or Compose stand-in, a fake
HTTP service or CLI) encodes your belief about that tool. When you extend it
with new behavior, name the real evidence for that behavior in the same
change: upstream documentation, a smoke run against the real tool, or one
recorded real invocation. A recovery path that only the fake has exercised is
untested; say so, and add a real-tool smoke where the project already has one
for a sibling path.

Bound every wait in an async test and set a per-test timeout, so a hang fails
with the test id instead of holding the CI job. A deadline that starts before
the awaited stage can expire first; wait for the stage or the task under test,
whichever ends first, and release fixtures in `finally`.

Settings handed to a framework, such as host allowlists, CORS or auth
matchers, are proven by at least one request through the real application
for each accept and reject rule. The framework's matching semantics are the
contract, not the settings object you build.

For SQL, use a disposable database or test schema when correctness depends on
the engine: NULL semantics, joins, constraints, migrations, indexes, locking,
and transaction visibility. Assert independently specified input/output rows
and meaningful edge cases, not just that a statement executes. For migrations,
verify both schema and data invariants on the supported upgrade path; test
rollback only if the project supports it. Keep database versions and fixtures
representative of deployment. Use a safe, authorized environment for any
performance experiment and measure representative data rather than inferring
speed from query text or a mocked plan.

## Focused audit workflow

Discover candidates read-only; start with a few high-confidence ones, grouped
by production owner. Before editing, record for each candidate:

- exact test and assertion, plus the failure it can actually detect;
- non-test callers of any production seam it protects;
- the stronger remaining test at the owning boundary, or a reason no test is
  needed;
- history explaining the test or seam, and the risk of removal;
- the concrete cleanup it enables and the narrow validation command.

Retain a test if it independently guards an API, SQL result, migration, storage,
security, config, platform, packaging, release, or operational contract. Do not
delete a failing baseline test without investigating a possible product bug.
Change one coherent owner-boundary group at a time. If a retired test was the
only consumer of an otherwise unused production seam, remove the seam in that
same change; avoid replacement tests that merely restate it.

For a subsystem-wide pruning campaign, inventory every owned test and CI path,
record a baseline, name the keeper for each contract, and independently review
what the deletion loses before applying batches. Split large campaigns into
reviewable changes; a target number of removed lines is not a success metric.

## Not evidence (report these as insufficient alone)

- Coverage percentage or test count
- Source greps for a function name, import, exact SQL text, or export list when
  executable behavior already provides stronger proof
- A mock that supplies the outcome being asserted
- "CI green" without naming the job, command, and owner boundary

Every audit or authoring handoff must name the **owner-boundary validation
command** actually run (or explicitly state it was not run and why).

## Validation and handoff

Use the project's actual runner and tooling. Typical focused checks include
`uv run pytest tests/path.py` or `pytest tests/path.py`, plus Ruff and SQLFluff
only if the project uses them. Run relevant database integration and migration
checks on an isolated database when SQL behavior changed. Run the executable
entry point or dry-run that owns a contract if a source-only check was removed.
Then inspect `git diff --check` and `git diff --numstat`; compare the remaining
proof with the original behavior. Escalate to broader tests only when the
change or project policy requires them.

Report what was added, retained, consolidated, or removed, why the owner test
is sufficient, any production simplification, the owner-boundary validation
command (exact), actual checks run, unresolved risks, and production versus
test LOC. Call out any coverage %, grep, or mock-only claim that was rejected
as non-evidence. Commit, push, or create a PR only when requested.
