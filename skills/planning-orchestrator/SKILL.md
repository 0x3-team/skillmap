---
name: planning-orchestrator
description: Orchestrate research and save an implementation-ready plan file through a goal-backed planning loop for large product, UI/UX, architecture, migration, or implementation programs. Use when the user asks for a planning conductor/orchestrator, comprehensive revamp plan, /goal-backed plan, design plan from reference images, website/product inspiration research, multi-surface project plan, or a roadmap to hand to an implementation orchestrator. Do not use for small tasks, one-file changes, audits of existing defects, or when the user wants code edits immediately.
---

# Planning Orchestrator

## Purpose

Create a comprehensive, evidence-backed, implementation-ready plan for work that is too broad for one undifferentiated pass. The parent thread anchors the project, researches supplied websites/products/reference material, decides whether orchestration is warranted, creates a `/goal` when useful, delegates focused planning research, closes planning gaps through follow-up cycles, synthesizes a coherent plan, saves it as a Markdown artifact, and defines success criteria.

This is a planning skill. Default to read-only. The normal deliverable is a saved plan file plus a short chat summary with the file path. Do not edit code unless the user explicitly switches to implementation.

## When Not To Use

- The user asks for a direct fix, one component, one file, or one bug.
- The implementation path is already obvious and smaller than a planning document.
- The user wants an audit report of existing defects rather than a future-state plan; use `audit-orchestrator`.
- The user wants execution after a plan already exists; use an implementation orchestration skill when available.
- Subagents would mostly inspect the same material or produce duplicate strategy.

## Required Inputs

- Target repo/path, product surface, app route, host, branch, PR, or design artifact.
- Planning scope: UI/UX revamp, architecture, backend, security, data model, migration, product workflow, release path, or whole-project uplift.
- Desired outcome and quality bar, such as beta-ready, production-ready, launch-ready, or "turn a bad first draft into a serious app."

## Optional Inputs

- Reference images, screenshots, Figma links, competitor URLs, product websites, app/product names to research, product notes, user stories, PRDs, or brand/design constraints.
- Allowed tools and connectors: browser, image inspection, Magic UI, codegraph, Supabase, Cloudflare, Vercel, GitHub, docs search.
- Artifact path for the final plan. If omitted, choose a stable repo-local path.
- Constraints: timeline, stack, no-new-library rules, design system, deployment target, auth/data limits.

## Complexity Gate

Before dispatching workers, decide whether orchestration improves quality enough to justify coordination.

Use full orchestration when at least two are true:

- The plan spans three or more surfaces, such as UI, UX, data, backend, architecture, performance, security, release, or QA.
- The current product is a rough prototype and needs a coherent future-state design, not isolated tweaks.
- The task needs different expert lenses, such as frontend design, product workflow, technical architecture, data contracts, platform/deploy, QA, or accessibility.
- The user supplied reference images, websites, products, competitors, or external examples that must be researched and translated into local implementation guidance.
- The final output must be detailed enough for another agent to implement without re-discovering the strategy.
- The user explicitly asks for a conductor, orchestrator, subagents, `/goal`, or comprehensive plan.

Use lightweight mode when:

- The scope is one screen, one workflow, or one subsystem.
- The plan can be produced from direct repo inspection and one specialist lens.
- Subagents would create overhead without adding distinct evidence.

Worker count:

- `0 workers`: parent-only plan for small/narrow tasks.
- `1-2 workers`: one or two specialist lenses, such as design inspiration plus architecture constraints.
- `3-5 workers`: normal large planning run.
- `6-8 workers`: broad product/platform redesign with clearly separable surfaces.
- `9+ workers`: avoid unless the project is very large and the parent can still synthesize tightly.

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

- If the user explicitly asks for a conductor, orchestrator, workers, subagents, or parallel planning on a multi-surface task, default to at least `1` worker unless the parent states a concrete reason not to.
- If the plan spans three or more independent surfaces, default to `2-5` workers.
- If the task is narrow, parent-only mode is allowed, but the receipt must explain why workers would not improve evidence.
- Do not dispatch broad duplicate workers. More workers are useful only when each has a distinct evidence source, skill route, or planning responsibility.

Visible threads are not workers. Use workers/subagents for parallel planning evidence inside one parent-owned task. Create user-visible Codex threads only for explicit user-owned lanes, long-lived handoffs, separate worktrees, or follow-ups the user asked to manage directly. Do not use visible threads as hidden scratch space or as a generic context-limit workaround.

## Planning Workflow

1. Anchor the parent thread.
   - Read `AGENTS.md`, README, package scripts, PRD/roadmap/docs, current branch, git status, and relevant source structure.
   - Identify stack, run commands, deploy path, data store, auth, routing, design system, and primary user workflow.
   - Inspect current UI/product behavior when planning UI/UX, using screenshots/browser when feasible.

2. Research references and inspiration sources.
   - Inspect attached images or screenshots directly.
   - If the user names websites, products, competitors, docs, or examples, use browsing/search or the relevant connector/tool to inspect them directly when available.
   - Record the source URL/name, what was inspected, what is relevant, and what should not be copied.
   - Extract transferable design, product, interaction, architecture, content, onboarding, pricing, packaging, or workflow principles from references.
   - Treat research as input to local strategy, not as permission to clone another product.

3. Run the complexity gate.
   - Choose parent-only, lightweight mode, or full orchestration.
   - State the worker count and why.
   - Emit the orchestration decision receipt before planning synthesis.
   - Include whether visible thread creation is appropriate and why.
   - Include a reconsider trigger for adding workers if the plan broadens, evidence is missing, or the user explicitly challenges the worker decision.
   - Do not dispatch workers just because the skill was invoked.

4. Define the planning contract.
   - Convert the vague goal into a concrete future state.
   - Define what "good" means: user workflows, visual quality, performance, accessibility, data correctness, reliability, and release readiness.
   - State constraints, exclusions, assumptions, and evidence required.
   - Add a compact source-of-truth contract for implementation: intent, current behavior, expected outcome, truth owner, contract boundary, displaced path, cutover, acceptance evidence, evidence lane, kill criteria, and forbidden moves.
   - For narrow UI-only or content-only work, explicitly write `none` for displaced path, cutover, or contract fields that do not apply. Do not omit them.

5. Turn the plan into a goal and run the loop when appropriate.
   - If goal tooling is available and the user wants a durable planning run, create a goal for producing the plan, not for implementing it.
   - The goal must include scope, websites/products/references to inspect, worker plan, output artifact path, success criteria, anti-cheat rules, and stop conditions.
   - Treat the goal as the operating ledger for the planning run: record worker scopes, research sources inspected, open questions, planning gaps, artifact status, and done criteria.
   - After each worker cycle, compare returned evidence against the goal's success criteria.
   - If the plan is not implementation-ready yet, dispatch a narrower follow-up worker or inspect the gap in the parent thread.
   - Continue until the saved plan is complete enough for an implementation orchestrator, the remaining uncertainty is explicitly documented, or a real blocker prevents progress.

6. Decompose planning work.
   - Assign narrow planning research duties, not implementation tasks.
   - Each worker should inspect evidence and produce recommendations with rationale, dependencies, risks, and acceptance criteria.
   - Assign a relevant skill/tool route to every worker.
   - When external research is central to the task, create at least one research worker whose only job is to inspect the named websites/products and extract usable planning principles.
   - If browser work can proceed while the user is studying, meeting, or doing another primary task, add a `background-browser-operator` lane with target, surface, safety boundary, receipt, and stop condition.

7. Synthesize into one plan.
   - Merge recommendations into a coherent phased roadmap.
   - Resolve conflicts yourself from source evidence and product priorities.
   - Prioritize sequence: foundation before polish, data contracts before UI promises, core workflow before secondary screens.
   - Make the plan implementation-ready: files/areas, phases, tasks, acceptance criteria, validation commands, browser checks, and stop conditions.

8. Write the plan artifact.
   - Save the synthesized plan as a Markdown file by default.
   - Use the user-provided artifact path when available.
   - In a repo with `docs/`, prefer `docs/plans/YYYY-MM-DD-<slug>-implementation-plan.md`.
   - In a repo without `docs/`, prefer `plans/YYYY-MM-DD-<slug>-implementation-plan.md`.
   - Outside a repo or when no project-local path is appropriate, use `outputs/YYYY-MM-DD-<slug>-implementation-plan.md` under the current workspace.
   - Use patch-style edits to create or update the artifact.
   - Do not bury implementation decisions only in chat; the file must be the source of truth.

9. Deliver the plan.
   - Include current-state diagnosis only as much as needed to justify the plan.
   - Include research sources, future-state principles, phases, task lists, success criteria, validation, risks, and next action.
   - Link the saved plan file and summarize the highest-impact decisions.
   - Explicitly say that implementation has not started unless the user authorized edits.

## Goal Loop Contract

Use `/goal` as the continuity mechanism for large planning runs. The parent thread must keep ownership of the goal from kickoff to saved plan artifact.

Each loop should follow this rhythm:

1. `Plan`: state the next planning slice, worker scopes, inputs to inspect, and stop condition.
2. `Dispatch`: send narrow research/planning workers only where independent lenses will improve the plan.
3. `Collect`: receive worker recommendations with evidence, assumptions, dependencies, and validation ideas.
4. `Synthesize`: resolve conflicts and update the future-state plan.
5. `Gap check`: compare the draft plan against the artifact contract and success criteria.
6. `Continue or close`: run another focused cycle, mark explicit blockers, or write the final plan file.

Do not close the goal because workers returned or a plausible outline exists. Close only when the saved plan is detailed enough for a separate implementation orchestrator to start execution without rediscovering the strategy. If the planning run cannot complete, document the blocker precisely: missing repo access, missing design references, unclear product direction, unavailable live surface, missing auth, or user decision required.

Every orchestrated planning run should close with:

```text
Orchestration closeout:
- Workers actually used:
- Worker scopes:
- Worker results accepted/rejected/unverified:
- Parent verification:
- Gaps that would benefit from more workers:
- Visible thread considered:
```

## Research And Inspiration Handling

When the user says to search websites/products, get inspired, compare competitors, or research examples, make research an explicit planning slice.

For serious, drift-prone, contradictory, or implementation-bound research, use `verified-research` first and pass its dossier/claim ledger into this planner. Do not treat `likely`, `disputed`, `stale`, or `unverifiable` claims as planning facts.

Research workflow:

1. Normalize sources.
   - Turn product names into official sites when possible.
   - Prefer official product pages, docs, screenshots, pricing pages, changelogs, app store listings, repositories, or primary sources.
   - Use search only to find or verify sources; do not let generic listicles override direct product evidence.

2. Inspect each source with a purpose.
   - Capture the product category, target user, primary workflows, information architecture, interaction patterns, visual system, onboarding, empty/error states, pricing/packaging, and any relevant technical constraints.
   - For UI inspiration, inspect actual screens or screenshots when feasible, not only marketing copy.
   - For developer/platform plans, inspect official docs and current API behavior where relevant.

3. Extract transferable principles.
   - Convert observations into local design/product/technical principles.
   - Separate "adopt", "adapt", "avoid", and "not relevant" takeaways.
   - Explain why each takeaway fits or does not fit the user's product and constraints.

4. Preserve evidence.
   - Include source URLs/product names in the plan artifact.
   - Note access limits, paywalls, auth walls, stale screenshots, region differences, or unverified claims.
   - Do not quote large source passages; summarize in your own words.

5. Synthesize, do not copy.
   - Use research to raise the quality bar and define success criteria.
   - Do not clone branding, exact layouts, proprietary flows, or copyrighted copy.
   - If references conflict, choose based on the user's workflow, local architecture, and implementation feasibility.

## Worker Skill Routing

Each worker prompt must specify the skill/tool route.

Common routes:

- UI/UX future state, attached images, responsive layout, component behavior: `frontend-design`.
- Website/product inspiration, competitor research, reference synthesis: browser/search tools, official sources, product-design skills, and `frontend-design` for UI-specific interpretation.
- Landing-page polish or generic visual-quality cleanup: `mengtofrontend` when applicable.
- Product workflows, feature shaping, user jobs, MVP/beta scope: product-design or product/business-analysis skills when available.
- Code architecture, flow tracing, module boundaries, blast-radius planning, or unfamiliar repo onboarding: `codegraph`; let it check status and bootstrap/sync when appropriate instead of falling back immediately to broad grep/read loops.
- Backend/API/data contracts: backend, Supabase/Postgres, data-analytics, or repo-specific skills.
- Security/privacy/auth: security skills or platform auth docs.
- Cloudflare/Workers/Wrangler/D1/R2/Pages: Cloudflare and Wrangler skills.
- Performance: `web-perf`.
- Release, deployment, launch readiness: `production-readiness-gate`.
- Current platform/API/library/SDK/CLI/cloud-service behavior: `context7-mcp` first when available, then official docs or primary sources.
- Skill-library design, duplicate-skill decisions, or mining repeated workflows into durable skills: `workflow-mining-to-skills`.
- Browser work that should not interrupt the user: `background-browser-operator` as a support route, paired with the domain skill that owns the planning lane.

Do not force a skill when none fits. Use local repo instructions and direct evidence.

Worker use should improve evidence, not recreate ambient orchestration bloat. Prefer parent-only or a small number of distinct lanes when local files and existing plans already answer the question.

## Suggested Worker Lenses

For a major UI/UX revamp like a rough Electron file manager:

- `External research`: inspect named websites/products/competitors and extract adopt/adapt/avoid principles for this app.
- `Reference interpretation`: inspect attached images and extract applicable layout, density, hierarchy, motion, color, and interaction principles.
- `Product workflow`: define core jobs, navigation model, empty/loading/error states, power-user flows, and beta-ready scope.
- `Visual system`: typography, spacing, color, iconography, component rules, density, accessibility, and responsive/window behavior.
- `Interaction/components`: toolbar, sidebar, file list/grid, details panel, breadcrumbs, search/filter, selection, context menus, drag/drop, modals.
- `Technical architecture`: current Electron/frontend structure, state boundaries, data model, file-system constraints, testability, and risk.
- `QA/release`: success criteria, screenshot/browser checks, accessibility checks, build/type/lint/test commands, smoke scenarios.

Use fewer lenses when the task is narrower.

## Worker Prompt Template

```text
Read-only planning worker for <target>.

Planning scope: <one narrow lens>
Inputs to inspect: <files/routes/images/docs/URLs>
Exclusions: <what not to plan>
Skill/tool route: <specific skill(s), MCP/tool, or "local repo instructions only">

Required output:
- Research sources inspected, when applicable.
- Current-state observations relevant to this lens.
- Future-state recommendation.
- Transferable principles: adopt, adapt, avoid, not relevant.
- Concrete implementation tasks, grouped by dependency/order.
- Acceptance criteria for each major task.
- Risks, unknowns, and validation checks.
- Exact evidence: files, screenshots, docs, commands, routes, or references inspected.

Do not edit files. Do not produce generic advice.
```

## Plan Artifact Contract

The output must be a durable Markdown file that a later implementation orchestrator can consume. Chat output is a pointer and summary, not the primary artifact.

Use this structure unless the project already has a stronger planning template:

```markdown
# <Project Or Scope> Implementation Plan

## Planner Metadata
- Repository/path:
- Branch:
- Date:
- Planning mode:
- Worker scopes:
- References inspected:
- Research sources:
- Assumptions:

## Executive Goal

## Source Of Truth Contract
- Intent:
- Current behavior:
- Expected outcome:
- Truth owner:
- Contract boundary:
- Displaced path:
- Cutover:
- Acceptance evidence:
- Evidence lane:
- Kill criteria:
- Forbidden moves:

## Native Planning Superiority
- Codex Native baseline:
- What Skid does better:
- User-specific context used:
- Superiority score target:
- Proof artifacts:

## Orchestration Decision
- Mode:
- Worker count:
- Decision reason:
- Independent surfaces:
- Workers used or skipped:
- Thread decision:
- Reconsider trigger:

## Background Browser Lane
- Needed:
- Target/surface:
- Safety boundary:
- Required receipt:
- Stop condition:

## Research And Inspiration Findings

## Current State

## Future State

## Non-Goals

## Phase Plan

## Task Backlog

## Acceptance Criteria

## Validation Plan

## Risks And Dependencies

## Implementation Orchestrator Handoff
```

The `Implementation Orchestrator Handoff` section must include:

- The source-of-truth contract for the chosen implementation slice.
- The recommended first implementation slice.
- Phase order and dependency constraints.
- Files, routes, components, services, schemas, or docs likely to change.
- Allowed and disallowed changes.
- Required skills/tools for the implementation run.
- Required validation checks before claiming completion.
- Open questions that should block implementation versus questions that can be resolved during execution.
- Stop conditions and "do not claim complete until" criteria.
- A note that the future implementation orchestrator should turn the chosen slice into its own `/goal`, run implementation/validation cycles, and continue until the slice's acceptance criteria are satisfied or blocked.
- A note that implementation should not report `verified` unless target-perspective acceptance evidence is captured from the real route, payload, record, artifact, trace, rendered UI, or operator-visible output.

## Plan Output Format

- `Plan file`: absolute path, whether newly created or updated, and whether implementation has started.
- `Planning anchor`: repo/path, branch, product surface, stack, references and research sources inspected.
- `Mode decision`: parent-only, lightweight, or full orchestration; worker count and why.
- `Research findings`: source-by-source takeaways and adopt/adapt/avoid decisions.
- `Future-state vision`: concise target state and product principles.
- `Current-state diagnosis`: only the issues that shape the plan.
- `Phased roadmap`: phases ordered by dependency and impact.
- `Task breakdown`: concrete tasks with owners/surfaces/files where known.
- `Success criteria`: beta/production criteria per phase.
- `Validation plan`: commands, browser/screenshot checks, accessibility, performance, data, release checks.
- `Risks and unknowns`: missing access, unclear requirements, technical risks.
- `Implementation handoff`: exact first implementation slice, sequencing rules, required checks, and handoff notes for the implementation orchestrator.

## Plan Quality Bar

The final plan should be good enough that a separate implementation agent can start without asking what the product is supposed to become.

It must include:

- A saved Markdown plan file at an explicit path, not only chat text.
- Research sources and takeaways when external websites/products were part of the request.
- Clear scope and non-goals.
- A source-of-truth contract with owner, boundary, displaced path, cutover, evidence, kill criteria, and forbidden moves.
- Prioritized phases, not a flat wishlist.
- Concrete user workflows and screens/components.
- Acceptance criteria that can be verified.
- Acceptance evidence stronger than tests, diffs, or "implemented"; tests are supporting checks, not completion proof.
- Validation commands/checks tied to the repo.
- Dependencies and sequencing.
- Explicit assumptions and unknowns.
- A handoff section suitable for a future implementation orchestrator.
- Evidence that unresolved planning gaps were either closed through goal-loop follow-up or explicitly marked as blockers/assumptions.

## Native Planning Superiority Standard

`planning-orchestrator` must be materially better than a generic Codex Native planning outline for serious plans. It should beat the native baseline by anchoring source truth, using user-specific context, making worker/thread choices auditable, saving a durable artifact, and defining pass/fail validation.

Codex Native baseline risks to beat:

- Treating the visible prompt as the whole source of truth.
- Skipping repo, branch, browser, database, deploy, or session anchoring unless asked directly.
- Making an implicit parent-only decision without explaining why workers were skipped.
- Omitting user-specific preferences from prior sessions.
- Producing a chat-only plan that is not durable enough for implementation handoff.
- Listing phases without acceptance criteria, validation commands, blocker semantics, or closeout receipts.

Superiority scorecard:

- `0`: chat-only outline; not superior to native planning.
- `1`: has phases, but weak anchoring or no validation.
- `2`: has anchoring and validation, but no user-specific context or orchestration decision.
- `3`: implementation-ready plan with source anchoring, acceptance criteria, and validation.
- `4`: adds user-specific context, background/browser handling, blocker semantics, and orchestration receipts.
- `5`: fully superior plan: durable artifact, explicit native-baseline comparison, worker/thread decision, trace/eval criteria, and direct implementation handoff.

Target `4` by default. Require `5` for broad redesigns, audits that feed implementation, production-readiness plans, and any plan the user explicitly says should outperform Codex Native planning.

## Common Mistakes

- Producing a vague roadmap that sounds strategic but cannot be implemented.
- Over-orchestrating a small plan.
- Letting reference images become visual copying rather than product-appropriate principles.
- Copying another website/product instead of extracting transferable principles.
- Citing inspiration sources without saying what was actually inspected or how it shaped the plan.
- Planning UI polish before core workflows, state, and data contracts are clear.
- Mixing planning with edits and then claiming implementation progress.
- Giving every worker the same broad prompt.
- Returning only chat text when the user needs a reusable implementation plan file.
- Ending the planning goal while the saved file is still too vague for implementation.

## Good Trigger Prompts

- "Use the planning orchestrator to design a complete UI/UX revamp plan for this Electron app from these reference images."
- "Use the planning orchestrator to research these two websites and these two products, get inspired, and save a plan for our app."
- "This prototype is rough. Create a goal-backed, multi-agent plan to make it beta-ready."
- "Plan a full backend and frontend rebuild, with workers for architecture, data, UI, security, and release."
- "Act as conductor and save a comprehensive implementation-ready roadmap I can give to the implementation orchestrator."
