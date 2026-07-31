---
name: resume-disconnected-work
description: Resume disconnected, stale, or out-of-context Codex work from available local evidence. Use when the user says to resume, continue previous work, recover a lost thread, check whether prior work was done, or continue after a disconnect. Do not use for a normal fresh task with a clear current repo and no prior-state dependency.
---

# Resume Disconnected Work

## Purpose

Reconstruct the current source of truth from artifacts, logs, memory, git state, and live surfaces before continuing work. The output should make it clear what is already verified, what is stale or unverified, and what the next safe action is.

## Required Inputs

- User's latest request and any repo/path/thread/host they mention.
- Accessible local evidence: `AGENTS.md`, README/docs, git state, saved reports, task plans, session logs, memory registry, browser surfaces, CI/deploy output, database/log evidence when available.

## Optional Inputs

- Prior thread ID, PR number, issue, deploy ID, branch name, route, host, database project, or artifact path.
- Explicit permission to continue implementation, deploy, commit, or mutate external state.

## Workflow

1. Re-anchor on the current target.
   - Identify the repo/path, branch, route/host, database, live product, issue/PR, or browser surface.
   - If the target is ambiguous, inspect likely local sources before asking. Ask only when choosing wrong would be costly.

2. Inventory available prior-state sources.
   - Check `git status`, recent commits, local docs, task plans, saved reports, TODOs, and project-specific `AGENTS.md`.
   - Search session/memory/log sources only as routing evidence. Recheck drift-prone facts before relying on them.
   - Prefer exact artifacts over narrative summaries.
   - If the old thread points into an iCloud/File Provider-backed path, a stale worktree, or a repo that may have placeholder files, run bounded repo-health probes before assuming history is missing or the app state is corrupt.
   - For suspicious local checkouts, check whether `git rev-parse --show-toplevel`, `git status --short --branch`, package metadata reads, and key source/data files return promptly. Treat hung Git or dataless placeholder files as workspace-health blockers, not product conclusions.
   - If `.git` metadata, `package.json`, build assets, generated data, or runtime modules appear cloud-backed/dataless, report that as the current blocker and prefer a non-iCloud working copy or explicit hydration before editing.

3. Separate state categories.
   - `validated locally`: commands, tests, build, screenshots, generated artifacts.
   - `verified live`: authenticated browser behavior, live rows/logs, production/staging route checks, current third-party state.
   - `pushed/deployed`: commits, PRs, tags, deploy IDs, migration status.
   - `blocked/not verified`: missing auth/env/permissions, unavailable services, skipped checks, external wait gates.

4. Reconcile dirty work.
   - Preserve unrelated user changes.
   - If the worktree changed since the prior evidence, treat previous conclusions as stale until rechecked.
   - For concurrent or unknown changes, review before committing or continuing.

5. Continue from the first unblocked next step.
   - If the user asked to implement, move into code only after the verified state and blockers are clear.
   - If the remaining task is external/operator-bound, stop code churn and hand off exact next actions.

## Output Format

- `Anchor`: repo/path, branch, host/route, database, PR/issue, or thread if known.
- `Recovered state`: concise bullets with evidence.
- `Validated locally`: commands/checks and results.
- `Verified live`: live checks and results, or `not verified`.
- `Pushed/deployed`: commit/PR/deploy status, or `not pushed/deployed`.
- `Blocked/not verified`: exact blockers.
- `Next action`: the single safest next step or a short ordered list.

## Validation Checklist

- Current repo/branch and dirty state checked when a repo exists.
- Workspace health checked when the recovered `cwd` is old, iCloud-backed, slow, or has placeholder symptoms.
- Prior claims rechecked if they depend on live state, deploy state, database rows, pricing, docs, auth, or time.
- Local, live, pushed/deployed, and blocked states are not blended.
- Any manual handoff includes exact ordered steps.

## Common Mistakes

- Treating memory or a prior summary as proof of current production state.
- Restarting an old audit from scratch when artifacts already contain verified work.
- Treating hung Git commands, iCloud placeholder files, or stale thread `cwd` failures as missing project work.
- Claiming a task is complete because local checks passed while live auth, migration, or deploy gates remain.
- Committing a mixed dirty worktree without separating reviewed changes from new user/concurrent changes.

## Good Trigger Prompts

- "Resume the previous thread and make sure we did not lose work."
- "Continue after the disconnect and tell me what is verified versus blocked."
- "Pick up from the audit we were doing yesterday."
- "Check whether this was already pushed/deployed before continuing."
