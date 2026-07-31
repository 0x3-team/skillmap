---
name: release-handoff-summary
description: Summarize latest changes, release readiness, deployment state, verification status, changelog notes, documentation updates, and remaining next steps. Use when the user asks "what changed", "latest changes", "what is left", "next tasks", "release prep", "changelog", "handoff", "status update", "are we ready to ship", "summarize this project", or wants a concise done/left/blocked plan after implementation.
---

# Release Handoff Summary

Use this skill to produce a practical project status summary that another engineer, future Codex session, or the user can act on immediately.

## Workflow

1. Inspect current state.
   - Run `git status`.
   - Review recent commits with `git log --oneline -5` and the latest relevant diff.
   - Check changed files, docs, migrations, tests, and deployment config.

2. Check verification and deployment.
   - Identify tests/build/lint/e2e commands that were run or should be run.
   - For deployed apps, check Vercel/Cloudflare/Supabase/GitHub status when available.
   - Distinguish local code state from production state.
   - For launch or production-readiness asks, use the `$production-readiness-gate` skill when it is available.

3. Find handoff artifacts.
   - Look for `README`, `CHANGELOG`, `docs/*HANDOFF*`, `docs/audits/*`, release notes, task docs, migration docs, and CI output.
   - Update docs only if the user asked for a written artifact or the current task requires it.

4. Produce a concise handoff.
   - Prefer current facts over narrative.
   - Include exact commits, branch, deploy URL, tests run, and remaining tasks when known.
   - Separate "done", "not verified", "blocked", and "next".
   - If the user must act manually, give exact ordered steps rather than a vague follow-up.

## Completion Gate

Before saying work is done, classify the closeout state:

- `validated locally`: commands, tests, builds, browser checks, generated artifacts.
- `verified live`: authenticated browser behavior, production/staging routes, live rows/logs, current third-party state.
- `pushed/deployed`: branch, commit, PR, tag, deploy ID, migration status.
- `blocked/not verified`: missing credentials, env vars, auth sessions, account toggles, rate limits, external wait windows, skipped checks.

If a task is code-complete but deploy, migration, manual setup, browser login, live smoke, or review remains, lead with that remaining gate. Do not bury it under the change summary.

## Output Shape

- `Current state`: branch, working tree, latest commit, deploy status.
- `Changed`: short list of meaningful changes.
- `Verified`: commands/checks and results.
- `Not verified`: anything important not checked.
- `Remaining`: prioritized next tasks.
- `Blockers`: credentials, access, failing checks, missing data, or manual approval.
- `Exact next action`: command, URL, PR/deploy step, migration, or manual checklist when one remains.

## Changelog Mode

When the user asks for a changelog or release notes:

- Group by user-facing changes, fixes, reliability/security, docs, and internal changes.
- Avoid raw commit spam unless the user asks for it.
- Mention breaking changes, migrations, env vars, or manual deployment steps.

## Guardrails

- Do not claim a change is deployed unless verified from deployment tooling or live behavior.
- Do not bury failed or skipped tests.
- Do not include secrets from config or environment output.
- Do not compress migration, scheduler, env-var, browser-auth, or account-setup blockers into generic "follow up" wording.
- Keep the final answer short unless the user asks for a full document.
