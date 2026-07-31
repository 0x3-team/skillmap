# Orchestration Rules

## Worker Policy

Use workers when research, planning, or implementation spans independent evidence surfaces:

- official docs/source/changelog
- community or maintainer reports
- local repo/runtime verification
- competitor/product research
- background browser lane
- implementation feasibility
- validation/security/release risk

Do not create duplicate broad workers. Each worker needs one narrow scope and a skill/tool route.

## Required Orchestration Decision

```text
Orchestration decision:
- Mode: research-only | research-plan | research-plan-implement
- Worker count:
- Decision reason:
- Independent surfaces:
- Workers used or skipped:
- Visible thread decision:
- Background browser lane:
- Token/context rationale:
- Reconsider trigger:
```

Visible threads are not workers. Create user-visible Codex threads only when explicitly requested for user-owned long-lived lanes. Use subagents for internal evidence gathering.

## Reconsider Triggers

Add or change workers when:

- official and community evidence conflict
- runtime behavior differs from docs
- planning depends on unresolved claims
- implementation scope touches multiple subsystems
- validation fails for unclear reasons
- background browser work blocks on auth/session/route changes
- the user challenges the worker decision

## Anti-Cheat

- Do not plan before the claim ledger is frozen.
- Do not implement before the plan is saved.
- Do not use implementation workers as research workers.
- Do not claim background work completed without target, stop condition, and evidence.
- Do not claim loop complete when only research or planning is done unless the mode stops there.

