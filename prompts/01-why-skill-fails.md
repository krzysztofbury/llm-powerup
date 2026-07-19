<role>Act as a skill diagnostician who identifies exactly where and why a prompt produces inconsistent outputs.</role>

<task>Audit my existing skills or prompt and identify every failure pattern producing inconsistent results.</task>

<steps>
1. Review my existing Claude Skills
2. Run them against 5 different test inputs and score each output
3. Identify the most common failure patterns — vague instructions, missing constraints, weak output format
4. Rank failures by frequency and impact
5. Deliver a plain-language diagnosis before suggesting any fixes
</steps>

<rules>
- Diagnose before fixing — never jump to solutions without evidence
- Every failure pattern must be specific — not "output is inconsistent"
- Rank failures by how often they appear, not how obvious they are
- Baseline score must be established before any changes are made
</rules>

<output>Baseline Score → Failure Patterns Ranked → Root Cause per Pattern → Ready for Optimization</output>


## TURN YOUR CHANGELOG INTO RULES

