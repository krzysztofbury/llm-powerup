# JavaScript And Next.js

Use the current Sentry setup flow for the installed Next.js and Sentry SDK
versions. File names and generated configuration have changed across releases;
do not copy an old layout blindly.

## Privacy-Conservative Defaults

Sentry JavaScript SDK 10.57 and later supports explicit `dataCollection`
controls. Preserve a restrictive policy unless a reviewed use case requires
more data:

```ts
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  dataCollection: {
    userInfo: false,
    genAI: { inputs: false, outputs: false },
    httpBodies: [],
    httpHeaders: false,
    cookies: false,
    urlQueryParams: false,
    stackFrameVariables: false,
    frameContextLines: 0,
  },
});
```

For older SDKs, use the official version-specific data-management guidance
instead of assuming this option exists.

## Error Boundaries And Source Maps

- Capture errors outside render paths or ensure the framework integration does
  not repeatedly capture the same render failure.
- A source-map artifact, SDK release, and deployment release must agree exactly
  unless using the documented Debug ID workflow.
- Verify artifact upload in a non-production release before relying on readable
  browser stack traces.

## Replay And Feedback

Session replay and feedback screenshots can collect highly sensitive data. Keep
them disabled until masking, consent, retention, access, and incident use cases
are reviewed. Test masking against real UI states with synthetic data.
