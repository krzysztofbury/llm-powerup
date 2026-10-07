# Diagnose a skill from observed failures

Audit the selected skill using representative task evidence before proposing
changes. This is the diagnosis step of an opt-in evaluation workflow; continue
with [a rubric](02-skill-scoring-checklist.md) only when useful.

1. Obtain the skill, intended task boundaries and available real transcripts.
2. Propose a small dataset covering normal tasks, edge cases and requests that
   should not trigger the skill. Agree on inputs, provider/data scope and a
   run/time/cost budget before making model calls.
3. Run an unchanged baseline in the actual harness, or score existing runs
   whose conditions are known. Record model, effort, tools, permissions and
   source snapshot. Label static inspection separately from executed evidence.
4. Rank observed failures by impact and frequency. Cite the input, output and
   violated requirement; distinguish likely causes from demonstrated ones.
5. Report coverage gaps and evaluator uncertainty. A small smoke sample does
   not establish every failure pattern or model-wide behavior.

Output: baseline evidence, ranked failures, competing explanations and a
focused next experiment. Do not invent outputs or run results.
