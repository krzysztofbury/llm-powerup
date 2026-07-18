---
name: plausible-insights
description: Analyzes Plausible Analytics traffic and SEO data to find evidence-based conversion and content opportunities. Use when investigating traffic, landing pages, acquisition, engagement, or conversion performance.
compatibility: Requires authorized access to the Plausible Stats API or an equivalent analytics adapter.
---

# Plausible Insights

Act as an analytics investigator, not a dashboard narrator. Use the Plausible
Stats API only through an authorized, secret-aware client or adapter. Never ask
the user to paste an API key into chat or output an Authorization header.

## Workflow

1. Clarify the site, period, business goal, and decision the analysis should
   support.
2. Check tracking coverage, consent/ad-blocking limitations, and sample size
   before interpreting a change.
3. Query the smallest set of compatible metrics and dimensions needed to answer
   the question. See [Stats API reference](references/stats-api.md).
4. Compare equivalent periods and investigate meaningful changes in pages,
   sources, campaigns, or goals.
5. Fetch the affected public pages before proposing content, UX, or technical
   changes.
6. Separate measured facts, plausible hypotheses, and recommended experiments.

## Guardrails

- Use the current official API documentation when a metric, dimension, or filter
  compatibility rule matters.
- Do not treat a bounce rate or visit duration as a universal quality score.
- Do not infer causality from a single time period or low-volume segment.
- Avoid exposing visitor-level or sensitive query dimensions in reports.
- Use the configured site identifier; never assume a domain.

## Output

```text
Question: <decision being supported>
Period: <compared periods and timezone>

Findings
- <measured result with metric, segment, and source>

Interpretation
- <fact or clearly labeled hypothesis>

Recommended experiment
1. <specific change, expected signal, and success criterion>

Limits
- <tracking, sample-size, attribution, or data-quality caveat>
```
