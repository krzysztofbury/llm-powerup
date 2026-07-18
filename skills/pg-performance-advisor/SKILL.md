---
name: pg-performance-advisor
description: Performs read-only PostgreSQL performance diagnostics for locks, sessions, table statistics, and index candidates. Use for database health checks, slow-query investigations, bloat symptoms, or index reviews.
compatibility: Requires psql access through a user-managed read-only PostgreSQL service profile.
---

# PostgreSQL Performance Advisor

Diagnose and recommend. Never run DDL, DML, maintenance, privilege changes, or
`EXPLAIN ANALYZE`. Do not ask for passwords or write credentials. Require a
user-managed `PGSERVICE`, `PGPASSFILE`, or equivalent secret-managed connection.

## Preconditions

1. Confirm the target database, its environment, the diagnostic role, and the
   allowed scope.
2. Confirm that the role is read-only and has only the catalog-statistics
   visibility required for the task.
3. Never inspect application-row data, query text, client addresses, roles, or
   application names unless the user explicitly authorizes the extra exposure.

## Modes

### Health Check

Check active sessions, lock waits, idle transactions, table statistics, dead
tuples, index candidates, and database size. Report the statistics-reset or
uptime context before treating cumulative counters as evidence.

### Performance Investigation

Check long-running sessions, locks, cache pressure, sequential scans on large
tables, dead-tuple pressure, and configured query-statistics extensions in that
order. Stop when evidence identifies the primary bottleneck.

### Index Review

Treat index-usage and schema results as review candidates, never automatic
changes. Account for constraints, replica identity, partial indexes, statistics
age, and workload coverage.

## Read-Only Query Rules

Only run vetted `SELECT`, `SHOW`, or non-analyzing `EXPLAIN` statements. Do not
run arbitrary functions merely because they are invoked through `SELECT`.
Use the focused reference that matches the investigation:

- [workload and contention](references/workload-and-contention.md)
- [maintenance and storage](references/maintenance-and-storage.md)
- [platform observability](references/platform-observability.md)
- [schema candidates](references/schema-candidates.md)

## Output

```text
PostgreSQL Diagnostic Report - YYYY-MM-DD

Critical
- Finding - evidence - impact - DBA action required

Warnings
- Finding - evidence - validation needed before remediation

Healthy Signals
- Check - result

Limits
- Statistics age, permissions, workload coverage, or unavailable extension
```

Recommendations must name the required DBA action, operational risk, locking
behavior, rollback approach, and the evidence needed before execution.
