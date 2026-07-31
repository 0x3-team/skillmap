---
name: checkpoint-quality-loop
description: Use when the user wants a serious checkpoint before continuing work, especially after meaningful implementation, refactor, audit remediation, launch-readiness, or multi-agent work where correctness, production quality, maintainability, or a scoped lens like UI/UX, security, backend, data, performance, architecture, or release readiness must be verified.
---

# Checkpoint Quality Loop

## Overview

Run a production-grade checkpoint before work continues. This is a controller skill: it sequences `audit-orchestrator`, `planning-orchestrator`, `implementation-orchestrator`, `engineering-acceptance-review`, verification gates, and lens-specific skills without replacing them.

Prime directive: do not let a checkpoint close because the work "seems fine." It closes only when evidence proves the selected scope meets the quality bar, or a precise blocker prevents further safe progress.

Use `references/baseline-pressure-tests.md` as anti-regression pressure: the skill exists to prevent vague reviews, optimism bias, local/live overclaiming, skipped planning, shallow production-readiness checks, and weak background browser evidence.

When checkpoint correctness depends on external, current, contradictory, or implementation-bound claims, use `verified-research` to validate those claims before treating them as evidence.

## When To Use

- The user says "checkpoint", "make sure everything is correct so far", or "verify before we continue".
- The user asks for a scoped checkpoint: UI/UX, whole-project, security, backend, data, architecture, performance, production readiness, browser/live, testing/QA, or docs/devex.
- The user wants audit findings planned, implemented, and verified as one durable loop.
- A major implementation, refactor, release, or multi-agent pass needs top-tier code quality before continuing.

## When Not To Use

- Tiny one-file checks where a normal review is enough.
- Explanation-only questions.
- A short read-only checkpoint summary explicitly requested by the user.
- Incident/root-cause work where the cause is still unknown; use `root-cause-investigator` first.

## Mandatory Goal Rule

Create or reuse a `/goal` by default. The goal is the checkpoint ledger.

The goal must track lens, scope, audit evidence, confirmed findings, remediation plan, implementation slices, worker/thread decisions, validation results, browser/live/deploy status, accepted risks, blockers, and verdict.

Exception: if the user explicitly asks for a short read-only checkpoint summary, do not create a goal; label it `lightweight checkpoint only`.

Never mark the goal complete after only the audit, only the plan, or only code edits. Close only after verification passes or a precise blocker remains.

## Required Loop

1. **Anchor:** repo/path, branch/worktree, dirty state, route/host, database, deploy platform, browser surface, primary workflow, lens, included/excluded surfaces, live/auth/env limits.
2. **Classify lens:** use `references/checkpoint-lenses.md`; if user says "whole thing", decompose into independent lenses.
3. **Emit orchestration decision:** worker count, skipped-worker rationale, visible-thread decision, independent surfaces, reconsider trigger. Use workers when the checkpoint spans multiple independent lenses, more than one subsystem, security plus implementation, browser plus code, or broad production readiness. If skipping workers, state why the scope is narrow enough. Visible user-owned threads are only for explicit user-requested handoff lanes; use subagents for internal checkpoint work.
4. **Audit:** use `audit-orchestrator` or the lens-specific audit route; freeze confirmed findings before implementation.
5. **Plan:** use `planning-orchestrator` on confirmed findings unless the fix is tiny and obvious.
6. **Implement:** use `implementation-orchestrator`; keep slices narrow and use TDD where feasible.
7. **Verify:** re-run the relevant audit/gate; use `production-readiness-gate` for release scope and `background-browser-operator` for background browser checks.
8. **Acceptance review:** after implementation or remediation, use `engineering-acceptance-review` before a passing verdict. It must check project-goal fit, task fit, source-surface ownership, hallucinated code/contracts, architecture/maintainability, behavior evidence, and local/live/deploy/blocker separation.
9. **Repeat or close:** P0/P1 in-scope findings or failed acceptance review keep the loop open; P2/P3 findings require explicit deferral or the next slice.

## Specialist Routing Matrix

Use focused specialist skills when they materially improve the checkpoint evidence:

| Need | Route |
| --- | --- |
| Current library, framework, SDK, CLI, API, or cloud-service docs | `context7-mcp` |
| Architecture, module boundaries, flow tracing, or impact analysis | `codegraph` |
| Syntax-shaped search, codemods, or repeated structured edits | `ast-grep` |
| Language-server diagnostics or project-aware static checks | `lsp-setup` |
| Frontend/UI screenshot, responsive, overflow, or interaction evidence | `visual-qa` |
| Prior-session, token, subagent, or disconnected-work evidence | `coding-agent-sessions` |
| Unknown failure cause | `root-cause-investigator` |

If a specialist route is required but unavailable, keep the checkpoint honest: report the reduced confidence or blocker instead of silently downgrading the evidence bar.

## Production Quality Bar

Assume the checkpoint is being reviewed at a top-tier engineering company. Before closeout, require the quality gate in `references/quality-gates.md`.

Minimum standards:

- no spaghetti code
- no duplicated business logic without justification
- existing patterns preserved
- clear names and boundaries
- tests and validation proportional to risk
- local, browser, live, pushed, deployed, and blocked states separated
- no weakened tests, auth, lint, typecheck, validation, or security

## Required Receipts

Use these receipts in the final checkpoint report:

- `Checkpoint contract`: lens, included/excluded surfaces, quality bar, goal, evidence, stop conditions.
- `Audit receipt`: route, workers, confirmed findings, candidates, blocked checks, no-action areas, evidence.
- `Planning receipt`: plan artifact, remediation order, acceptance criteria, validation plan, open blockers.
- `Implementation receipt`: slice, files changed, worker scopes, tests/checks, integration decisions, blocked/not verified. If no code changes are made, explicitly state `no implementation performed` and why: findings invalidated by evidence, deferred with owner, blocked by access/env/auth/data/tooling, or out of scope.
- `Engineering acceptance receipt`: `engineering-acceptance-review` verdict, goal fit, task fit, source-surface check, hallucination/contract check, maintainability risk, and required fixes or accepted risks.
- `Verification receipt`: re-audit route, findings fixed/remaining, local/browser/live/deploy validation, code quality gate, verdict.

## Closeout Verdicts

Use one:

- `checkpoint passed`
- `checkpoint passed with accepted risks`
- `checkpoint failed`
- `checkpoint blocked`
- `lightweight checkpoint only`

## Red Flags

Stop and tighten the loop when you hear yourself thinking:

- "The user said it is probably fine."
- "The audit findings are obvious, so planning can be skipped."
- "Tests pass, so the checkpoint is done."
- "Local build passed, so production is ready."
- "This fix is small, so code quality review is unnecessary."
- "Whole-project checkpoint can be one generic pass."
- "Browser workflow seemed to work."
- "The implementation passed tests, so it does not need owner-style acceptance review."

## Common Mistakes

- Treating checkpoint as a vague review instead of a bounded evidence gate.
- Continuing implementation before recording baseline state.
- Fixing security issues before proving scope, risk, and verification path.
- Blending audit, plan, implementation, and verification so the baseline disappears.
- Reporting production quality without deploy target, env, data, auth, observability, and rollback coverage.
- Letting background browser work proceed without target, success criteria, timeout, and captured evidence.
- Closing a checkpoint after implementation/verification without an `engineering-acceptance-review` verdict when code or product behavior changed.
