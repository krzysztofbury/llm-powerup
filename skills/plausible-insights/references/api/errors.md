# API failures

Check the HTTP status and a sanitized response. Never print credentials,
authorization headers or unrelated private data.

- 401/403: stop and ask for the required authentication or site permission.
- 429: respect Retry-After when present. The plausible.io default quota is 600 requests/hour; self-hosted limits may differ.
  Do not claim a cache exists for direct curl calls.
- Timeout: report the network failure, not an empty dataset.
- Invalid body: check required fields, array-valued filter clauses and the
  `pagination` object. Pagination itself is optional.
- Invalid metric/dimension combination: verify the current official rules.
  Session metrics can now use `event:page`; other event dimensions still have
  restrictions. Do not recommend outdated workarounds without checking.
- Empty results: verify site, dates, filters, tracking and complete pagination
  before concluding there was no traffic.

Use [the current API reference](https://plausible.io/docs/stats-api).
A provider error does not justify dropping filters until unrelated data appears.
