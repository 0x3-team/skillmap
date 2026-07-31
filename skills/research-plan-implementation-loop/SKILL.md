---
name: research-plan-implementation-loop
description: Use when the user asks for research that should lead to planning, implementation, product changes, build decisions, or an end-to-end loop rather than a standalone research answer.
---

# Research Plan Implementation Loop

## Overview

Run a strict controller loop from verified research to planning to implementation. This skill sequences `verified-research`, `planning-orchestrator`, `implementation-orchestrator`, and `engineering-acceptance-review`; it does not replace them.

Prime directive: never collapse research, planning, and implementation into one stream. Freeze the research claim ledger before planning, freeze the plan before implementation, then verify implementation against the research-backed claims.

## When To Use

- The user says "research in a loop", "activate research loop", "research then plan", or "research then implement".
- The research output should become product, code, architecture, migration, UX, or build decisions.
- The user asks to hand research to planning or implementation orchestrators.
- Research has contradictory sources that must drive a safe plan before implementation.
- Browser/background research should continue while the user studies, then feed planning or implementation.

## When Not To Use

- The user wants a standalone research answer; use `verified-research`.
- The user already has a verified dossier and wants only planning; use `planning-orchestrator`.
- The user already has a saved plan and wants only implementation; use `implementation-orchestrator`.
- The task is a local correctness checkpoint; use `checkpoint-quality-loop`.
- The failure cause is unknown in a live incident; use `root-cause-investigator` first.

## Mandatory Goal Rule

Create or reuse a `/goal` by default for `research-plan` and `research-plan-implement`. The goal is the loop ledger.

The goal must track research question, source tiers, claim ledger status, contradictions, dossier path, planning artifact path, implementation authorization, worker decisions, background browser lane, implementation slices, verification status, blockers, and verdict.

For a tiny research-only answer, do not use this controller unless the user explicitly asked for a loop. If used in lightweight mode, label it `lightweight research only`.

## Mode Gate

Classify the requested mode before doing work:

- `research-only`: use `verified-research`, produce answer/dossier, stop.
- `research-plan`: use `verified-research`, save dossier, invoke `planning-orchestrator`, save plan, stop.
- `research-plan-implement`: use `verified-research`, save dossier, invoke `planning-orchestrator`, save plan, then invoke `implementation-orchestrator`.

Default: if the user says "research loop", "activate research loop", or "research and plan" but does not clearly authorize code edits, choose `research-plan`.

Implementation requires explicit authorization: words like implement, build, change code, execute, ship, apply, or fix. Do not treat "activate loop" as implementation permission. Do not treat "hand it to implementation orchestrator" as edit permission; it means produce an implementation-orchestrator handoff artifact unless the user also authorizes implementation.

## Required Loop

1. **Anchor:** topic, decision to support, target repo/product/system, current date/time sensitivity, region/version/tier, desired mode, implementation authorization, stop conditions.
2. **Emit orchestration decision:** mode, worker count, skipped-worker rationale, visible-thread decision, background browser lane, independent evidence surfaces, reconsider trigger.
3. **Research:** use `verified-research`; save a dossier for non-trivial or downstream work.
4. **Research gate:** freeze claim ledger. Do not plan from unclassified claims.
5. **Planning:** hand the dossier to `planning-orchestrator`; save an implementation-ready plan.
6. **Planning gate:** freeze the plan. Do not implement from chat-only research or vague plans.
7. **Implementation:** if authorized, hand the saved plan to `implementation-orchestrator`.
8. **Post-implementation research consistency check:** verify implemented behavior still matches confirmed claims and accepted assumptions.
9. **Engineering acceptance review:** if implementation happened, use `engineering-acceptance-review` before closeout. It must check project-goal fit, task fit, source-surface ownership, hallucinated code/contracts, architecture/maintainability, behavior evidence, and local/live/deploy/blocker separation.
10. **Close or loop:** if claims fail, the plan is vague, validation fails, or engineering acceptance fails, loop back to the correct stage instead of improvising.

## Required Receipts

- `Loop contract`: mode, topic, decision, target system, goal, artifacts, authorization, stop conditions.
- `Research receipt`: `verified-research` route, dossier, claim counts, disputed/stale/unverifiable claims, blocked checks.
- `Planning receipt`: `planning-orchestrator` route, plan path, acceptance criteria, validation plan, planning blockers.
- `Implementation receipt`: `implementation-orchestrator` route, selected slice, changed files, validation, blocked checks. Use `not authorized` if mode stops before code edits. If the user only requested a handoff, state `handoff artifact produced; implementation not started`.
- `Consistency receipt`: claims relied on, implementation behavior, local/browser/live/deploy status, contradictions found, verdict.
- `Engineering acceptance receipt`: `engineering-acceptance-review` verdict when implementation happened, goal fit, task fit, source-surface check, hallucination/contract check, maintainability risk, and accepted risks or fixes required.

## Closeout Verdicts

Use one:

- `research complete`
- `research-plan complete`
- `research-plan-implementation complete`
- `loop blocked`
- `loop failed`
- `lightweight research only`

## Red Flags

Stop and tighten the loop when you hear:

- "I found the recommended pattern, so I implemented it."
- "Activate loop means I can edit."
- "The docs show the migration, and tests pass."
- "The plan is detailed enough" without acceptance criteria.
- "Official docs beat the forum thread" without reproducing the conflict.
- "Background research was asynchronous enough."
- "Implementation can start from this chat summary."
- "The implementation matches the research claim, so it does not need engineering acceptance review."

## Common Mistakes

- Collapsing research, planning, and implementation into one pass.
- Ending research when the agent feels informed instead of when evidence requirements are met.
- Treating `likely`, `disputed`, `stale`, or `unverifiable` claims as implementation facts.
- Creating chat-only plans that the implementation orchestrator must rediscover.
- Implementing from competitor ideas without source confidence, scope, constraints, and acceptance tests.
- Retrofitting verification after edits instead of defining it before implementation.
- Claiming live/current behavior from local checks or docs alone.
- Closing after implementation with only a research consistency receipt and no `engineering-acceptance-review` verdict.
