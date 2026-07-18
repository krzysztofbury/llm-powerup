# Maintenance And Storage

All queries are read-only catalog diagnostics. They identify candidates for DBA
review and must not be treated as automatic maintenance instructions.

## XID Wraparound Risk

```sql
SELECT
    datname AS database_name,
    age(datfrozenxid) AS xid_age,
    round(
        100.0 * age(datfrozenxid)
        / current_setting('autovacuum_freeze_max_age')::bigint,
        2
    ) AS pct_of_freeze_max_age
FROM pg_database
WHERE datname NOT IN ('template0', 'template1')
ORDER BY xid_age DESC;
```

```sql
SELECT
    table_stats.schemaname,
    table_stats.relname,
    age(relation.relfrozenxid) AS xid_age,
    pg_size_pretty(pg_total_relation_size(table_stats.relid)) AS total_size,
    table_stats.last_autovacuum
FROM pg_stat_user_tables AS table_stats
INNER JOIN pg_class AS relation
    ON relation.oid = table_stats.relid
ORDER BY xid_age DESC
LIMIT 20;
```

## Dead Tuples And Autovacuum

```sql
SELECT
    schemaname,
    relname,
    n_live_tup,
    n_dead_tup,
    last_vacuum,
    last_autovacuum,
    last_analyze,
    last_autoanalyze
FROM pg_stat_user_tables
WHERE n_dead_tup > 0
ORDER BY n_dead_tup DESC
LIMIT 20;
```

```sql
SELECT
    schemaname,
    relname,
    n_live_tup,
    n_dead_tup,
    greatest(last_vacuum, last_autovacuum) AS last_vacuum_at,
    greatest(last_analyze, last_autoanalyze) AS last_analyze_at
FROM pg_stat_user_tables
WHERE n_live_tup > 10000
ORDER BY last_vacuum_at ASC NULLS FIRST
LIMIT 20;
```

## HOT Updates And Write Pattern

```sql
SELECT
    schemaname,
    relname,
    n_tup_upd,
    n_tup_hot_upd,
    round(100.0 * n_tup_hot_upd / nullif(n_tup_upd, 0), 1) AS hot_update_pct,
    n_live_tup
FROM pg_stat_user_tables
WHERE n_tup_upd > 0
ORDER BY hot_update_pct ASC NULLS LAST
LIMIT 20;
```

```sql
SELECT
    schemaname,
    relname,
    n_tup_ins,
    n_tup_upd,
    n_tup_del,
    n_live_tup
FROM pg_stat_user_tables
WHERE n_tup_ins + n_tup_upd + n_tup_del > 0
ORDER BY n_tup_ins + n_tup_upd + n_tup_del DESC
LIMIT 20;
```

Low HOT activity and a write pattern are workload clues, not direct fillfactor
or vacuum recommendations.

## Relation Size

```sql
SELECT
    schemaname,
    relname,
    pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
    pg_size_pretty(pg_relation_size(relid)) AS table_size,
    pg_size_pretty(pg_indexes_size(relid)) AS index_size
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 20;
```

## Extension-Backed Bloat Metrics

`pgstattuple` functions read relation pages. An authorized DBA must install the
extension and approve one target relation per run. These are vetted exceptions
to the usual rule against invoking arbitrary functions through `SELECT`.

```sql
WITH target AS (
    SELECT 'public.example_table'::regclass AS relation
)
SELECT
    target.relation::text AS relation_name,
    bloat_stats.approx_tuple_percent,
    bloat_stats.dead_tuple_percent,
    bloat_stats.approx_free_percent
FROM target
CROSS JOIN LATERAL pgstattuple_approx(target.relation) AS bloat_stats;
```

```sql
WITH target AS (
    SELECT 'public.example_index'::regclass AS index_relation
)
SELECT
    target.index_relation::text AS index_name,
    bloat_stats.avg_leaf_density,
    bloat_stats.leaf_fragmentation
FROM target
CROSS JOIN LATERAL pgstatindex(target.index_relation) AS bloat_stats;
```
