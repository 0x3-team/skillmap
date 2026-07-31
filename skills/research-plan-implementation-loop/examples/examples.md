# Examples

## Research Then Plan

Prompt: `Activate research loop for our onboarding redesign.`

Correct route:

- Mode: `research-plan`.
- Use `verified-research` for onboarding evidence and competitor/source claims.
- Save dossier.
- Hand dossier to `planning-orchestrator`.
- Save implementation-ready plan.
- Stop because implementation was not explicitly authorized.

## Research Then Implement

Prompt: `Research this API migration, plan it, and then implement.`

Correct route:

- Mode: `research-plan-implement`.
- Use `verified-research` to check docs, changelog, source/issues, migration risks, and current behavior.
- Freeze claim ledger.
- Use `planning-orchestrator` to produce migration plan with acceptance criteria.
- Use `implementation-orchestrator` to execute selected slice.
- Verify implemented behavior against the research claims.

## Conflict-Safe Path

Prompt: `Official docs and forum thread conflict; research, plan, implement the safe path.`

Correct route:

- Preserve contradiction in research.
- Mark unresolved claim `disputed`.
- Planning should choose reversible or guarded implementation where possible.
- Implementation should not treat the disputed claim as fact.

## Background Research To Plan

Prompt: `Research in background while I study, then plan implementation.`

Correct route:

- Mode: `research-plan`.
- Use `background-browser-operator` through `verified-research`.
- Record target, read-only safety boundary, timeout, evidence, and blocked checks.
- Hand dossier to `planning-orchestrator`.
- Stop after saved plan unless implementation is authorized.

