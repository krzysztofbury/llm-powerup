# Distributed Tracing

Trace propagation has two requirements: services must forward the expected
headers, and those headers must be sent only to trusted destinations.

## Propagation

- Use explicit allowlists for internal service origins in
  `tracePropagationTargets` or the equivalent SDK option.
- Do not propagate tracing headers to arbitrary third-party APIs.
- For browser-to-service tracing, configure CORS to allow the tracing headers
  actually used by the SDK. Expose response headers only when browser code needs
  to read them.
- Preserve parent sampling when a trace crosses services; otherwise the trace
  becomes fragmented and difficult to interpret.

## Transaction Names

Use route templates and stable operation names. Do not include account IDs,
request IDs, unbounded query parameters, or raw database queries in transaction
names or tags.

## Validation

Test a synthetic request through the intended service boundary in a
non-production environment. Verify the trace connects end to end, headers are
not sent to an untrusted origin, and sampled traces match the documented policy.
