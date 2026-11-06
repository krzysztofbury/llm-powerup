# Optional TigerStyle profile

Use only for a project or review that explicitly adopts TigerStyle. This
reference illustrates selected ideas; the repository's version and documented
exceptions define its style contract. It does not replace the main skill.

## Predictable work

For latency-sensitive workers, consider a per-tick item budget and a bounded
queue. A budget limits work count, not wall-clock time: each operation still
needs its own timeout or cancellation contract. A finite `for` loop does not
need a redundant assertion solely to satisfy a checklist.

For recursive traversal, inspect maximum input depth and stack use. Use an
explicit stack when the adopted profile forbids recursion or input depth can
exhaust the call stack; otherwise recursion alone is not a defect.

## Invariants versus external input

```python
def payload_slice(packet: bytes, header_size: int) -> bytes:
    if not 0 <= header_size <= len(packet):
        raise ValueError("header_size exceeds packet bounds")
    return packet[header_size:]
```

The runtime check handles invalid input even with assertions disabled.
Internal assertions can instead compare independently maintained state, such
as a worker's pending count against enqueued minus completed work, at a point
where the protocol requires them to agree. Do not add tautological checks or
target an assertion count per function. Repeated validation is useful across
a real trust or serialization boundary, not on both sides of every helper call.

## Memory and hot paths

Measure allocation and latency before replacing idiomatic code. Preallocation
can help a bounded buffer, but a Python list slice allocates a new list and
does not demonstrate allocation-free execution. Record the workload and
measurement supporting a proposed optimization.

## Local conventions

Function length, assertion layout, naming and line width follow the adopted
project profile and formatter. Split functions at meaningful responsibilities;
do not introduce indirection just to meet an unadopted numeric limit. Cite the
actual project rule when reporting a style violation.
