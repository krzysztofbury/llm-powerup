# Build a task-specific evaluation rubric

For the selected skill and dataset, turn the user's acceptance criteria into
a compact rubric. Reuse the [diagnosis](01-why-skill-fails.md) evidence.

1. Identify hard requirements, unacceptable failures and subjective preferences.
2. Use binary checks for observable requirements, with one behavior per check.
   Use anchored ratings or human comparison for qualities such as clarity.
   Include severity so a critical regression cannot hide in an average score.
3. Apply the rubric to available real outputs, including a failure and a sound
   output. Record disagreements and ambiguous criteria; revise the criterion
   rather than claiming that subjective judgment has disappeared.
4. Keep only useful criteria. There is no universal item count or evidence that
   a particular checklist length prevents score gaming.
5. Freeze the rubric before [candidate comparisons](03-skill-autoresearch-loop.md).
   Keep held-out task identities and expected outcomes out of tuning feedback.

Output: criterion, scoring method, severity, evidence required and examples
of pass/fail or rating anchors. State which decisions still need human review.
