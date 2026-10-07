# Design a bounded experiment for a repeatable task

Adapt the [skill evaluation workflow](03-skill-autoresearch-loop.md) to a
specific repeatable task. Start with a design, not unattended execution.

1. Establish the task, representative inputs, baseline and measurable outcome.
   Separate hard correctness gates from subjective quality and operational cost.
2. Freeze a rubric and held-out cases. Change one coherent variable at a time
   and preserve the original plus a reversible candidate.
3. Agree on maximum rounds, wall-clock, cost/token budget, provider/data scope,
   tool/action boundaries and stop conditions before executing experiments.
   Existing permission to analyze a workflow is not permission to publish,
   spend money, contact people or mutate production during an experiment.
4. Run the approved pilot in the actual environment. Log outputs, failures,
   latency and usage. Repeat ambiguous outcomes only within the approved budget.
5. Evaluate on held-out inputs and obtain human review of subjective trade-offs.
   Stop at the budget cap or after two rounds without meaningful improvement.
6. Document prerequisites, reproducible commands, rollback, missing capabilities
   and cases needing human judgment. Propose automation only for validated,
   explicitly authorized actions; a few pilot runs do not prove unattended safety.

Output: experiment design, approved pilot evidence when run, limitations and a
bounded repeatable procedure. Do not simulate successful experimental results.
