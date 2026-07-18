# Workload And Contention

All queries are read-only. They omit query text, client addresses, role names,
and application names. Counters are cumulative since the statistics reset.

## Connection Pressure

```sql
SELECT
    state,
    count(*) AS connection_count,
    count(*) FILTER (WHERE state = 'active') AS active_count,
    count(*) FILTER (WHERE state = 'idle in transaction') AS idle_in_tx_count
FROM pg_stat_activity
WHERE datname = current_database()
GROUP BY state
ORDER BY connection_count DESC;
```

## Blocked Sessions

```sql
SELECT
    blocked.pid AS blocked_pid,
    blocking.pid AS blocking_pid,
    blocked.wait_event_type,
    blocked.wait_event,
    blocked.query_start AS blocked_query_started_at,
    blocking.query_start AS blocking_query_started_at
FROM pg_stat_activity AS blocked
CROSS JOIN LATERAL unnest(pg_blocking_pids(blocked.pid)) AS blockers (pid)
INNER JOIN pg_stat_activity AS blocking
    ON blockers.pid = blocking.pid
WHERE blocked.datname = current_database();
```

## Idle Transactions

```sql
SELECT
    pid,
    xact_start,
    state_change,
    wait_event_type,
    wait_event,
    clock_timestamp() - xact_start AS transaction_age,
    clock_timestamp() - state_change AS idle_age
FROM pg_stat_activity
WHERE
    datname = current_database()
    AND state = 'idle in transaction'
ORDER BY xact_start ASC NULLS LAST;
```

Long idle transactions can retain locks and delay cleanup. Treat them as an
incident signal, not evidence to terminate a session without authorization.

## Wait-Event Summary

```sql
SELECT
    wait_event_type,
    wait_event,
    count(*) AS session_count
FROM pg_stat_activity
WHERE
    datname = current_database()
    AND state <> 'idle'
    AND wait_event IS NOT NULL
GROUP BY wait_event_type, wait_event
ORDER BY session_count DESC;
```

## Sequential-Scan Candidates

```sql
SELECT
    schemaname,
    relname,
    seq_scan,
    idx_scan,
    n_live_tup,
    seq_tup_read
FROM pg_stat_user_tables
WHERE seq_scan > 0
ORDER BY seq_tup_read DESC
LIMIT 20;
```

Sequential scans can be correct. Review table size, predicate selectivity,
statistics freshness, and query plans before considering an index.

## Cache Hit Ratios

```sql
SELECT
    schemaname,
    relname,
    heap_blks_read,
    heap_blks_hit,
    round(
        100.0 * heap_blks_hit / nullif(heap_blks_hit + heap_blks_read, 0),
        2
    ) AS heap_cache_hit_pct
FROM pg_statio_user_tables
WHERE heap_blks_hit + heap_blks_read > 0
ORDER BY heap_cache_hit_pct ASC NULLS LAST
LIMIT 20;
```

```sql
SELECT
    schemaname,
    relname,
    indexrelname,
    idx_blks_read,
    idx_blks_hit,
    round(
        100.0 * idx_blks_hit / nullif(idx_blks_hit + idx_blks_read, 0),
        2
    ) AS index_cache_hit_pct
FROM pg_statio_user_indexes
WHERE idx_blks_hit + idx_blks_read > 0
ORDER BY index_cache_hit_pct ASC NULLS LAST
LIMIT 20;
```

## Statement Fingerprints

Requires PostgreSQL 13+ with `pg_stat_statements`. Query text is intentionally
omitted. Query IDs may still be sensitive in some environments.

```sql
SELECT
    statement_stats.queryid,
    statement_stats.calls,
    statement_stats.rows,
    round(statement_stats.total_exec_time::numeric, 2) AS total_exec_ms,
    round(statement_stats.mean_exec_time::numeric, 2) AS mean_exec_ms,
    round(
        100.0 * statement_stats.shared_blks_hit
        / nullif(
            statement_stats.shared_blks_hit + statement_stats.shared_blks_read,
            0
        ),
        2
    ) AS shared_cache_hit_pct
FROM pg_stat_statements AS statement_stats
WHERE statement_stats.calls > 0
ORDER BY statement_stats.total_exec_time DESC
LIMIT 20;
```
