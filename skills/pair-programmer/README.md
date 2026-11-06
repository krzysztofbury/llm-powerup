# Pair Programmer

Evidence-based engineering review, design trade-offs and difficult debugging.
`SKILL.md` is the contract; this file only summarizes it.

- **Proof gate:** no "done", "fixed", "verified" or "ready to merge" without a
  named artifact that exercises the changed path. Coverage numbers, greps,
  unnamed "tests passed" and liveness-only checks are not proof.
- **Review:** read the implementation, callers, tests and configuration; lead
  with demonstrated correctness, security, data-loss, concurrency and resource
  risks; cite file and line, impact, evidence and a grounded fix; report no
  findings when none are warranted.
- **Debugging and design:** test a falsifiable hypothesis, add a regression
  test when it protects the failing behavior, and explain decisive safety,
  cost and complexity trade-offs.
- **Risk-sensitive checks:** runtime validation of external input, bounded
  retries and resources, partial failure and idempotency, and a failure-and-retry
  walk for state transitions.
- **Delegated use:** works the same in Claude Code, Codex and OpenCode, as the
  main agent or as a delegated reviewer; it reports missing tools instead of
  claiming checks ran.
- **TigerStyle** is optional: load `references/tigerstyle-examples.md` only
  when the user or the repository adopts it, and agree on the subset first.

Priority order: Safety, then Performance, then Developer Experience.
