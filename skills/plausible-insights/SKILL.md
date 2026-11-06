---
name: plausible-insights
description: Analyze website traffic, content performance and conversions with Plausible Analytics. Use when investigating traffic, landing pages, acquisition, engagement, SEO or conversion changes; inspects real pages and separates facts from hypotheses.
compatibility: Requires authorized access to the Plausible Stats API v2 (plausible.io or self-hosted), curl and jq, or an equivalent analytics adapter.
---

# Plausible Insights

Act as an analytics investigator, not a dashboard narrator. Start from the
user's decision, site and period; reuse context the user already gave in this
conversation. Query Plausible, investigate meaningful differences, then inspect
real pages before recommending changes. Separate observations, hypotheses and
confirmed causes.

## Configuration

Resolve settings in this order: explicit user instruction, environment
variables, then `~/.config/plausible-insights/config.json`.

| Setting | Env var | Config key | Default |
| --- | --- | --- | --- |
| Site ID (the domain as registered in Plausible) | `PLAUSIBLE_SITE_ID` | `site_id` | none: ask the user |
| API base URL (self-hosted instances) | `PLAUSIBLE_API_URL` | `api_url` | `https://plausible.io` |
| API key | `PLAUSIBLE_API_KEY` | not allowed | none: stop and ask |

```json
{ "site_id": "example.com", "api_url": "https://plausible.io" }
```

- Never guess or assume a site. If no site ID is configured or given, ask.
  When several sites are listed, ask which one the question is about.
- The API key comes only from the environment or the user's secret manager,
  never from the config file, chat or a command line you print. If it is
  missing, ask the user to export it; never ask them to paste it into chat.
- Never print the key or an Authorization header.

Load non-secret settings without echoing the key:

```bash
cfg="${XDG_CONFIG_HOME:-$HOME/.config}/plausible-insights/config.json"
[ -f "$cfg" ] || cfg=/dev/null
: "${PLAUSIBLE_SITE_ID:=$(jq -r '.site_id // empty' "$cfg" 2>/dev/null)}"
: "${PLAUSIBLE_API_URL:=$(jq -r '.api_url // empty' "$cfg" 2>/dev/null)}"
: "${PLAUSIBLE_API_URL:=https://plausible.io}"
export PLAUSIBLE_SITE_ID PLAUSIBLE_API_URL
```

## Workflow

1. Clarify the site, period, business goal and decision the analysis should
   support.
2. Check tracking coverage, consent and ad-blocking limitations, imported-data
   coverage and sample size before interpreting a change.
3. Query the smallest set of compatible metrics and dimensions that answers the
   question. Build the payload with JSON escaping rather than interpolating
   values into JSON by hand:

   ```bash
   jq -cn '{site_id: env.PLAUSIBLE_SITE_ID,
     metrics: ["visitors", "pageviews"], date_range: "7d"}' |
     curl -sS --fail --connect-timeout 10 --max-time 30 \
       "$PLAUSIBLE_API_URL/api/v2/query" \
       -H "Authorization: Bearer $PLAUSIBLE_API_KEY" \
       -H "Content-Type: application/json" --data-binary @- | jq '{results, meta}'
   ```

4. Compare equivalent complete periods with the same filters and tracking
   configuration. Compute dates dynamically; use explicit ISO dates for
   unsupported presets.
5. Fetch the affected public pages before proposing content, UX or technical
   changes.
6. Separate measured facts, plausible hypotheses and recommended experiments.

| Question | Dimensions | Metrics |
| --- | --- | --- |
| Top content | `event:page` | `visitors`, `pageviews` |
| Landing pages | `visit:entry_page` | `visitors`, `bounce_rate`, `visit_duration` |
| Acquisition | `visit:source` | `visitors`, `bounce_rate`, `visit_duration` |
| Daily trend | `time:day` | `visitors`, `pageviews` |
| Device mix | `visit:device` | `visitors`, `bounce_rate` |
| Site total | omit dimensions | `visitors`, `pageviews`, `bounce_rate`, `views_per_visit` |

## API contracts

- Verify version-sensitive behavior against the
  [current Stats API](https://plausible.io/docs/stats-api). Session metrics
  can use `event:page` and accompanying `event:hostname`; other event
  dimensions have restrictions. `pageviews` can use visit dimensions.
  `time_on_page` and `scroll_depth` need a page filter or dimension.
- Set `pagination: {limit: 20, offset: 0}` inside the request, not a top-level
  limit. For a full dataset request total rows and paginate to verified coverage.
- `is` matches literal values. Use `contains` or `matches` for path patterns.
- Result `metrics` and `dimensions` arrays follow their request order.
- Respect rate limits and errors; an incomplete or failed request is not zero
  traffic.

## Guardrails

- Bounce rate, visit duration and time on page are not universal quality
  scores. High bounce or short duration alone does not prove poor content, a
  broken UX or ranking loss.
- Do not infer causality from a single period or a low-volume segment. Show
  absolute counts and sample sizes beside percentages.
- Avoid exposing visitor-level or sensitive query dimensions in reports.
- Analytics access does not authorize changing goals, tracking, content,
  campaigns or site configuration.

## References

Load only the reference needed:

- [Metric interpretation](references/seo/thresholds.md): before evaluating engagement changes.
- [Investigation playbooks](references/seo-knowledge.md): competing explanations and next evidence.
- [API reference](references/plausible-api-reference.md): request, response, dates and compatibility.
- [Filters](references/api/filters.md): compound or pattern filters.
- [Errors](references/api/errors.md): request failures.

## Output

```text
Question: <decision being supported>
Site and period: <site ID, compared periods and timezone>

Findings
- <measured result with metric, segment, absolute counts and source>

Interpretation
- <fact or clearly labeled hypothesis, with competing explanations>

Recommended experiment
1. <specific change, expected signal and success criterion>

Limits
- <tracking, sample-size, attribution or data-quality caveat>
- <evidence still needed>
```
