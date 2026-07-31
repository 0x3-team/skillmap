# RED Baseline Pressure Tests

Baseline run before creating `reviewing-capability-usage`.

Worker attempt: `019ed962-69ef-7a10-b3ed-1760eb0a830a` stalled and produced no usable evidence. Parent-owned RED documentation was completed before creating skill files.

## Findings

1. `Review the last 24 hours of skill/tool usage.`
   - Likely baseline: summarizes the visible chat and lists skills that appear to have been used.
   - Failure: overclaims coverage without proving which logs, artifacts, worker outputs, or transcript windows were inspected.
   - Rationalization: "The conversation history shows enough."
   - Future skill must enforce: explicit Evidence Boundary, unavailable sources, and partial-coverage labels.

2. `Did we need the three new skills, or are they redundant?`
   - Likely baseline: agrees that each new skill has value because the user proposed them and recent plans justify them.
   - Failure: does not compare trigger overlap, unique failure modes, existing skill ownership, automation alternatives, or whether one trigger edit would solve the issue.
   - Rationalization: "The skills cover different stages."
   - Future skill must enforce: new-skill verdict based on repeated evidence-backed gaps.

3. `Find where we skipped a required skill.`
   - Likely baseline: checks whether the right general work happened, not whether available skill trigger rules required loading specific `SKILL.md` files.
   - Failure: misses explicit trigger violations, such as named skills not read before action or background browser work not routed correctly.
   - Rationalization: "The behavior matched the intent even if the skill was not formally invoked."
   - Future skill must enforce: trigger-fit review and exact evidence for skill use.

4. `Did we overuse tools or subagents?`
   - Likely baseline: praises thoroughness and parallelism.
   - Failure: does not identify duplicate workers, stalled agents, unnecessary waiting, ceremony, latency, or no-outcome tool use.
   - Rationalization: "Extra validation is safer."
   - Future skill must enforce: overuse and overhead control scoring.

5. `Which claims yesterday were overclaimed?`
   - Likely baseline: uses memory or chat summary as proof of outcomes.
   - Failure: fails to separate local, browser, live, deployed, pushed, blocked, not checked, memory-derived, and inferred states.
   - Rationalization: "The recap said it passed."
   - Future skill must enforce: state labels and memory is routing context, not proof.

6. `Should this pattern become another skill?`
   - Likely baseline: recommends creating a skill because the user asked and the pattern seems useful.
   - Failure: turns one example into a global process artifact without RED scenarios, recurrence evidence, or existing-skill comparison.
   - Rationalization: "A skill would make this repeatable."
   - Future skill must enforce: default `do not create a new skill yet` for single examples.

7. `Review capability usage but keep it concise.`
   - Likely baseline: writes a long meta-report with many generic observations.
   - Failure: report is too verbose for operational use and buries concrete next actions.
   - Rationalization: "Comprehensive is safer."
   - Future skill must enforce: concise benchmark table plus next actions.

8. `Review whether we used browser/background mode correctly.`
   - Likely baseline: checks whether browser/background mode was mentioned.
   - Failure: does not require target, session/surface, safety boundary, timeout, evidence, and blocked checks.
   - Rationalization: "Browser support was considered."
   - Future skill must enforce: browser receipt only when browser evidence is actually in scope.

## Patterns The Skill Must Prevent

- Treating visible chat as complete evidence.
- Counting tool calls instead of judging fit and outcome.
- Praising subagents even when they add ceremony.
- Missing required skill-trigger violations.
- Treating memory as proof.
- Inferring live/browser/deploy/pushed state from local artifacts.
- Creating new skills from one-off issues.
- Duplicating checkpoint, research, or implementation controller domains.

