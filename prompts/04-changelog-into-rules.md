# Review optimization lessons and retire rules

Analyze the real [evaluation changelog](03-skill-autoresearch-loop.md). Propose
scoped hypotheses, including deletions, rather than compulsory universal rules.

1. Compare kept and reverted changes with their task outcomes and run conditions.
2. Separate repeated evidence from one-off observations, correlated changes
   and evaluator preferences. Look for counterexamples and holdout regressions.
3. For each useful candidate, record the failure it prevents, supporting runs,
   task/model/harness scope, known exceptions, owner and review date or trigger.
4. Check existing guidance for duplication, contradiction or obsolete assumptions.
   Prefer narrowing or retiring a rule when its cost no longer has evidence.
5. Present a small proposed diff for approval. Zero new rules is valid; do not
   turn local score improvements into permanent instructions for every task.

Output: supported patterns, uncertainties, provisional rule changes and review
conditions. Preserve decision history and a reversible previous version.
