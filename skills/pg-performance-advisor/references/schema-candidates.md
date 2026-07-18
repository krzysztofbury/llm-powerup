# Schema Candidates

These queries inspect metadata, not application rows. Their results are review
candidates, never automatic migration instructions.

## Tables Without Primary Keys

```sql
SELECT
    namespace.nspname AS schema_name,
    relation.relname AS table_name,
    pg_size_pretty(pg_total_relation_size(relation.oid)) AS total_size
FROM pg_class AS relation
INNER JOIN pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
WHERE
    relation.relkind = 'r'
    AND namespace.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
    AND NOT EXISTS (
        SELECT 1
        FROM pg_constraint AS constraint_definition
        WHERE
            constraint_definition.conrelid = relation.oid
            AND constraint_definition.contype = 'p'
    )
ORDER BY pg_total_relation_size(relation.oid) DESC;
```

Some tables intentionally have no primary key. Check application semantics,
replica identity, and migration impact before recommending one.

## Partial-Index Review Candidates

```sql
SELECT
    statistics.schemaname,
    statistics.tablename,
    statistics.attname,
    statistics.null_frac,
    statistics.n_distinct,
    statistics.avg_width
FROM pg_stats AS statistics
WHERE
    statistics.schemaname NOT IN ('pg_catalog', 'information_schema')
    AND statistics.null_frac > 0.5
ORDER BY statistics.null_frac DESC, statistics.avg_width DESC
LIMIT 50;
```

A high null fraction alone does not justify a partial index. Confirm the query
predicate, selectivity, write overhead, existing indexes, and workload history.

## Index Usage Candidates

```sql
SELECT
    index_stats.schemaname,
    index_stats.relname AS table_name,
    index_stats.indexrelname AS index_name,
    index_stats.idx_scan,
    index_stats.idx_tup_read,
    index_stats.idx_tup_fetch,
    pg_size_pretty(pg_relation_size(index_stats.indexrelid)) AS index_size
FROM pg_stat_user_indexes AS index_stats
ORDER BY index_stats.idx_scan ASC, pg_relation_size(index_stats.indexrelid) DESC
LIMIT 50;
```

Low scan counts are not removal instructions. Review constraints, replica
identity, statistics-reset time, write overhead, and workload coverage first.
