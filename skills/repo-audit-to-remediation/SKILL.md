---
name: repo-audit-to-remediation
description: Audit a local repository, identify the highest-value defects or gaps, implement focused fixes, verify them, and leave a concise backlog or handoff. Use when the user asks for a codebase audit, comprehensive review, top priority issues, improvements, remediation plan, "fix the top issues", security/UX/performance/test/docs audit, repo health check, or an audit-to-patches workflow.
---

# Repo Audit To Remediation

Use this skill to turn a broad codebase review into verified, actionable engineering work without getting lost in generic audit checklists.

## Workflow

1. Establish scope.
   - Read repo docs, manifests, route/app entry points, CI config, deployment config, and existing audit/handoff docs.
   - Check `git status` before editing and preserve unrelated user changes.
   - If the user asked for read-only audit, do not edit files.

2. Build a repo map.
   - Identify stack, package manager, services, database/infrastructure, test commands, deployment target, and major user workflows.
   - Prefer existing tools and project conventions. Use CodeGraph first when an index exists and it will reduce file-reading.

3. Find issues with evidence.
   - Prioritize issues that affect production behavior, security, data integrity, user workflows, CI/build reliability, accessibility, or maintainability.
   - Ground each finding in files, commands, screenshots, logs, live checks, or dependency/config evidence.
   - Avoid "every possible best practice" lists. Keep only items that are real for this repo.

4. Decide remediation scope.
   - If the user asked for implementation, fix the smallest high-impact set first.
   - Prefer changes that unblock real usage or remove clear risk. Leave speculative refactors in the backlog.
   - Track what is fixed now, deferred, blocked, or requires credentials/live access.

5. Verify.
   - Run the repo's normal checks: lint, typecheck, tests, build, e2e, browser checks, or live smoke tests as appropriate.
   - For deployed apps, verify the live target when credentials and tooling allow it.
   - If verification is blocked, state exactly why and what command/check remains.

6. Report.
   - Lead with the concrete outcome, not the process.
   - Include changed files, tests run, deployment/live status, remaining risks, and the next highest-value task.

## Output Shape

For audit-only requests:

- `Findings`: ordered by severity and confidence.
- `Evidence`: specific file paths, behavior, logs, or live checks.
- `Recommended fixes`: practical and scoped.
- `Next steps`: short prioritized list.

For audit-and-fix requests:

- `Fixed`: what changed.
- `Verified`: commands/checks and results.
- `Remaining`: backlog items with priority.
- `Blocked`: missing access, unavailable services, or risky manual steps.

## Guardrails

- Do not create large audit documents unless the user asks for an artifact.
- Do not run destructive commands or reset user work.
- Do not claim "complete" without verification or an explicit note that verification was blocked.
- Do not replace focused remediation with broad architecture rewrites unless the repo evidence demands it.
