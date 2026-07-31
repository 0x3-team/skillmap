---
name: codex-conductor
description: Manual opt-in Codex conductor for Fugu-style model routing and worker review.
metadata:
  disable-model-invocation: true
---

# Codex Conductor

This is a user-invoked skill. Use it only when the user explicitly tags or names `codex-conductor` in the current task.

Manual invocation is the switch:

- Tagged: run the Codex Conductor loop for this task.
- Not tagged: stay normal Codex.
- Hard-disabled: if `/Users/stevmq/.codex/orchestration/state.env` says `CODEX_CONDUCTOR_HARD_DISABLED=1`, do not use external workers; explain the hard-off state and continue Codex-only unless the user asks to re-enable it.
- External workers: if `/Users/stevmq/.codex/orchestration/state.env` says `CODEX_CONDUCTOR_ALLOW_EXTERNAL_WORKERS=0`, keep the conductor Codex/local-skill only. Use external CLIs only after the user enables them with `conductorctl external-on` or explicitly asks for that run to use external workers.

## Contract

- Codex is the single user-facing entrypoint, coordinator, main implementer for high-risk work, and final authority.
- Sakana Fugu and external Orca are inspiration only. Do not buy, subscribe to, depend on, or route through them.
- Local Orca-named tooling, if present, is optional plumbing only. The conductor must work through Codex-owned decisions and local wrappers.
- Worker outputs are evidence, not completion. Every worker result returns to Codex for accept, improve, adapt, re-dispatch, or reject.
- Rejection starts a repair-delta loop, not a restart. Codex must identify the smallest wrong parts in the current artifact/diff/plan, issue targeted edits against that state, verify the correction, and then move to the next stage only after the current stage passes.
- Do not route secrets, raw env files, credentials, private tokens, production data, or unscoped private files to external workers.
- Do not spend paid credits or enable overage without explicit user approval.
- Do not use hooks, daemons, or ambient automation for this skill. This skill is manual opt-in only.

## Start

1. Check the hard-off state:

```bash
/Users/stevmq/.codex/orchestration/bin/conductorctl status
```

If hard-disabled, stay Codex-only unless the user asks to enable the conductor.

2. Read the local roster:

```text
/Users/stevmq/.codex/orchestration/model-roster.yml
```

Use it as routing guidance, not proof of current auth or quota. Re-verify drift-prone access before relying on a worker.

3. Run the local router for non-trivial tasks before selecting workers:

```bash
/Users/stevmq/.codex/orchestration/bin/conductorroute route "<task text>"
```

The router does not invoke models. It decomposes the task into slices, assigns Thinker/Worker/Verifier roles, filters by safety/access/risk, then selects the highest quality model for each slice. If quality scores are exactly tied, it chooses the cheaper model; if cost is also tied, it chooses lower latency.

4. For tasks that may use external workers, check runtime discovery state:

```bash
/Users/stevmq/.codex/orchestration/bin/conductordiscover status
```

If the model list is stale or a provider state is uncertain, run discovery. `discover` lists models; `discover-canary` also runs minimal canaries and requires external workers to be enabled.

```bash
/Users/stevmq/.codex/orchestration/bin/conductorctl discover
```

If a selected model returns a rate-limit, quota, auth, or canary failure, immediately mark it in runtime status before rerouting:

```bash
/Users/stevmq/.codex/orchestration/bin/conductordiscover mark MODEL_ID rate_limited --reason "provider limit" --cooldown 3600
```

Do not delete models from the roster when they fail. Mark them temporarily unavailable in `model-status.yml`; the router will exclude them until cooldown expiry or the next successful discovery.

5. Anchor the task:

- repo/path, branch/worktree, route/host, data/auth/deploy target
- user goal, risk level, evidence required, stop conditions
- whether delegation is worth the overhead

## Routing

- Use `/Users/stevmq/.codex/orchestration/routing-policy.yml` as the current model-selection policy.
- Every eligible model in the roster should be considered for each slice, but only selected after safety, auth, external-worker, risk, and evidence-gate filters.
- Quality dominates cost. Cost only wins when the policy score is tied exactly for the slice.
- Use cheaper models for tied commodity slices, but keep Codex for source-truth anchoring, high-risk work, and final verification unless the router produces a better local benchmark-backed rule.
- Codex: final judgment, source-truth anchoring, architecture, production-risk code, high-risk implementation, verification, final answer.
- GLM 5.2 via ClinePass: UI/UX design critique, frontend taste, layout alternatives, responsive polish, accessibility review.
- Gemini 3.1 via Antigravity: multimodal product review, screenshots, visual reasoning, long-context synthesis, Google ecosystem tasks.
- Grok Build: auth-gated coding-agent worker only after auth and local pilot; useful for plan-first implementation, MCP/debugging, alternate coding approaches. Do not treat it as benchmark-proven best.
- Other ClinePass models: cheap variants, bulk review, mechanical alternatives.
- Claude free: opportunistic copy, UX microcopy, adversarial text critique when available.

## Worker Commands

Use configured wrappers rather than calling third-party CLIs ad hoc when possible:

```bash
/Users/stevmq/.codex/orchestration/bin/antigravity-worker models
/Users/stevmq/.codex/orchestration/bin/antigravity-worker smoke
/Users/stevmq/.codex/orchestration/bin/antigravity-worker print -- "bounded prompt"
/Users/stevmq/.codex/orchestration/bin/grok-worker models
/Users/stevmq/.codex/orchestration/bin/grok-worker smoke
/Users/stevmq/.codex/orchestration/bin/grok-worker print -- "bounded prompt"
/Users/stevmq/.codex/orchestration/bin/cline-worker models
/Users/stevmq/.codex/orchestration/bin/cline-worker smoke
/Users/stevmq/.codex/orchestration/bin/cline-worker print -- "bounded prompt"
/Users/stevmq/.codex/orchestration/bin/hermes-xai-worker models
/Users/stevmq/.codex/orchestration/bin/hermes-xai-worker smoke
/Users/stevmq/.codex/orchestration/bin/hermes-xai-worker print -- "bounded prompt"
```

The Antigravity wrapper uses `/Users/stevmq/.local/bin/agy` and defaults to `Gemini 3.1 Pro (High)`.
The Grok wrapper uses `/Users/stevmq/.local/bin/grok`, disables Grok memory and web search by default, and defaults to `grok-build`.
The Cline wrapper uses `/Users/stevmq/.npm-global/bin/cline`, disables auto-approve, and defaults to `zai/glm-5.2` with `xhigh`.
The Hermes xAI wrapper uses `/Users/stevmq/.local/bin/hermes` with `xai-oauth` and defaults to `grok-4.3`; it is a separate surface from Grok Build CLI.
`smoke` and `print` must respect `CODEX_CONDUCTOR_ALLOW_EXTERNAL_WORKERS`.

## Skill Routing Points

Use relevant local skills inside the conductor loop before selecting external model workers:

- `codegraph`: architecture tracing, impact analysis, symbol lookup, cross-file flow, or unfamiliar repo onboarding.
- `frontend-design`: UI/UX, visual polish, layout, responsive behavior, design-to-code, or component quality.
- `visual-qa`: screenshot/browser/TUI verification after frontend or visual changes.
- `engineering-acceptance-review`: independent acceptance pass after meaningful generated code, UI changes, refactors, bug fixes, or implementation plans.
- `root-cause-investigator`: failures, regressions, broken flows, incidents, failing tests, or unclear cause before proposing a fix.
- `context7-mcp`: current docs for libraries, frameworks, SDKs, APIs, CLIs, and cloud services.
- `verified-research`: benchmark, provider, or evidence-backed research before changing routing policy.
- `implementation-orchestrator`: broad multi-surface implementation after a plan exists and the user asks to execute it.

## Loop

1. Decide: Codex-only, one specialist, or supervised multi-worker.
2. Decompose the request into factual/work slices: source truth, research, UI/UX, backend/code, multimodal/product, security/incident, and final verification as applicable.
3. Assign role: Thinker, Worker, or Verifier.
4. Route to relevant skills first when a local skill can inspect, design, verify, research, or diagnose the slice.
5. Use `conductorroute` to consider all eligible models for the slice and choose the best-quality model with cheapest exact-tie fallback.
6. Write a bounded worker contract: role, scope, non-goals, allowed files/data, evidence required, return format, and stop rules.
7. Dispatch only if the worker adds concrete value over Codex doing the work directly.
8. Collect the worker output and classify it as accepted, useful-but-needs-edit, unsupported, risky, or rejected.
9. If rejected or incomplete, run a repair-delta loop:
   - preserve the current artifact/diff/transcript as the base
   - list only the failing claims, missing evidence, or wrong edits
   - issue targeted corrections to Codex or a worker against that base
   - verify the corrected slice
   - repeat until the slice passes or a blocker is proven
10. Advance to the next stage only after the current slice passes its evidence bar. Do not restart from the original prompt unless the current base is unrecoverable or the user explicitly asks to restart.
11. Verify accepted claims from source truth: files, tests, browser, logs, rows, command output, screenshots, or live surfaces as appropriate.
12. Final response must distinguish validated locally, verified live, pushed, deployed, blocked, and next step.

## Repair-Delta Packet

When a slice is rejected or incomplete, create a compact packet before any correction:

```text
base: current artifact/diff/transcript/checkpoint
stage: current stage name
status: rejected | incomplete | unverifiable
failing_items:
  - exact claim/edit/evidence gap
keep:
  - parts that are accepted and must not be rewritten
repair_instruction:
  - smallest targeted edit or verification needed
owner: Codex | selected worker lane
verification:
  - command, source file, browser check, screenshot, log, row, or doc check that proves the repair
next_stage_gate:
  - condition required before moving forward
```

Do not ask a worker to redo the whole task unless `base` is unrecoverable.

## No-Hooks Rule

Hooks are not part of v1. They would only be justified later for a concrete automatic safety requirement, such as blocking secret leakage in a specific repo or enforcing a receipt before a known deploy command. Until then, hooks add hidden behavior and are out of scope.

## Benchmarking

Use the local benchmark harness when the user asks whether the conductor is helping or whether a task class should use it by default:

```bash
/Users/stevmq/.codex/orchestration/bin/conductorbench new <slug>
```

Benchmark contract:

- Compare `baseline_codex` against `conductor_skill` using the same `task.md`.
- Run baseline without the `codex-conductor` tag.
- Run conductor with the manual `codex-conductor` tag.
- Keep the starting repo/worktree, route, source artifacts, evidence bar, and time budget equivalent.
- Score correctness, evidence quality, completeness, missed issues, false positives, repair efficiency, safety/scope control, and operator effort.
- Treat secret leakage, unapproved paid overage, unexpected production changes, or unverified completion claims as hard failures regardless of score.
- Update routing guidance only after repeated comparable runs show a consistent advantage for the conductor or for a specific skill/worker lane.

## Closeout

Report:

- whether the conductor stayed Codex-only or delegated
- which workers/lane were used, if any
- evidence collected
- validation run
- what remains manual, blocked, or unverified
