---
name: root-cause-investigator
description: Root cause analysis for bugs, failures, regressions, incidents, broken flows, failing tests/builds/CI, production errors, or odd behavior. Use when the user says something is broken, failing, disappearing, timing out, returning errors, not loading, not working, behaving oddly, asks for root cause analysis/RCA, says "don't change anything yet", or wants diagnosis of UI, backend, auth, database, API, webhooks, logs, deploys, third-party integrations, CI, or production behavior. Start read-only, use logs/telemetry when available, narrow plausible causes to the proven cause, then produce a minimal fix plan.
---

# Root Cause Investigator

Use this skill when diagnosis must come before code changes. The goal is to prove the cause, not guess from symptoms.

## Default Stance

Start read-only. Do not edit files unless the user has already asked to fix it or later authorizes fixes.

If the user explicitly asks to use subagents or delegate the investigation and subagent tools are available, use a bounded explorer subagent for one independent question. Otherwise perform the investigation locally.

For large incidents or broad failures, create a short `/goal` only when it helps preserve the investigation ledger: symptom, time window, evidence sources, candidate causes, eliminated causes, confirmed root cause, fix plan, and verification state.

## Investigation Loop

1. Capture the symptom.
   - Restate the failing behavior in one sentence.
   - Note where it occurs: local, production, browser, CI, database, bot, API, worker, auth flow, or third-party integration.
   - Capture time window, affected users/accounts/routes/jobs, expected behavior, actual behavior, and last known good state when available.

2. Reproduce or inspect evidence.
   - Use the fastest reliable path: logs, failing test, browser console/network, database rows, API response, CI output, or command output.
   - If the project has a log system, telemetry, traces, error reporting, provider dashboard, or deploy logs, inspect those early and keep the query bounded to the relevant time window and surface.
   - For UI bugs, inspect both code and rendered behavior when possible.
   - For production bugs, distinguish local code from deployed config/state.
   - If the user references "since last time", "same thread", or a prior checkpoint, anchor the investigation to that checkpoint before widening the search.

3. Build a candidate-cause map.
   - List the plausible causes before narrowing. For non-trivial failures, aim for about five candidates when the surface supports it.
   - Common buckets: code-path regression, data/schema mismatch, auth/permissions/session state, env/config/secrets, deployment/build mismatch, cache/stale generated artifact, async timing/race/concurrency, external provider/rate limit/webhook behavior, browser/client state, and test/instrumentation error.
   - For each candidate, write the evidence that would confirm it and the fastest check that could disprove it.

4. Trace the flow.
   - Find the request/state path from user action to failure point.
   - Use CodeGraph when it can trace symbols or impact faster than manual grep.
   - Use `context7-mcp` when the cause may involve current library, SDK, API, CLI, framework, or cloud-provider behavior.
   - Check data assumptions, environment variables, auth/session state, caching, async timing, schema mismatch, and deployment packaging.

5. Narrow to the root cause.
   - Eliminate candidates with evidence, not preference.
   - Distinguish trigger, proximate error, contributing factor, and root cause.
   - If two causes remain plausible, run the cheapest decisive check before proposing a fix.
   - If the cause cannot be proven with available access, say exactly what evidence is missing and what check would resolve it.

6. Identify the root cause.
   - State the cause as a falsifiable explanation: "X fails because Y code/config/data causes Z."
   - Separate confirmed cause from plausible contributing factors.
   - Include the confidence level and exact evidence.

7. Propose the minimal fix.
   - Give the smallest fix that addresses the cause.
   - Mention tests or live checks needed to prove the fix.
   - If the user asked to fix, implement after the diagnosis and verify.

## Runtime-First Debugging Discipline

Prefer runtime evidence over plausible code reading when the failure is observable. A good debugging loop is:

1. observe or reproduce the failure;
2. list plausible hypotheses;
3. choose the cheapest decisive check for each serious candidate;
4. collect logs, traces, rows, command output, browser/network evidence, or runtime state;
5. eliminate or confirm hypotheses with evidence;
6. apply the smallest fix;
7. verify the same path now behaves correctly.

When feasible, capture red evidence before the fix and green evidence after it. If red evidence is not feasible, explain why and use the strongest available observation.

## Debug Artifact Journal

Track temporary debugging artifacts so they do not become hidden state:

- one-off scripts,
- scratch logs,
- exported rows,
- screenshots,
- local servers/watchers,
- browser profiles,
- temp directories,
- env overrides,
- diagnostic config files.

At closeout, delete temporary artifacts when safe or report exactly what remains and why. A leftover server, watcher, browser, or temp credential override blocks a clean `verified` status until accounted for.

## Evidence Sources

Prefer direct evidence over inferred explanations. Use the sources that fit the failure:

- Logs and telemetry: app logs, worker/function logs, request IDs, traces, error reporting, provider dashboards, queue/job logs, deploy logs, browser console, and network requests.
- Runtime state: database rows, migrations, RLS/policies, cache entries, queues, webhooks, feature flags, env vars, secrets presence, provider settings, and auth/session state.
- Code evidence: call paths, recent diffs, git history, configuration, generated artifacts, build output, tests, package versions, and deployment packaging.
- Product evidence: screenshots, live routes, reproduction steps, user account state, form payloads, API responses, and expected-vs-actual behavior.
- Current docs evidence: use `context7-mcp` or official docs for drift-prone library, framework, SDK, CLI, API, or cloud-provider behavior.

Record exact commands, queries, URLs, request IDs, timestamps, file paths, line references, and screenshots when they matter. If a check is unsafe or blocked, say so instead of substituting a guess.

## Production And Live-Data Mode

Use this mode for production incidents, duplicate deliveries, live scoring/data issues, auth failures, webhooks, third-party integrations, or any bug where deployed state may differ from local code.

1. Start read-only and identify the live surface: host, route, deploy ID, database/project, function/worker, queue, provider, and relevant time window.
2. Check deployed behavior, logs, rows, traces, metrics, error reports, deploy logs, or provider settings before changing code when those surfaces are accessible.
3. Keep live reads bounded. Prefer targeted sequential queries over broad parallel database pulls, especially through Supabase poolers or temporary credentials.
4. Separate:
   - `confirmed live evidence`: rows, logs, screenshots, traces, API responses.
   - `local code explanation`: files/functions that explain the live evidence.
   - `deployment/config gap`: env vars, feature flags, secrets, deploy artifacts, migrations, provider settings.
   - `not verified`: missing auth, unavailable logs, rate limits, or unsafe writes.
5. Do not treat current local source as the deployed source unless the commit/deploy relationship is verified.
6. If the remaining blocker is external time, provider behavior, auth, or account setup, stop code churn and hand off the exact proof or operator step required.

## Candidate-Cause Matrix

For anything beyond an obvious one-line failure, use a compact matrix while investigating:

| Candidate | Why plausible | Evidence checked | Result | Status |
| --- | --- | --- | --- | --- |
| Code-path regression | Recent change touches failing path | File/diff/test/log | Evidence summary | eliminated/confirmed/open |

Keep the matrix short and useful. It is a reasoning ledger, not a report-padding exercise. A good RCA usually shows several plausible paths narrowed to one cause.

## Output Shape

- `Symptom`: one sentence.
- `Impact/scope`: affected route, user, job, API, environment, time window, or workflow.
- `Timeline`: last known good, first known bad, relevant deploys/data changes/log timestamps when available.
- `Candidate causes considered`: compact list or matrix with eliminated/open/confirmed status.
- `Root cause`: concise and specific.
- `Evidence`: file paths, logs, commands, screenshots, API/database results.
- `Contributing factors`: only if supported by evidence.
- `Fix plan`: minimal steps.
- `Verification`: checks to run or checks already run, separated into local and live when relevant.
- `Debug artifacts`: temp scripts/logs/screenshots/servers/env overrides created and cleanup status.
- `Not verified/blockers`: any missing access, env vars, deploy proof, live rows/logs, or external state.

## Guardrails

- Do not patch first and explain later when the user asked for diagnosis.
- Do not stop at "probably" if there is a reasonable way to verify.
- Do not confuse the first visible error with the root cause.
- Do not fix all plausible candidates; narrow first, then fix the proven cause.
- Do not hide uncertainty. Label assumptions and missing access.
- Do not treat multiple symptoms as one bug until the shared cause is proven.
- Do not claim production proof from local tests alone.
- Do not run mutating live commands during RCA unless the user explicitly asked for the fix and the root cause is already proven.
- Do not ignore available logs, traces, deploy data, or runtime state in favor of reading code only.

## Good Trigger Prompts

- "Use root cause analysis. Something is failing in production; inspect logs and code before changing anything."
- "This route started returning 500s. Find the root cause, narrow the possible causes, and give me the minimal fix plan."
- "The UI works locally but not deployed. Diagnose the real cause and separate local evidence from live evidence."
- "The CI build started failing. Do an RCA and tell me the exact cause before editing."
