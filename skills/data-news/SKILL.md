---
name: data-news
description: Curates a concise daily briefing on data engineering, databases, and open-source data tools. Use when the user asks for recent data-industry news or a data-engineering digest.
compatibility: Requires web search and page-fetch capabilities.
---

# Data News Digest

Create a high-signal briefing for the preceding 48 hours unless the user gives
another period.

## Research

1. Search multiple independent sources for data engineering, databases,
   analytics engineering, streaming, and relevant open-source releases.
2. Prefer primary sources: project release notes, maintainers, official
   engineering blogs, and original papers or announcements.
3. Confirm each publication date from the page itself. Exclude undated or stale
   material rather than inferring its freshness from a search result.
4. Favor technically consequential changes over funding, generic marketing, or
   introductory explainers.
5. Retain the source URL for every candidate. Never invent a link, release, or
   metric.

## Include

- Database and query-engine releases, compatibility changes, or benchmarks with
  reproducible methodology.
- Meaningful developments in orchestration, transformation, streaming,
  warehousing, and data quality.
- Open-source projects with an identifiable maintainer announcement or release.
- Technical articles that explain a reusable implementation or operational
  lesson.

## Exclude

- Press releases without a substantive product or engineering change.
- Duplicates that repeat the same announcement.
- Claims whose primary source cannot be found.

## Output

Use this compact format:

```text
Data News Digest - YYYY-MM-DD

Releases and Infrastructure
1. Title - What changed, why it matters, and who is affected. URL

Technical Deep Dives
1. Title - Concrete lesson or result. URL

Discussions Worth Watching
1. Title - What the discussion reveals; distinguish opinion from evidence. URL
```

- Include three to five items per section at most.
- Omit empty sections.
- State uncertainty, conflicting benchmarks, or undisclosed methodology.
- Adapt formatting only when the user names a destination such as WhatsApp.
