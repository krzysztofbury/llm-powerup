---
name: sentry-observability
description: Designs, reviews, and troubleshoots privacy-conscious Sentry error monitoring and tracing. Use for Sentry SDK setup, event quality, tracing, source maps, alerting, or incident triage.
compatibility: Requires a supported Sentry SDK and access authorized by the user.
---

# Sentry Observability

Help users design reliable observability without making unreviewed production
changes or collecting unnecessary data. This skill is community guidance and is
not affiliated with Sentry.

## First Principles

1. Define the operational decision before adding an event, tag, span, replay, or
   alert.
2. Minimize data before it leaves the process. Do not rely on server-side
   scrubbing as the only privacy control.
3. Keep searchable tags low-cardinality. Put request IDs, raw inputs, and other
   unique values in approved diagnostic context only when necessary.
4. Use error monitoring, tracing, logs, metrics, profiling, and replay for the
   distinct questions they answer; do not assume one replaces another.
5. Verify SDK APIs and defaults for the installed version using official docs.

## Workflow

1. Identify runtime, SDK version, deployment model, data classification, and
   alerting owner.
2. Review the existing initialization and data-collection settings before adding
   integrations or custom callbacks.
3. Establish a privacy policy first. See [privacy and data handling](references/privacy-and-data-handling.md).
4. Configure release and environment identity consistently across build,
   deployment, and SDK initialization.
5. Add only the instrumentation required for the concrete incident or SLO
   question. See [Python](references/python.md), [Next.js](references/javascript-nextjs.md),
   and [distributed tracing](references/distributed-tracing.md).
6. Test with synthetic data in a local or non-production environment. Obtain
   explicit approval before generating events, changing sampling, or enabling
   richer collection in production.

## Safety Rules

- Never print DSNs, auth tokens, customer data, raw request bodies, cookies, or
  unredacted events.
- Do not enable replay, feedback screenshots, attachments, AI prompt capture,
  or local-variable capture without a documented data review and explicit
  approval.
- Separate availability callbacks from privacy callbacks: a failed privacy
  scrubber must drop the event, while an optional noise filter may fail open.
- Do not make universal sampling, retention, quota, project-boundary, or legal
  claims. These depend on the SDK, deployment, plan, policy, and jurisdiction.

## Triage Output

```text
Scope: <runtime, service, release, environment, and time range>

Evidence
- <event, trace, metric, or code reference>

Finding
- <root cause or clearly labeled hypothesis>

Recommendation
1. <specific change> - <privacy/operational impact> - <validation>

Limits
- <missing data, sampling, access, or version limitation>
```
