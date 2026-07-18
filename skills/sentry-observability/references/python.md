# Python

Verify examples against the installed `sentry-sdk` version. A minimal
privacy-conservative starting point is:

```python
import os

import sentry_sdk

sentry_sdk.init(
    dsn=os.environ["SENTRY_DSN"],
    environment=os.environ.get("SENTRY_ENVIRONMENT", "development"),
    release=os.environ.get("SENTRY_RELEASE"),
    send_default_pii=False,
    include_local_variables=False,
    include_source_context=False,
    max_request_body_size="never",
)
```

Do not make the DSN optional by silently falling back to a real value. A missing
DSN should mean telemetry is intentionally disabled or configuration is rejected
by the application according to its deployment policy.

## Integrations

Auto-enabled and default integrations vary by SDK version and installed
libraries. Add an integration only when it is needed or when overriding its
configuration. Avoid enabling overlapping framework integrations without
checking the current compatibility documentation.

## Sampling And Callbacks

- Use either a fixed transaction sample rate or a sampler when policy requires
  differentiated traffic. Respect parent trace decisions where appropriate.
- Keep callback work bounded: no network calls, database queries, or file I/O.
- Test `before_send`, `before_breadcrumb`, and samplers with real exception
  objects and synthetic payloads.
- Do not place unique request, order, account, or trace IDs in tags.

## Background Work

Use the integration documented for the task framework and test propagation from
the request producer through the worker. For long-lived workers, monitor health
with the service's health or metrics system rather than pretending an infinite
loop is a bounded scheduled job.
