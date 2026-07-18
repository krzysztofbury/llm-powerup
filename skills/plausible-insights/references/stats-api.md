# Plausible Stats API Notes

Verify these notes against the current [official Stats API
reference](https://plausible.io/docs/stats-api) before using them in code.

## Request Shape

Send a JSON body to `POST /api/v2/query` through an authorized client:

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

`site_id`, `metrics`, and `date_range` are required. Dimensions, filters,
ordering, and pagination are optional.

## Date Ranges

Supported relative ranges include `day`, `24h`, `7d`, `28d`, `30d`, `91d`,
`month`, `6mo`, `12mo`, `year`, and `all`. Custom date or datetime ranges use
two ISO 8601 values.

## Metric And Dimension Compatibility

- `visitors`, `visits`, `pageviews`, and other metrics are documented by the
  API with their required filters or dimensions.
- Session metrics such as `bounce_rate`, `views_per_visit`, and
  `visit_duration` generally use visit dimensions.
- `event:page` is a documented exception for compatible session-metric queries.
  `event:hostname` is permitted only together with `event:page`; validate the
  exact combination against the current API response.
- `scroll_depth`, `time_on_page`, conversion, and revenue metrics have specific
  event-dimension or goal requirements.

## Interpretation

Treat analytics thresholds as heuristics. Before proposing a change, account
for traffic volume, seasonality, campaign mix, consent, ad blockers, tracking
changes, and the page's user intent. Compare equivalent periods and define a
success metric before running an experiment.
