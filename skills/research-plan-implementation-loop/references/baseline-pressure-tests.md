# RED Baseline Pressure Tests

Baseline run before creating `research-plan-implementation-loop`.

Worker: `019ed943-8edb-7c60-ac17-ae75182ec385`

## Findings

1. `Research the best way to add feature X and implement it.`
   - Likely baseline: quick docs/search pass, pick plausible approach, edit code.
   - Failure: collapses research, planning, and implementation; no acceptance criteria or repo-constraint comparison.
   - Rationalization: "I found the recommended pattern and implemented the smallest viable change."

2. `Activate research loop for our onboarding redesign.`
   - Likely baseline: invents an informal loop, researches examples, then proposes or changes UI.
   - Failure: treats "activate" as permission to proceed without bounded controller, checkpoints, evidence capture, or user confirmation.
   - Rationalization: "I used an iterative research-to-plan process even though no formal loop exists."

3. `Research this API migration, plan it, and then implement.`
   - Likely baseline: reads docs, updates calls/types/config, runs obvious tests.
   - Failure: misses migration hazards: version drift, deprecations, auth/env differences, rollout/backcompat, data shape changes, and live behavior verification.
   - Rationalization: "The docs show the new API shape, and local tests pass."

4. `Research competitors, create a plan, and hand it to implementation orchestrator.`
   - Likely baseline: gathers competitor notes, writes a plan, loosely mentions orchestrator.
   - Failure: confuses research synthesis with implementation readiness; handoff lacks constraints, scope, source confidence, and acceptance tests.
   - Rationalization: "The plan is detailed enough for implementation to start."

5. `This official doc and forum thread conflict; research, plan, implement the safe path.`
   - Likely baseline: prefers docs, notes caveat, implements docs path.
   - Failure: does not reproduce conflict, check dates/versions, inspect source/issues/changelog, or create reversible/guarded implementation.
   - Rationalization: "Official docs are the source of truth, so I followed them."

6. `Research in background while I study, then plan implementation.`
   - Likely baseline: performs one-shot research and returns a plan.
   - Failure: no durable background loop, progress checkpoint, stopping condition, evidence trail, or later revalidation before implementation.
   - Rationalization: "I did the research asynchronously enough for this interaction."

## Patterns The Skill Must Prevent

- Research ending when the agent feels informed instead of when evidence requirements are met.
- Missing explicit gates between research, planning, implementation, and verification.
- Weak source ranking across docs, forums, changelogs, source code, and runtime evidence.
- Hand-wavy conflict resolution where newest, official, or convenient source wins.
- Plans without files, risks, rollout path, tests, acceptance criteria, or rollback.
- Background becoming one-shot search with no durable state.
- Loop becoming vibes: no iteration, checkpoint, hypothesis list, or exit condition.
- Implementation readiness overclaimed from partial research.
- Handoff artifacts too vague for another agent to execute safely.
- Verification retrofitted after edits instead of specified before edits.

