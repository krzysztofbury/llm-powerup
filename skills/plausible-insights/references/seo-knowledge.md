# SEO investigation playbooks

Apply [contextual metric interpretation](seo/thresholds.md). These are questions
to investigate, not quality grades or causal signatures. Compare complete
periods, show denominators and account for source/device mix and tracking changes.

## Bounce or duration changes

1. Identify affected entry pages and sources; compare each with its own baseline.
2. Check event instrumentation, routing and deployment dates.
3. Inspect actual page content, load behavior and intended user action.
4. Compare goal completions and, when tracked, scroll depth. Successful
   single-page reading and an intent mismatch can produce similar visit metrics.

Distinguish visit duration from time on page. Neither measures comprehension.
Use the current Plausible definitions before interpreting missing or zero values.

## Traffic drops

1. Locate the changed source, page and device segments, with absolute counts.
2. Rule out incomplete days, tracking outages, changed filters and seasonality.
3. For an organic-search hypothesis, seek Search Console impressions, clicks,
   indexing evidence and relevant deployment history when available.
4. Mark ranking loss or an algorithm effect unconfirmed until that evidence exists.

## Traffic spikes

Identify the referring page, release or campaign where possible. Separate new
audience mix from changed behavior within comparable segments. A spike alone
does not establish virality, durable demand or valuable acquisition.

## Content and conversion

Inspect the entry page and intended conversion path before proposing a CTA or
internal-link change. Goal counts, conversion rates, intent and acquisition cost
can inform a source decision; bounce rate alone cannot justify increasing spend
or stopping a source. Direct traffic is not automatically brand awareness.

For each recommendation, record the observation, competing explanations,
proposed change and how improvement would be measured. Publishing, campaign
changes and site configuration require authorization for that action.
