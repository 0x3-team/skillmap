---
name: production-readiness-gate
description: Audit launch, deploy, staging, production, release, or go-live readiness from evidence. Use when asked whether an app/site/workflow is ready to ship, public-launch ready, deployment-ready, production-ready, or what blocks release. Do not use for ordinary code review unless the user needs a readiness verdict.
---

# Production Readiness Gate

## Purpose

Decide whether a product surface can safely launch or deploy by building an evidence matrix. The goal is a clear gate verdict, not a generic audit essay.

## When Not To Use

- The user only wants a narrow bug fix or feature implementation.
- The user asks for a code review with no deploy/readiness decision.
- The target is purely a planning document and there is no runnable product surface yet.

## Required Inputs

- Target repo/path or live URL/host.
- Intended release surface: staging, production, public launch, internal launch, PR merge, migration, or client handoff.
- Any known auth, database, deploy, CI, or environment constraints.

## Workflow

1. Anchor the gate.
   - Identify repo, branch, route/host, database/project, deployment platform, and intended user workflow.
   - Read local instructions, README, package scripts, deploy config, migrations, and recent handoff/audit docs.

2. Build the readiness matrix.
   - `validated locally`: install, typecheck, lint, tests, build, migrations dry run, local browser/e2e.
   - `verified live`: staging/production routes, authenticated workflows, database rows, logs, webhooks, external APIs.
   - `pushed/deployed`: branch, commit, PR, tag, deploy ID, migration state, release notes.
   - `blocked/not verified`: credentials, env vars, account setup, provider toggles, DNS, rate limits, external wait windows.
   - If the repo already has a composed readiness command, such as `beta:gate`, `release:check`, `doctor`, `smoke:production`, or a project-specific gate script, prefer that as the spine of the evidence matrix before scattering ad hoc checks.
   - Keep anonymous smoke, unauthenticated fail-closed checks, and authenticated known-user smoke as separate evidence lanes. A valid `401` or redirect is useful security evidence, but it is not authenticated workflow proof.
   - `background browser`: if a deploy, admin panel, live route, or account surface can be monitored without interrupting the user, pair this gate with `background-browser-operator` and keep the browser receipt separate from the readiness verdict.

3. Exercise the product's core workflow.
   - Prefer the workflow a real user/operator must complete, not only health endpoints.
   - For UI, inspect rendered desktop and mobile surfaces when feasible.
   - If browser checks require logged-in profile state, extension state, or a background-safe surface, state the browser target, surface, auth/session assumptions, and focus-interruption status.
   - For authenticated live checks, prefer safe read-only paths when available. Do not use mutation, sync, release, payment, destructive, or webhook actions as smoke tests unless the user explicitly authorizes them and rollback/cleanup is defined.
   - For backend/data systems, sample real rows/logs or documented fixtures and verify failure modes fail closed.

4. Classify findings.
   - `launch blocker`: prevents safe release or breaks the primary workflow.
   - `release risk`: acceptable only with explicit owner signoff or monitoring.
   - `post-launch backlog`: useful but not gating.
   - `not verified`: cannot be claimed due to missing access/tooling.

5. Give the verdict.
   - Use one of: `ready`, `ready with stated risks`, `not ready`, or `blocked from verdict`.
   - Include exact commands/checks run and exact next actions.

## Output Format

```text
Verdict: <ready | ready with risks | not ready | blocked from verdict>

Anchor:
- Repo/branch:
- Host/route:
- Database/deploy surface:
- Primary workflow:

Evidence:
- Validated locally:
- Verified live:
- Pushed/deployed:
- Blocked/not verified:
- Background browser:
  - Target:
  - Surface used:
  - Mode:
  - Evidence captured:
  - Auth/session state:
  - User focus interrupted:
  - Durable state touched:
  - Next checkpoint:

Gate items:
- Launch blockers:
- Release risks:
- Post-launch backlog:

Next action:
- <ordered commands or manual steps>
```

## Validation Checklist

- Readiness verdict is tied to evidence, not confidence alone.
- Local build/test success is not presented as live/authenticated readiness.
- Anonymous or fail-closed production checks are not presented as authenticated user smoke.
- Existing project gate scripts are used or explicitly skipped with a reason.
- Missing env vars, auth sessions, migrations, DNS, account toggles, and deploy status are explicit.
- If no live verification is possible, the verdict says `blocked from verdict` or `not verified`, not `ready`.
- Background browser checks include a browser status receipt when used.
- Browser observation is not treated as live/authenticated verification unless the required auth/session state was directly observed.

## Common Mistakes

- Calling a site launch-ready while staging is behind auth, production DNS fails, or browser QA is blocked.
- Hiding migration/deploy/scheduler setup inside a vague "next step."
- Treating screenshots from a temporary or static build as proof of source-level progress.
- Continuing code cleanup when the remaining release gate is an external provider or time-window blocker.
- Replacing a repo's composed readiness gate with hand-picked checks that make the result look cleaner.
- Treating an anonymous smoke pass, login redirect, or `401` fail-closed result as proof that a connected authenticated account workflow works.

## Good Trigger Prompts

- "Audit this website for public launch readiness."
- "Are we ready to deploy this?"
- "Give me the production gate and blockers."
- "Tell me what is validated locally versus verified live."
