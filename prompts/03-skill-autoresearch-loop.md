# Bounded skill improvement loop

Improve one selected skill using [observed failures](01-why-skill-fails.md)
and a [frozen rubric](02-skill-scoring-checklist.md). Preserve the original and
write isolated candidate versions.

## Before execution

Agree on the dataset, development/held-out split, actual harness and model,
provider/data scope, maximum rounds, wall-clock and cost/token budget, allowed
tools and actions, regression gates and minimum meaningful improvement.
If these are missing, propose them and wait before paid or provider calls.
Use a finite round cap, not an open-ended target score.

## Each round

1. Run the baseline and candidate on the same development inputs and environment.
   Keep model, effort, tools, permissions and source snapshot fixed.
2. Make one coherent change tied to a documented failure hypothesis.
3. Score actual outputs. Record correctness, severe regressions, false findings,
   user corrections, latency and usage alongside subjective human feedback.
   Repeat ambiguous comparisons within the approved budget to assess variance.
4. Keep or revert using the agreed criteria. Log the change, evidence and reason,
   including unsuccessful candidates. Stop after two rounds without meaningful
   improvement, a regression that invalidates the approach, or any budget cap.

Evaluate the selected candidate on frozen held-out cases once. Use blind human
comparison for subjective quality where feasible; an evaluator should not know
which output is the candidate. A holdout failure is evidence to reconsider the
candidate, not permission to tune repeatedly on the holdout. Obtain a new
approved holdout for another cycle.

Output: baseline, keep/revert log, held-out results, costs, uncertainties and
candidate diff. User approval controls adoption. Never count imagined outputs
as runs or claim a universal gain from one task set.
