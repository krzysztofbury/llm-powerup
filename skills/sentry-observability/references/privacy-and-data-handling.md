# Privacy And Data Handling

Start from an approved data inventory, not from SDK defaults. Modern SDKs may
collect request bodies, headers, cookies, user data, source context, local
variables, or generative-AI content unless explicitly configured otherwise.

## Default Policy

- Disable default PII collection unless a reviewed use case requires it.
- Disable request-body, cookie, query-parameter, local-variable, attachment,
  screenshot, replay, and AI input/output capture until approved.
- Use an allowlist for any data category that must be captured.
- Treat stable hashes of email addresses, device identifiers, and account IDs as
  potentially personal data.
- Restrict issue links and event access to authorized incident channels.

## Callback Design

Use separate callbacks for separate policies:

- **Privacy scrubber:** on an error, drop the event and emit a local,
  non-sensitive diagnostic signal. Sending unredacted data is worse than losing
  one event.
- **Noise filter or fingerprinter:** keep it fast and fail open so an internal
  callback defect does not silently hide an outage.

Test callbacks with representative events containing fake secrets, nested
objects, exceptions without request context, and malformed data.

## Review Checklist

Before enabling richer collection, document:

1. Data categories and the reason each is needed.
2. Redaction, retention, residency, access-control, and deletion requirements.
3. Whether error payloads can contain customer content, credentials, source
   code, health data, or regulated data.
4. The production approval owner and a rollback path.

Refer to the current SDK's official data-management documentation. Product,
plan, and legal requirements are deployment-specific.
