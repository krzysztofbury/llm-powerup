# Platform Observability

These read-only checks describe database-level state. The returned values need
workload, configuration, and collection-window context.

## Database Statistics

```sql
SELECT
    datname AS database_name,
    numbackends AS connection_count,
    xact_commit,
    xact_rollback,
    blks_read,
    blks_hit,
    temp_files,
    deadlocks,
    conflicts,
    stats_reset,
    round(
        100.0 * xact_rollback / nullif(xact_commit + xact_rollback, 0),
        2
    ) AS rollback_pct,
    round(100.0 * blks_hit / nullif(blks_hit + blks_read, 0), 2) AS cache_hit_pct,
    pg_size_pretty(temp_bytes) AS temp_bytes
FROM pg_stat_database
WHERE datname = current_database();
```

## Active Maintenance Progress

```sql
SELECT
    progress.relid::regclass AS relation_name,
    progress.phase,
    progress.heap_blks_total,
    progress.heap_blks_scanned,
    progress.heap_blks_vacuumed
FROM pg_stat_progress_vacuum AS progress;
```

```sql
SELECT
    progress.relid::regclass AS relation_name,
    progress.command,
    progress.phase,
    progress.blocks_total,
    progress.blocks_done
FROM pg_stat_progress_create_index AS progress;
```

`pg_stat_progress_create_index` requires PostgreSQL 12+. Empty results mean no
visible operation is running; they do not prove maintenance is not occurring.

## Installed Extensions

```sql
SELECT
    extension.extname,
    extension.extversion,
    namespace.nspname AS schema_name
FROM pg_extension AS extension
INNER JOIN pg_namespace AS namespace
    ON namespace.oid = extension.extnamespace
ORDER BY extension.extname;
```

## Replication State

```sql
SELECT
    state,
    sent_lsn,
    write_lsn,
    flush_lsn,
    replay_lsn,
    pg_wal_lsn_diff(sent_lsn, replay_lsn) AS replay_lag_bytes,
    write_lag,
    flush_lag,
    replay_lag
FROM pg_stat_replication;
```

```sql
SELECT pg_is_in_recovery() AS is_replica;
```

Replication views are empty on systems with no visible standbys. Do not infer
network health from a single lag sample.
