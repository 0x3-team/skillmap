# Modes And Handoffs

## Mode Table

| Mode | Trigger | Required Skills | Stop Point |
| --- | --- | --- | --- |
| `research-only` | research answer or dossier only | `verified-research` | after answer/dossier |
| `research-plan` | research should become a plan, roadmap, decision, or orchestrator handoff | `verified-research`, `planning-orchestrator` | after saved plan |
| `research-plan-implement` | user explicitly asks to implement, build, change code, execute, ship, apply, or fix | `verified-research`, `planning-orchestrator`, `implementation-orchestrator` | after implementation validation or blocker |

Default to `research-plan` for "research loop" when implementation authorization is unclear. A request to "hand this to implementation orchestrator" is a request for a saved handoff artifact, not permission to edit, unless the user also says to implement, build, change code, execute, ship, apply, or fix.

## Handoff To `verified-research`

Pass:

- research question
- decision to support
- target repo/product/system
- source tiers required
- currentness/freshness risk
- contradictions to resolve
- background browser target, if any
- stop conditions

Required output from research:

- dossier path or research answer
- claim ledger
- source receipt
- verification receipt
- blocked checks
- planning handoff

## Handoff To `planning-orchestrator`

Pass:

- dossier path
- confirmed claims
- likely/disputed/stale/unverifiable claims that affect planning
- false claims and patterns to avoid
- implementation implications
- assumptions and accepted risks
- validation ideas
- blocked research checks

Planning must not treat `likely`, `disputed`, `stale`, or `unverifiable` claims as facts.

## Handoff To `implementation-orchestrator`

Pass:

- saved plan artifact path
- selected first slice
- acceptance criteria
- claims implementation depends on
- claims requiring runtime/browser/API verification
- blocked checks
- allowed and disallowed changes
- validation commands
- stop conditions

Implementation must not start from chat-only research or an unsaved plan. If the user only asked for a handoff to `implementation-orchestrator`, stop after the saved plan and handoff section; report `implementation not started`.

## Post-Implementation Consistency Check

After implementation:

- Verify code/product behavior against confirmed claims.
- Recheck any claim that implementation revealed as questionable.
- Separate local, browser, live, deploy, pushed, blocked, and not checked states.
- If a core claim fails, return to `verified-research` or `planning-orchestrator`.
