---
name: oura
description: Summarizes authorized Oura sleep, readiness, activity, stress, and heart-rate data. Use when the user asks to interpret their Oura data or health trends.
compatibility: Requires an authorized Oura API, MCP, or health-data adapter.
---

# Oura Health Summary

Use only a health-data capability already authorized by the user. Never ask the
user to paste an API token, session cookie, or authentication code into chat.

## Data Handling

- Fetch only the period and metrics needed for the request.
- Do not expose raw API responses, identifiers, or provider errors unless the
  user explicitly requests diagnostics and understands the disclosure.
- State the data period and call out missing or unsynchronized data.
- Treat scores as context, not a diagnosis or medical advice.

## Workflow

1. Identify whether the user is asking about sleep, readiness, activity,
   stress, heart rate, or a trend.
2. Query the corresponding authorized adapter for the minimum necessary range.
3. Summarize the score, its contributors, and a comparison with the user's own
   historical baseline when that baseline is available.
4. Give one or two low-risk, non-medical suggestions only when the data supports
   them. Recommend a qualified clinician for persistent, severe, or concerning
   symptoms.

## Output

```text
Period: YYYY-MM-DD to YYYY-MM-DD

Summary: one sentence grounded in the returned data.
Key signals:
- Metric: value - contribution or trend.

Context: comparison to the available baseline, or state that no baseline exists.
Next step: one practical, non-medical action.
```

If the adapter is unavailable, say which capability is missing and ask the user
to configure it or provide an exported summary. Do not guess values.
