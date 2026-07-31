---
name: audit-orchestrator
description: Orchestrate a scoped, goal-backed multi-agent audit loop from one parent thread only when the audit is large or complex enough to benefit from delegation. Use when the user asks for an audit conductor/orchestrator, scoped audit plan, UI/UX/backend/security/performance/product audit with subagents, or wants an audit plan turned into /goal and iterated until done criteria are satisfied. Do not use for small one-file reviews, narrow bug checks, or implementation-first work; use a direct audit/review instead.
---

# Audit Orchestrator

## Purpose

Run a serious audit as a parent-thread program: define scope, turn it into a verifiable `/goal` contract, dispatch narrow independent audit workers, collect evidence, deduplicate findings, close coverage gaps through follow-up cycles, and produce one actionable report.

This is an audit skill. Default to read-only. Do not implement fixes unless the user explicitly switches from audit to remediation.

## When Not To Use

- The task is a normal code review, single-file inspection, or small bug diagnosis.
- The user already knows the exact fix and wants implementation.
- The audit cannot be scoped to a product surface, subsystem, workflow, or risk category.
- Subagents/tools are unavailable and the audit is small enough for one agent to do directly.
- The audit can be completed well by one agent in one pass with fewer than three distinct inspection surfaces.

## Required Inputs

- Target repo/path, branch, app route, host, PR, issue, or product surface.
- Audit scope, such as UI/UX, backend, security, performance, data, architecture, release readiness, or a named workflow.
- Whether the audit is read-only or may create a report artifact.

## Optional Inputs

- Priority standard: launch blocker, production risk, polish, compliance, product quality, cost, performance, or maintainability.
- Surfaces to include/exclude.
- Desired report format or artifact path.
- Permission to use live authenticated surfaces, browser checks, databases, CI, or external APIs.

## Complexity Gate

Before invoking subagents, decide whether orchestration will improve quality enough to justify overhead.

Use this skill fully when at least two of these are true:

- The audit spans three or more distinct surfaces, such as UI, API, database, auth, deploy, security, or performance.
- The repo/product is large enough that one broad pass is likely to miss issues.
- The user explicitly asks for a conductor, orchestrator, subagents, parallel audit, or goal-backed audit program.
- The audit needs different expert lenses, such as frontend design, security, backend contracts, release readiness, or data integrity.
- Findings must be synthesized into an evidence-backed report for implementation planning.
- There is prior context, a disconnect, or multiple worker threads to reconcile.

Use a direct single-agent audit instead when:

- The scope is one file, one component, one route, one failing behavior, or one small UI area.
- The expected output is a short answer, quick code review, or small issue list.
- Subagents would mostly inspect the same files or duplicate each other.
- The overhead of coordination would exceed the likely quality gain.

If the user explicitly asks to use this skill but the job is small, say so and run a lightweight mode: one parent-only audit, no subagents, same evidence standard.

## Worker Scaling

Scale workers to the job, not to a fixed template.

- `0 workers`: tiny or narrow audit; parent does it directly.
- `1-2 workers`: small but cross-cutting audit; use workers for independent specialist checks only.
- `3-5 workers`: normal orchestrated audit across distinct scopes.
- `6-8 workers`: large audit with clearly separable product, code, data, security, and release surfaces.
- `9+ workers`: avoid by default; only use when the repo is very large, scopes are truly independent, and the parent can still verify synthesis.

Prefer fewer, sharper workers. Add a worker only when it has a distinct evidence source, skill lens, or product surface.

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

- If the user explicitly asks for an audit conductor, orchestrator, workers, subagents, or parallel audit on a multi-surface task, default to at least `1` worker unless the parent states a concrete reason not to.
- If the audit spans three or more independent surfaces, default to `2-5` workers.
- If the audit involves security, release readiness, production validation, data integrity, or authenticated browser behavior, prefer a separate specialist or validation worker when available.
- Parent-only audit is allowed for narrow scopes, but the receipt must explain why workers would not improve evidence or coverage.
- Do not dispatch broad duplicate workers. More workers are useful only when each has a distinct evidence source, skill lens, product surface, or validation responsibility.

Visible threads are not audit workers. Use workers/subagents for bounded audit coverage inside one parent-owned task. Create user-visible Codex threads only for explicit user-owned lanes, long-lived handoffs, separate worktrees, or follow-ups the user asked to manage directly. Do not use visible threads as hidden scratch space or as a generic context-limit workaround.

## Orchestration Workflow

1. Anchor the parent thread.
   - Read `AGENTS.md`, README, package scripts, relevant docs, current branch, and dirty state.
   - Identify repo, route/host, database, deploy platform, test commands, and the product workflow under audit.
   - Preserve unrelated user work. Start read-only.

2. Run the complexity gate.
   - Decide direct audit, lightweight mode, or full orchestration.
   - State the chosen worker count and why.
   - Emit the orchestration decision receipt before collecting audit evidence.
   - Include whether visible thread creation is appropriate and why.
   - Include a reconsider trigger for adding workers if coverage is incomplete, evidence conflicts, or the user challenges parent-only mode.
   - If full orchestration is not justified, do not dispatch workers just because the skill was invoked.

3. Define the audit contract.
   - Convert the user scope into a bounded audit plan with inclusion/exclusion rules.
   - State evidence required for findings: file references, screenshots, tests, logs, rows, traces, build output, or live checks.
   - Define severity labels and what counts as a blocker.

4. Turn the plan into a goal and run the loop.
   - If goal tooling is available and the user asked for an orchestrated audit run, create a compact goal contract before dispatching workers.
   - The goal must include: scope, evidence standard, worker plan, read-only default, report format, anti-cheat rules, and stop conditions.
   - Treat the goal as the operating ledger for the audit: record worker scopes, completed checks, unresolved gaps, blocked checks, and report status.
   - After each worker cycle, compare the evidence against the goal's done criteria.
   - If coverage is incomplete, dispatch a narrower follow-up cycle or inspect the gap in the parent thread.
   - Continue until the audit satisfies the done criteria, the remaining gaps are explicitly out of scope, or a real blocker prevents progress.
   - Do not create a goal for a tiny audit or explanation-only request.

5. Decompose into workers.
   - Assign one narrow duty per worker. Avoid broad duplicate prompts.
   - Use parallel workers only for independent surfaces. Keep live database/API reads bounded and avoid noisy parallel production queries.
   - Assign each worker a relevant skill/tool route when one exists; if none fits, state that the worker should use local repo instructions and general audit discipline.
   - For browser evidence that should not interrupt the user, route the browser lane through `background-browser-operator` and keep the audit read-only.

6. Dispatch worker prompts.
   - Give each worker the minimum context needed: target, exact scope, read-only rule, evidence standard, output schema, and exclusions.
   - Do not leak expected findings or parent conclusions.
   - Tell each worker which skill(s) to load or consider for its job.
   - Require exact file paths, line references, commands, screenshots, live checks, or logs for every claim.

7. Synthesize results.
   - Deduplicate overlapping findings.
   - Resolve conflicts by checking source evidence yourself in the parent thread.
   - Reject unsupported or generic best-practice findings.
   - Classify each valid finding by severity, confidence, affected workflow, evidence, and recommended fix.

8. Produce the audit report.
   - Lead with highest-risk findings.
   - Separate confirmed issues from candidates, blocked checks, and out-of-scope observations.
   - Include a remediation backlog only after the audit findings are clear.
   - If the next step is implementation, propose a separate implementation orchestration plan rather than silently switching modes.

## Goal Loop Contract

Use `/goal` as the continuity mechanism for orchestrated audits. The parent thread must keep ownership of the goal from kickoff to final report.

Each loop should follow this rhythm:

1. `Plan`: state the next audit slice, worker scopes, evidence required, and stop condition.
2. `Dispatch`: send narrow worker tasks only where independent evidence will improve quality.
3. `Collect`: receive worker reports with exact evidence and blockers.
4. `Verify`: parent checks high-risk claims and rejects unsupported findings.
5. `Gap check`: compare coverage against the goal's done criteria.
6. `Continue or close`: run another focused cycle, mark explicit blockers, or produce the final report.

Do not close the goal just because workers returned. Close only when the report meets the evidence standard and the original order is satisfied. If the audit cannot complete, mark the remaining blocker precisely: missing auth, missing env vars, unavailable surface, rate limit, unclear scope, or user decision required.

Every orchestrated audit should close with:

```text
Orchestration closeout:
- Workers actually used:
- Worker scopes:
- Worker results accepted/rejected/unverified:
- Parent verification:
- Gaps that would benefit from more workers:
- Visible thread considered:
```

## Worker Skill Routing

Each worker should use the best available skill or tool for its duty. Include the route in the worker prompt.

Examples:

- UI/UX, visual polish, responsive layout, design systems: use `frontend-design`; use Magic UI only when relevant to the product type.
- Performance and Core Web Vitals: use `web-perf`.
- Bug/incident/root-cause checks: use `root-cause-investigator`.
- Launch/deploy/release readiness: use `production-readiness-gate`.
- Code architecture, flow tracing, impact analysis: use `codegraph` when available and indexed.
- Security review: use available security skills/tools, repo security docs, and read-only evidence.
- Database/schema/RLS/data integrity: use Supabase/Postgres/data skills when applicable.
- Cloudflare/Workers/Wrangler surfaces: use Cloudflare, Workers, Durable Objects, or Wrangler skills as applicable.
- Browser evidence that should not interrupt the user: use `background-browser-operator` as a support route, paired with the audit lens that owns the finding.

Do not force a skill if it does not fit. The parent should prefer exact evidence over skill branding.

## Worker Granularity

Prefer worker scopes that are small enough for one agent to do thoroughly:

- UI/UX: buttons, forms, navigation, responsive layout, typography, design system drift, accessibility, empty/error/loading states.
- Backend: API contracts, auth/session behavior, data validation, error handling, observability, rate limits.
- Data: schema drift, migrations, RLS/policies, stale/generated data, reconciliation, retention.
- Security: secrets, authz/authn, input handling, unsafe dependencies, deployment exposure, audit logs.
- Release: CI/build/test state, migrations, env vars, deploy status, live smoke, rollback.
- Architecture: module boundaries, duplication, ownership, performance hot paths, long-term maintainability.

Do not split so far that workers cannot understand the workflow. A "button audit" is useful only if the worker can still inspect the screen/context where buttons operate.

## Parent Goal Template

```text
Goal: Complete a read-only <scope> audit of <target> and produce an evidence-backed report.

Done when:
- Parent thread records target, branch/host, scope, exclusions, and evidence standard.
- Focused audit workers complete their assigned scopes or report exact blockers.
- Parent verifies or rejects worker findings from source evidence.
- Parent runs follow-up cycles for unresolved coverage gaps that remain in scope.
- Final report lists confirmed findings by severity, candidates, blocked checks, and next remediation steps.

Anti-cheat:
- No implementation unless explicitly authorized.
- No generic best-practice findings without repo/live evidence.
- No live/auth/deploy claims without direct verification.
- No broad duplicate worker prompts.
```

## Worker Prompt Template

```text
Read-only audit worker for <target>.

Scope: <one narrow duty>
Exclusions: <what not to inspect>
Skill/tool route: <specific skill(s) or "local repo instructions only">
Use the routed skill(s) when available, plus project AGENTS.md/README/package scripts.

Required output:
- Findings: severity, confidence, exact evidence, affected workflow, recommended fix.
- Checks run: commands, browser checks, logs, rows, files inspected.
- Blocked/not verified: exact missing access/tooling/data.
- No generic advice. Do not edit files.
```

## Report Format

- `Audit anchor`: repo/path, branch, host/route, database/deploy surface, scope.
- `Mode decision`: direct audit, lightweight mode, or full orchestration; worker count and why.
- `Workers dispatched`: worker name, scope, status, blockers.
- `Orchestration closeout`: workers used, results accepted/rejected/unverified, parent verification, gaps that would benefit from more workers, and visible-thread decision.
- `Findings`: severity-ranked confirmed findings with exact evidence.
- `Candidates`: plausible issues needing more evidence.
- `Blocked checks`: auth, env, data, live access, tooling, rate limits.
- `No-action areas`: areas checked and found acceptable.
- `Remediation backlog`: ordered, scoped next fixes.
- `Recommended next step`: continue audit, start implementation orchestration, or stop at handoff.

## Severity Guide

- `P0`: active production breakage, data loss, security exposure, or launch-blocking primary workflow failure.
- `P1`: serious user workflow, auth, data integrity, deploy, or operational risk.
- `P2`: meaningful quality, maintainability, accessibility, performance, or reliability issue.
- `P3`: polish, documentation, or low-risk cleanup.

## Validation Checklist

- Parent read local instructions and current repo state before dispatching.
- Parent ran the complexity gate and chose an appropriate worker count.
- Orchestration decision receipt explains worker count, skipped-worker rationale, visible-thread decision, and reconsider trigger.
- Every worker has one narrow duty and a required output schema.
- Every worker prompt includes the relevant skill/tool route or explicitly says none applies.
- The audit plan was converted into a goal when appropriate.
- The parent used goal status to continue unresolved in-scope checks instead of ending after the first worker return.
- Final report separates confirmed, candidate, blocked, and out-of-scope items.
- Parent verified high-severity findings instead of forwarding worker claims blindly.
- Background browser checks include the required browser status receipt when used.

## Common Mistakes

- Dispatching several agents with the same broad prompt and merging noisy reports.
- Over-orchestrating small audits that one agent can handle cleanly.
- Picking a fixed number of agents before understanding the scope.
- Letting audit workers implement changes during a read-only audit.
- Treating a worker's unsupported opinion as a finding.
- Forgetting to distinguish local validation, live verification, pushed/deployed state, and blockers.
- Creating a report so broad that it cannot turn into an implementation plan.
- Ending the audit loop while in-scope coverage gaps remain unresolved.

## Good Trigger Prompts

- "Act as the audit orchestrator for this repo and split the UI/UX audit across subagents."
- "Create a scoped backend audit plan, turn it into a goal, and delegate focused checks."
- "Run a conductor-style security audit and synthesize the worker reports."
- "Audit the dashboard deeply: one worker for buttons, one for layout, one for design consistency, one for accessibility."
