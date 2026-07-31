---
name: goal
description: "Use when the user invokes /goal, asks for Codex goal mode, or starts long-horizon autonomous work that should be refined into a concrete, verifiable goal contract before execution. Use for durable coding, debugging, research, migration, browser-testing, deployment-check, or data-review tasks where Codex should keep working until evidence proves completion or a real blocker remains."
---

# Codex Goal Mode

Use this skill to turn a rough `/goal` request into a durable completion contract. Improve the
goal's clarity, evidence, scope, and stop conditions. Do not change the user's intent.

## Prime Directive

Refine the goal, not the mission.

- Preserve the user's requested outcome and domain.
- Add verifiable completion criteria, constraints, and evidence requirements.
- Do not expand scope, add unrelated backlog, or turn a narrow fix into a broad audit.
- If a stronger goal would materially change the user's intent, ask before changing it.
- If the user is only asking how goal mode works, answer normally and do not create a goal.

## Preflight

Run this before calling `create_goal`, updating an active goal, or treating a `/goal` message as
the working objective.

1. Classify intent: explanation only, normal one-turn task, or durable goal.
2. Capture the draft in one sentence using the user's language.
3. Inspect context before asking when it is safely available:
   - local instructions such as `AGENTS.md`, README, package scripts, docs, and nearby patterns
   - repo, branch, status, failing command, route, host, database, logs, issue, PR, browser surface,
     or source files the user pointed at
   - memory only as routing context, never as proof for drift-prone state
4. Run the ambiguity gate. Infer safe defaults when the cost of being wrong is low.
5. Ask only questions that change the contract. Prefer one high-leverage question; ask up to three
   concise independent questions when needed.
6. Synthesize a compact objective with explicit evidence, scope, constraints, anti-cheat criteria,
   and final verification.
7. Start execution with `create_goal` when available and the contract is ready.

Do not ask "should I proceed" after the contract is clear unless the next step is destructive,
externally side-effectful, paid, credential-sensitive, or materially ambiguous.

## Ambiguity Gate

A goal is ready only when these fields are known or safely inferred:

| Field | Must answer |
| --- | --- |
| Outcome | What concrete artifact, behavior, metric, report, or state must exist? |
| Evidence | What command, screenshot, row, log, benchmark, deploy, file, or manual check proves it? |
| Scope | What is included, and what is explicitly excluded? |
| Starting point | Which repo, branch, files, URL, issue, PR, logs, failing check, or dataset should be inspected first? |
| Constraints | What dependencies, network calls, commits, PRs, migrations, deploys, paid services, auth, or data writes are allowed? |
| Anti-cheat | What would be a fake win, such as deleting tests, weakening requirements, hiding failures, changing unrelated behavior, or claiming unverified live coverage? |
| Progress | How should progress be visible: chat updates, status file, commits, PR, dashboard, artifact, or checkpoint notes? |
| Finalization | What cleanup, review, tests, browser checks, handoff, or deployment evidence is expected before completion? |
| Orchestration | Is the work parent-only, lightweight workers, full worker run, or visible-thread handoff; what worker/thread decision is expected? |
| Browser focus | Does browser work need a background-safe lane, and what surface/focus/durable-state constraints apply? |

Stop interviewing as soon as the missing fields are answered or safely inferable.

## Evidence Rules

Use concrete evidence as the completion authority.

- Validated locally: commands, tests, typecheck, lint, build, local browser checks, generated files.
- Verified live: authenticated browser behavior, production/staging routes, live rows, deployed logs,
  external API behavior, current docs, or current third-party state.
- Pushed/deployed: exact commit, branch, PR, deploy ID, host, environment, or migration status.
- Blocked: exact missing permission, auth, env var, rate limit, failing command, unavailable tool, or
  external state that prevents safe progress.
- Browser evidence: target URL/app/profile, browser surface used, passive/active/manual mode, auth/session state,
  durable state touched, focus interruption status, captured evidence, and next checkpoint.
- Orchestration evidence: worker count, worker scopes, skipped-worker rationale, visible-thread decision,
  parent verification, and reconsider trigger.

Never blur these states. Do not claim live, authenticated, pushed, deployed, or full E2E coverage
when only local or partial checks ran.

## Goal Contract Template

Use this shape when creating the objective:

```text
Goal: <single concrete outcome, preserving the user's intent>

Done when:
- <observable proof 1>
- <observable proof 2>

Scope:
- Include: <areas, files, routes, data, workflows>
- Exclude: <non-goals and unrelated cleanup>

Constraints:
- <allowed tools, side effects, dependencies, budget, auth limits>

Orchestration:
- Mode: <parent-only | lightweight workers | full worker run | visible-thread handoff>
- Worker/thread decision:
- Reconsider trigger:

Background browser:
- Needed: <yes | no>
- Target/surface:
- Focus and durable-state constraints:
- Required receipt:

Anti-cheat:
- <invalid shortcuts or misleading ways to claim success>

Execution notes:
- Start at <repo/branch/files/docs/tests/URLs/logs>
- Track progress via <chat updates/status file/commits/PR/artifact>

Final verification:
- Run <commands/checks/browser/manual verification>
- Report local vs live vs pushed/deployed status separately
- Clean up dead ends before marking complete
```

Keep the objective short enough to survive long runs, but specific enough that another agent can
decide whether it is complete from evidence.

## Good Goal Patterns

Prefer measurable and auditable goals:

- "Make the checkout benchmark p95 under 120 ms while the correctness suite stays green."
- "Migrate this feature to TypeScript strict mode without explicit `any`, verified by build and
  focused tests."
- "Investigate the production duplicate-delivery incident read-only first, prove the root cause
  from rows/logs/traces, then propose or implement the narrow fix."
- "Improve this UI against the provided reference, verified by desktop and mobile browser
  screenshots, without changing unrelated flows."

Avoid goals like:

- "Fix everything."
- "Make it better."
- "Improve UX" without target workflow, evidence, or boundaries.
- "Ship it" without deploy target and verification surface.

## Running The Goal

- If no active goal exists and `create_goal` is available, call it with the synthesized objective.
- If a token budget was provided, pass it exactly. Do not invent one.
- If the client already created an active goal from rough text, treat this skill's synthesized
  contract as the working contract unless the user explicitly wants to replace or clear the goal.
- If `create_goal` is unavailable, give the exact refined `/goal` payload and continue only if the
  user explicitly wants normal non-goal execution or the client exposes an active goal.
- After major chunks, check status when the goal tool is available and compare progress to the
  evidence requirements.
- If the same failure repeats, change the approach or narrow the evidence plan. Do not spin.
- Mark complete only after final verification exists.
- Mark blocked only when the blocker is specific, repeated, and no meaningful safe alternative
  remains under the contract.

## Finalization

Before reporting completion:

- Remove abandoned experiments, temporary files, and unrelated edits unless they are intentionally
  preserved and disclosed.
- Run focused verification. For code changes with meaningful risk, run review or a code-review pass
  when available.
- State exactly what was validated locally, verified live, pushed, deployed, blocked, and what the
  next action is if anything remains manual.
