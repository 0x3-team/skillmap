---
name: implementation-orchestrator
description: Orchestrate goal-backed implementation for large plans, audit remediation, RCA fix plans, multi-phase features, UI/UX revamps, backend/data/security work, or cross-surface engineering changes. Use when the user asks for an implementation conductor/orchestrator, says to implement a saved planning-orchestrator file, audit report, or root-cause fix plan, or wants focused subagents/workers coordinated until acceptance criteria pass. Do not use for small one-file fixes, read-only audits, planning-only work, or unresolved failures that still need root cause analysis first.
---

# Implementation Orchestrator

## Purpose

Execute complex implementation work as a parent-thread program. Consume a planning artifact, audit report, RCA fix plan, or explicit user scope; create a scoped `/goal` when useful; split the work into safe implementation slices; dispatch focused workers only when they improve quality; integrate changes; validate; loop on failures or gaps; and report exactly what changed.

This is an execution skill. Unlike `planning-orchestrator` and `audit-orchestrator`, code/docs/config edits are allowed when the user has asked for implementation. The parent thread remains accountable for integration, validation, and final status.

## When Not To Use

- The task is a small direct edit, one obvious bug fix, one file, or one simple command.
- The user wants only a read-only audit; use `audit-orchestrator`.
- The user wants a plan/spec but not code; use `planning-orchestrator`.
- The failure is not understood yet; use `root-cause-investigator` first.
- The source artifact is too vague to implement and cannot be clarified from repo evidence.
- Workers would edit the same files blindly or create merge conflicts without improving quality.

## Required Inputs

- Target repo/path, branch, worktree, PR, route, host, or product surface.
- Implementation source: planning file, audit report, RCA fix plan, issue/PR, or explicit user request.
- Desired slice: whole plan, Phase 1, P0/P1 findings, one workflow, one subsystem, or a named acceptance target.

## Optional Inputs

- Artifact path to update with progress.
- Permission or limits for live/browser/database/deploy checks.
- Constraints: no-new-library, preserve design system, target deadline, deployment target, migrations allowed/not allowed, auth/data limits.
- Priority standard: unblock primary workflow, production fix, beta quality, release readiness, security risk, performance, or polish.

## Complexity Gate

Before dispatching workers, decide whether orchestration is worth the overhead.

Use full orchestration when at least two are true:

- The work spans three or more distinct surfaces, such as UI, state, API, database, auth, deploy, tests, security, or docs.
- The source artifact has multiple phases, findings, or acceptance criteria.
- The implementation needs different specialist lenses, such as frontend design, backend contracts, data migration, security, QA, performance, or release.
- The user explicitly asks for a conductor, orchestrator, subagents, workers, or `/goal`.
- Independent validation workers would materially reduce missed regressions.
- The work may require repeated implement/validate/fix cycles.

Use lightweight mode when:

- The work is one screen, one workflow, or one subsystem.
- One worker can independently inspect a risky area while the parent implements.
- Validation is the main risk, not implementation breadth.

Worker count:

- `0 workers`: direct implementation for small or obvious work.
- `1-2 workers`: targeted support, such as UI polish review plus QA, or backend contract review plus tests.
- `3-5 workers`: normal large implementation across distinct surfaces.
- `6-8 workers`: broad redesign or platform change with cleanly separable areas.
- `9+ workers`: avoid unless the repo is very large and worker scopes are truly independent.

Prefer fewer, sharper workers. Add a worker only when it has a distinct surface, skill route, or validation responsibility.

Required orchestration decision receipt:

```text
Orchestration decision:
- Mode: <parent-only | lightweight workers | full worker run | visible-thread handoff>
- Worker count:
- Decision reason:
- Independent surfaces:
- Workers used or skipped:
- Thread decision:
- Token/context rationale:
- Reconsider trigger:
```

Default worker policy:

- If the user explicitly asks for an implementation conductor, orchestrator, workers, subagents, or parallel implementation on a multi-surface task, default to at least `1` worker unless the parent states a concrete reason not to.
- If the selected slice spans three or more independent surfaces, default to `2-5` workers.
- If implementation touches user-facing UI and backend/data behavior, use at least one read-only validation or QA worker when available.
- If the slice is security, release readiness, production validation, or data integrity, prefer a separate verification worker when the scope is not tiny.
- Parent-only implementation is allowed for narrow slices, but the receipt must explain why workers would not improve evidence or safety.
- Do not dispatch broad duplicate workers or overlapping write scopes. More workers are useful only when each has a distinct evidence source, skill route, write scope, or validation responsibility.

Visible threads are not implementation workers. Use workers/subagents for bounded implementation support, inspection, or validation inside one parent-owned task. Create user-visible Codex threads only for explicit user-owned lanes, long-lived handoffs, separate worktrees, or follow-ups the user asked to manage directly. Do not use visible threads as hidden scratch space or as a generic context-limit workaround.

## Evidence Tiers And Borrowed Gates

Keep this skill pragmatic: the parent thread may still implement directly when that is the fastest safe path. Do not import a "parent never implements" rule. Borrow adversarial completion discipline only where it improves safety, confidence, or continuity.

Before editing, classify the selected slice:

- `LIGHT`: narrow change inside existing patterns, low blast radius, no data/auth/security/release impact. Required proof: focused local checks plus one target-perspective evidence item when user-facing or behavior-facing.
- `STANDARD`: multiple files or one workflow/subsystem, moderate regression risk, user-facing behavior, generated artifacts, or non-trivial tests. Required proof: focused checks, target-perspective evidence, and at least one independent review/QA pass when workers are useful.
- `HIGH`: auth, security, payments, data integrity, migrations, production incident fix, concurrency, cache invalidation, cross-domain refactor, public API contract, deployment/release path, destructive operation, or prior validation failure. Required proof: failing-first or reproduction evidence where feasible, target-perspective evidence, triggered adversarial probes, and independent verification before claiming complete.

Use these gates selectively:

- `DoneClaim`: for every write-scoped worker on `STANDARD` or `HIGH`, require changed files, acceptance criteria addressed, commands run, target evidence, cleanup receipt, and known risks.
- `AdversarialVerify`: for every `HIGH` slice, failed validation recovery, or worker result that the parent did not personally implement, re-check the claim from a separate perspective. This can be parent verification when the parent did not materially write the change, or a separate reviewer/QA worker when independence matters.
- `Evidence ledger`: for broad, multi-cycle, `HIGH`, audit-remediation, or plan-driven runs, keep a lightweight append-only ledger. Prefer updating the source artifact when it already has a progress section; otherwise write a sibling file named `<source-artifact-stem>-implementation-ledger.jsonl`. If there is no source artifact, use `implementation-ledger.jsonl` under the repo's existing `plans/` or `docs/plans/` folder when present, otherwise under `.implementation/`.

Triggered adversarial classes:

- `malformed_input`: new parsing, validation, imports, CLI flags, request bodies, file formats, or data normalization.
- `prompt_injection`: untrusted external text, model-readable docs, scraped pages, user-submitted content, tool output injected into prompts, or generated instructions.
- `cancel_resume`: resumable, long-running, queued, streamed, interrupted, or state-machine flows.
- `stale_state`: generated artifacts, caches, build output, migrations, bundled payloads, snapshots, indexed data, or persisted session state.
- `dirty_worktree`: uncommitted user files in or near the edit scope.
- `hung_or_long_command`: long external commands, servers, watchers, migrations, browsers, containers, queues, or network-dependent checks.
- `flaky_test`: timing-sensitive tests, snapshots, network tests, animation/UI tests, or tests whose pass signal could be nondeterministic.
- `misleading_success_output`: logs, mocks, grep hits, dry runs, skipped tests, or success messages that could appear without exercising the target behavior.
- `repeated_interruptions`: mid-operation interruption risk, multi-turn continuation, compaction, or background workers.

Probe only classes whose trigger facts are present. Record each triggered class with the observable check used, and record skipped classes only when the slice is `HIGH` or the user explicitly asked for rigorous/adversarial verification.

## Execution Workflow

1. Anchor the parent thread.
   - Read `AGENTS.md`, README, package scripts, relevant docs, source artifact, current branch, and `git status`.
   - Identify stack, package manager, test commands, run commands, deploy path, data store, auth, routing, and primary user workflow.
   - Preserve unrelated user changes. Do not reset, overwrite, or reformat unrelated files.

2. Intake the source artifact.
   - For planning-orchestrator files, extract phase order, first slice, acceptance criteria, validation plan, risks, and handoff notes.
   - Extract the source-of-truth contract when present: intent, current behavior, expected outcome, truth owner, contract boundary, displaced path, cutover, acceptance evidence, evidence lane, kill criteria, and forbidden moves.
   - If the source artifact lacks that contract, derive a compact one from repo evidence before editing.
   - For cross-layer, data, API, migration, auth, deploy, or production-sensitive work, stop as a planning gap if truth owner, contract boundary, cutover, or acceptance evidence cannot be resolved safely.
   - For audit reports, extract confirmed findings, severity, evidence, recommended fixes, blocked checks, and remediation order.
   - For RCA fix plans, verify the proven cause and implement the minimal fix before broad cleanup.
   - For direct user scope, create a compact implementation contract from repo evidence before editing.

3. Run the complexity gate.
   - Choose direct, lightweight, or full orchestration.
   - State the worker count and why.
   - Emit the orchestration decision receipt before editing.
   - Include whether visible thread creation is appropriate and why.
   - Include a reconsider trigger for adding workers if validation fails, scope broadens, or independent evidence is missing.
   - Do not dispatch workers just because this skill was invoked.

4. Define the implementation contract.
   - Select the implementation slice.
   - State goals, non-goals, files/areas likely to change, acceptance criteria, validation commands/checks, and stop conditions.
   - State the source-of-truth owner, contract boundary, displaced path, cutover decision, acceptance evidence, evidence lane, kill criteria, and forbidden moves for this slice.
   - Record the evidence tier (`LIGHT`, `STANDARD`, or `HIGH`), the triggered adversarial classes, the target-perspective evidence expected, and whether a ledger is required.
   - Do not add a new current-looking path unless the old path is deleted, redirected, demoted, shimmed with a removal trigger, or explicitly kept with ownership.
   - If the observed defect is in a built bundle, generated data file, OCR/export output, temporary preview folder, browser payload, migration artifact, or `dist`-style output, identify the canonical source and pipeline owner before editing. Patch the generated artifact only when it is explicitly the source-of-truth or the user asks for an emergency local hotfix with that limitation stated.
   - For authoritative replacement work, define overwrite/reconcile behavior up front. Do not append old and new authoritative content together unless the plan explicitly calls for a merged historical record.
   - Mark questions as either blocking or resolvable during execution.

5. Turn the slice into a `/goal` and run the loop when appropriate.
   - If goal tooling is available and the task is broad, create a goal for the selected implementation slice.
   - The goal must include source artifact, scope, worker plan, allowed/disallowed changes, acceptance criteria, validation plan, anti-cheat rules, and stop conditions.
   - Treat the goal as the execution ledger: record slices completed, files changed, worker results, validation status, failed checks, follow-up cycles, and blockers.
   - Continue until acceptance criteria pass, the user changes scope, or a real blocker prevents progress.

6. Decompose work.
   - Assign one narrow duty per worker.
   - Route every worker to the relevant skill/tool when one exists.
   - Avoid overlapping write scopes. If two workers need the same files, use one worker or make one read-only.
   - For risky changes, prefer workers that inspect/design/test while the parent applies and integrates patches.
   - Record whether each worker is read-only, write-scoped, or validation-only.
   - Give write-scoped workers the evidence tier, applicable adversarial classes, expected target evidence, and cleanup requirements. For `STANDARD` and `HIGH`, require a `DoneClaim` rather than a vague completion summary.
   - For background browser work, route the browser lane through `background-browser-operator` while the parent remains accountable for edits and integration.

7. Implement.
   - Follow existing repo patterns, helpers, components, data contracts, and tests.
   - Keep changes scoped to the selected slice.
   - Prefer small coherent patches over broad rewrites.
   - For existing behavior, capture failing-first or reproduction evidence before changing code when feasible. For `HIGH`, a missing failing-first proof must be explained before proceeding.
   - Update docs or plan checklists only when they are part of the implementation handoff.

8. Integrate worker results.
   - Review worker outputs before applying conclusions.
   - Resolve conflicts in the parent thread.
   - Reject generic suggestions, unsupported claims, or changes outside scope.
   - Treat worker "done" reports as claims. For write-scoped `STANDARD` and `HIGH` worker output, inspect the diff, rerun or review the worker's checks, and convert the claim into accepted, rejected, unverified, or blocked.
   - For `HIGH`, complete an `AdversarialVerify` pass before considering the work integrated. The verifier must try to disprove the claim with the relevant target evidence and triggered adversarial classes.
   - Keep the source artifact's acceptance criteria visible while integrating.

9. Validate.
   - Run focused tests first, then broader checks when the blast radius warrants it.
   - Treat tests, lint, typecheck, build, and diffs as supporting checks, not completion proof.
   - Capture target-perspective acceptance evidence from the real route, payload, record, artifact, trace, rendered UI, CLI output, or operator-visible output before reporting `verified`.
   - For each triggered adversarial class, run the smallest observable probe that can falsify the claim. For skipped triggered probes, report `implemented but unproven` or `blocked`; do not silently downgrade the gate.
   - Capture cleanup receipts for every QA resource started during validation: server PID, port, tmux session, browser context, container, temp dir, queue worker, watch process, or one-off credentials/env override. Leftover runtime state blocks `verified`.
   - If implementation is complete but target-perspective evidence cannot be captured, report `implemented but unproven` with the exact blocker.
   - For frontend/UI work, run the app when needed and inspect the real UI with browser/screenshots across relevant viewports.
   - For browser checks that should not interrupt the user, use `background-browser-operator` and include its status receipt.
   - For backend/data/security work, run applicable unit/integration tests, typecheck, lint, migrations, schema/RLS checks, and safe read-only live checks when available.
   - Distinguish `validated locally`, `verified live`, `pushed`, `deployed`, `blocked`, and `not checked`.

10. Loop on gaps.
   - If checks fail, use `root-cause-investigator` when the failure cause is unclear.
   - If acceptance criteria are unmet, run another focused implementation cycle.
   - If the plan is wrong or incomplete, update the implementation contract or hand back a planning gap rather than improvising major scope.
   - Do not close the goal while in-scope validation failures remain.

11. Close or hand off.
   - Summarize changed files, behavior changed, validation run, live/deploy status, remaining risks, and next slice.
   - Update the plan/audit artifact status if requested or if it is clearly the durable ledger.
   - For ledger-backed runs, append the final closeout entry before the final report: status, accepted DoneClaims, AdversarialVerify result, target evidence, validation commands, cleanup receipts, and remaining blockers.
   - If deployment, migration, manual account work, or authenticated QA remains, give exact next actions.

## Goal Loop Contract

Use `/goal` as the continuity mechanism for large implementation runs. The parent thread owns the goal from source-artifact intake to validated completion.

Each loop should follow this rhythm:

1. `Slice`: choose the next implementation slice and acceptance criteria.
2. `Dispatch`: send narrow workers only where independent work improves quality.
3. `Implement`: parent and/or workers make scoped changes.
4. `Integrate`: parent reviews, merges, and resolves conflicts.
5. `Verify claims`: convert worker reports or parent changes into accepted, rejected, unverified, or blocked evidence. Use `DoneClaim` / `AdversarialVerify` when the evidence tier requires it.
6. `Validate`: run required checks, target-perspective scenarios, triggered adversarial probes, and cleanup checks.
7. `Gap check`: compare results against acceptance criteria and evidence tier requirements.
8. `Continue or close`: fix failures, run the next slice, mark blockers, or complete the goal.

Do not close because code was edited. Close only when the selected slice's acceptance criteria pass or a blocker is documented precisely.

## Worker Skill Routing

Each worker prompt must specify the skill/tool route.

Common routes:

- UI/UX implementation, responsive layout, component polish, design system: `frontend-design`.
- UI verification after frontend/layout/design edits: `visual-qa` for fresh screenshots, viewports, states, overflow, and interaction smoke checks.
- React/Next/Tailwind/shadcn implementation: framework-specific web app skills when available, plus repo components.
- Architecture tracing, impact analysis, module boundaries, shared-code edits, or unfamiliar repo onboarding: `codegraph`; let it check status and bootstrap/sync when appropriate.
- Syntax-shaped search, codemods, structured API migrations, or repeated code-shape edits: `ast-grep`.
- Language-server diagnostics, references, rename/goto support, or post-edit project diagnostics: `lsp-setup`.
- Bugs or failing validation with unclear cause: `root-cause-investigator`.
- Security/auth/privacy: security skills and repo security docs.
- Backend/API/data contracts: repo patterns, Supabase/Postgres/data skills, official docs when needed.
- Cloudflare/Workers/Wrangler/D1/R2/Pages: Cloudflare, Workers, Durable Objects, Wrangler skills.
- Performance: `web-perf`.
- Release readiness, deploy checks, final verification: `production-readiness-gate`.
- Current external API/platform/library/SDK/CLI/cloud-service behavior: `context7-mcp` first when available, then official docs or primary sources.
- Prior-session, token, subagent, or disconnected-work evidence needed for implementation continuity: `coding-agent-sessions`.
- Research-backed implementation: consume the saved `verified-research` dossier and `planning-orchestrator` plan. Do not implement from chat-only claims or unresolved `likely`, `disputed`, `stale`, or `unverifiable` research.
- Browser work that should proceed without interrupting the user: `background-browser-operator` as a support route, paired with the implementation domain skill.

Do not force a skill when none fits. Prefer local repo instructions and direct evidence.

Use these routes as targeted tools, not as ambient gates. Do not add hooks, background continuations, or broad worker fanout unless the current slice's risk and evidence needs justify them.

## Suggested Worker Lenses

For a major UI/UX implementation:

- `Layout worker`: page structure, spacing, alignment, responsive behavior.
- `Component worker`: buttons, inputs, menus, toolbars, modals, states.
- `Visual system worker`: typography, color, density, tokens, icon usage.
- `Interaction worker`: navigation, keyboard, selection, drag/drop, empty/loading/error states.
- `QA worker`: screenshot checks, overflow, accessibility, regression scenarios.

For backend/data implementation:

- `API contract worker`: request/response shape, validation, error handling.
- `Data worker`: schema, migrations, RLS/policies, seed/generated data, compatibility.
- `Security worker`: authz/authn, secrets, input handling, unsafe exposure.
- `Test worker`: unit/integration coverage, fixtures, failure reproduction.
- `Release worker`: env vars, deploy path, smoke checks, rollback risks.

Use fewer lenses when the selected slice is narrower.

## Worker Prompt Template

```text
Implementation worker for <target>.

Source artifact: <plan/audit/RCA path or summary>
Selected slice: <one narrow duty>
Allowed files/areas: <paths/surfaces>
Exclusions: <what not to touch>
Skill/tool route: <specific skill(s), MCP/tool, or "local repo instructions only">
Evidence tier: <LIGHT | STANDARD | HIGH>
Triggered adversarial classes: <classes or none>
Expected target evidence: <real route/payload/record/artifact/trace/rendered UI/CLI output>
Cleanup required for: <server/browser/tmux/container/temp dir/port/env override or none>

Required output:
- Changes made or recommended, with exact file paths.
- Acceptance criteria addressed.
- Checks run and results, with exact commands.
- Target-perspective evidence captured, with artifact path or observable output.
- Triggered adversarial probes run, with observable result, or exact blocker.
- Cleanup receipt for every QA/runtime resource started.
- `DoneClaim` when write-scoped on `STANDARD` or `HIGH`: changed files, checks, target evidence, cleanup, risks.
- Risks, blockers, or follow-up needed.
- Anything the parent must integrate or verify.

Stay within scope. Preserve unrelated user work. Do not claim live/deploy verification unless directly checked. Do not mark your own work verified; the parent accepts, rejects, or re-verifies your claim.
```

## Parent Goal Template

```text
Goal: Implement <selected slice> from <source artifact> in <target repo>.

Done when:
- Parent records repo/path, branch, dirty state, selected slice, non-goals, and acceptance criteria.
- Parent records the source-of-truth contract: owner, boundary, displaced path, cutover, evidence, kill criteria, and forbidden moves.
- Parent records evidence tier, triggered adversarial classes, expected target evidence, and whether a ledger is required.
- Parent records orchestration mode, worker count, skipped-worker rationale, visible-thread decision, and reconsider trigger.
- Workers complete narrow assigned duties or report exact blockers.
- Parent integrates changes, resolves conflicts, and treats every worker report as a claim until independently accepted.
- Required local checks pass or blocked checks are documented exactly.
- Target-perspective acceptance evidence is captured, or status is explicitly `implemented but unproven` or `blocked`.
- Triggered adversarial probes pass for `STANDARD`/`HIGH`, or skipped probes are documented as blockers/unproven gaps.
- For `HIGH`, `AdversarialVerify` accepts the claim before final `verified` status.
- Every runtime/QA resource has a cleanup receipt before pass status.
- Browser/live/deploy checks are completed when required and available, with status separated from local validation.
- Final report lists changed files, behavior changed, validation, remaining risks, and next slice.

Anti-cheat:
- No unrelated refactors.
- No overwriting user changes.
- No claiming implementation complete without validation or a precise blocker.
- No reporting `verified` without target-perspective acceptance evidence.
- No accepting write-scoped `STANDARD`/`HIGH` worker output without reviewing the `DoneClaim`.
- No `HIGH` completion without an `AdversarialVerify` pass or an explicit unproven/blocked status.
- No pass status while a spawned server, port, browser, tmux session, container, temp dir, queue worker, or env override remains active.
- No duplicate current-looking truth paths without cutover, ownership, and kill criteria.
- No claiming live/deploy/auth coverage from local checks.
- No broad duplicate worker prompts.
```

## Output Format

- `Implementation anchor`: repo/path, branch, source artifact, selected slice.
- `Mode decision`: direct, lightweight, or full orchestration; worker count and why.
- `Goal status`: active/completed/blocked, acceptance criteria, remaining gaps.
- `Contract gate`: truth owner, contract boundary, displaced path, cutover, evidence lane, kill criteria, forbidden moves, and whether the gate passed.
- `Evidence tier`: LIGHT/STANDARD/HIGH, triggered adversarial classes, probes run, skipped probes, and cleanup status.
- `Workers`: worker name, scope, status, skill route, DoneClaim status, blockers.
- `Orchestration closeout`: workers used, results accepted/rejected/unverified, parent verification, AdversarialVerify status when used, gaps that would benefit from more workers, and visible-thread decision.
- `Changed files`: exact paths and what changed.
- `Behavior changed`: user-facing or system-facing result.
- `Validation`: commands/checks run and results, separated into local/browser/live/deploy.
- `Acceptance evidence`: real route, payload, record, artifact, trace, rendered UI, CLI output, or operator-visible output inspected; otherwise say `implemented but unproven`.
- `Cleanup receipts`: runtime/browser/tmux/container/temp/port cleanup performed, or why none applied.
- `Ledger`: path and final status when a ledger-backed run was used.
- `Blocked/not verified`: missing auth, env vars, migrations, live access, flaky checks, or user decisions.
- `Next slice`: recommended next implementation step or stop condition.

## Validation Checklist

- Parent read local instructions, source artifact, current branch, and dirty state.
- Complexity gate chose a worker count that matches the job.
- Orchestration decision receipt explains worker count, skipped-worker rationale, visible-thread decision, and reconsider trigger.
- Every worker has one narrow duty and relevant skill/tool route.
- Every write-scoped `STANDARD`/`HIGH` worker produced a `DoneClaim`, and the parent accepted/rejected/unverified it explicitly.
- Implementation stayed inside selected scope.
- Contract gate named truth owner, boundary, displaced path, cutover, evidence, kill criteria, and forbidden moves before editing.
- Evidence tier, target evidence, triggered adversarial classes, and ledger decision were recorded before editing.
- No new dominant path remains without explicit cutover handling.
- Parent integrated worker results instead of forwarding them blindly.
- Focused tests/checks ran before broader validation.
- Triggered adversarial probes ran where required, especially malformed input, stale state, dirty worktree, misleading success output, and hung/long command risks.
- `HIGH` slices had an independent or parent-independent-enough `AdversarialVerify` pass before `verified`.
- UI changes were inspected in a running app/browser when applicable.
- Background browser checks include the required browser status receipt when used.
- Cleanup receipts exist for every runtime resource spawned during validation.
- Local/live/deploy/pushed states are separated.
- Goal stayed open through failed checks or unmet acceptance criteria.
- Goal did not close as `verified` without target-perspective acceptance evidence.

## Common Mistakes

- Treating implementation orchestration as planning and producing no code.
- Dispatching many workers with overlapping write scopes.
- Letting workers drift beyond the selected slice.
- Editing before reading the source artifact and repo instructions.
- Skipping `root-cause-investigator` when validation fails for unclear reasons.
- Claiming done after edits without running checks.
- Treating tests passed as product proof.
- Treating worker self-report as proof instead of a claim to verify.
- Applying adversarial probes to everything instead of only triggered risk classes.
- Recording `verified` while a server/browser/tmux/container/temp resource is still running or unaccounted for.
- Adding a ledger for tiny work where chat plus validation output is enough.
- Creating a second source of truth without cutover.
- Claiming live verification from local tests.
- Refactoring unrelated code while implementing an audit or plan slice.
- Continuing to implement when the plan is too vague instead of tightening the contract.

## Good Trigger Prompts

- "Use the implementation orchestrator to implement Phase 1 from docs/plans/app-ui-implementation-plan.md."
- "Consume this audit report, fix the P0/P1 findings, and loop until validation passes."
- "Use the implementation orchestrator for this UI revamp plan. Start with the layout and component-system slice."
- "Implement the RCA fix plan, verify it locally, and tell me what remains for live validation."
