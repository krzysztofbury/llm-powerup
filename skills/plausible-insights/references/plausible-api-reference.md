# Plausible Stats API v2

Use [the official reference](https://plausible.io/docs/stats-api) for current
fields and constraints. Checked 2026-09-26. These examples are workflows, not
an immutable copy of the API specification.

## Request and response

`POST $PLAUSIBLE_API_URL/api/v2/query` with a Bearer key (see Configuration in
`SKILL.md`; the default base URL is `https://plausible.io`).
Required: `site_id`, `metrics`, `date_range`. Dimensions, filters, ordering,
pagination and `include` are optional. Use curl directly or an authorized
adapter; no private helper or automatic cache is assumed. Never print the API
key or authorization headers.

```json
{
  "site_id": "example.com",
  "metrics": ["visitors", "pageviews"],
  "date_range": "30d",
  "dimensions": ["event:page"],
  "order_by": [["visitors", "desc"]],
  "pagination": {"limit": 20, "offset": 0}
}
```

```bash
jq -cn '{site_id: env.PLAUSIBLE_SITE_ID, metrics: ["visitors"], date_range: "7d"}' |
  curl -sS --fail --connect-timeout 10 --max-time 30 \
    "$PLAUSIBLE_API_URL/api/v2/query" \
    -H "Authorization: Bearer $PLAUSIBLE_API_KEY" \
    -H 'Content-Type: application/json' --data-binary @- |
  jq '{results, meta}'
```

Read dimension and metric arrays in the same order as the request.
Do not silently treat missing revenue or warnings as zero.
Check imported-data coverage and equivalent periods before comparison.

## Dates

Current presets include `day`, `24h`, `7d`, `28d`, `30d`, `91d`,
`month`, `6mo`, `12mo`, `year`, `all`.
Custom ranges use two ISO 8601 date or datetime values; use them for an
unsupported preset. Compute comparison dates dynamically; old example dates
are not the last period.

## Metrics and dimensions

Session metrics can use `event:page`; `event:hostname` can accompany it.
Other event dimensions remain constrained for `bounce_rate`,
`visit_duration` and `views_per_visit`.
Do not repeat the old blanket ban on session metrics with pages.
`pageviews` is not restricted to event dimensions.
`time_on_page` and `scroll_depth` require an `event:page` filter or dimension.
Conversion and revenue metrics have goal-specific requirements. Validate the
exact combination against the current API response.

Choose `visit:entry_page` for landing-page questions, `event:page` for viewed
content, and `visit:source` for acquisition. These answer different questions;
do not merge their counts as equivalent populations.

## Pagination, filters and ordering

Pagination is optional. For deliberate limits use
`pagination: {limit: 100, offset: 0}`, not a top-level `limit`.
For full tables request `include.total_rows` and check coverage.
Ordering references requested metrics or dimensions.

Use `contains` for a substring and `matches` for a regular expression.
Filter clauses are arrays; do not send a bare string.
See [filters](api/filters.md) and [errors](api/errors.md).

## Diagnosis and boundaries

Read [metric definitions](https://plausible.io/docs/metrics-definitions)
and [interpretation](seo/thresholds.md) before drawing conclusions. Account
for traffic volume, seasonality, campaign mix, consent, ad blockers, tracking
changes and the page's user intent. Define a success metric before running an
experiment. Inspect actual pages, tracking and relevant samples.
Read-only analysis does not authorize changing goals, tracking, content,
campaigns or site configuration.
