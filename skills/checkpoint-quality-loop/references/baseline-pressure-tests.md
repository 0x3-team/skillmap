# RED Baseline Pressure Tests

Baseline run before creating `checkpoint-quality-loop`.

Worker: `019ed918-60f6-7802-ad70-602b464d2e39`

## Findings

1. `Checkpoint UI/UX before we continue.`
   - Likely baseline: skim UI code, maybe run app, mention layout/responsiveness/accessibility.
   - Failure: treats checkpoint as a quick visual review; may skip browser inspection, mobile viewport, text overflow, interaction states, loading/error states, and workflow completion.

2. `Checkpoint the whole thing at production quality.`
   - Likely baseline: broad checklist audit, declare mostly ready if lint/build pass.
   - Failure: shallow evidence; conflates local validation with production readiness; misses auth, env vars, migrations, observability, rollback, data integrity, and live deploy state.

3. `Checkpoint security and fix what you find.`
   - Likely baseline: quick secret/auth searches and patches.
   - Failure: changes code before proving exploitability, blast radius, deployed configuration, RLS/policies, headers, token scopes, logs, or rotation path.

4. `Everything is probably fine; just checkpoint and continue.`
   - Likely baseline: accepts optimism and proceeds.
   - Failure: confirmation bias; checkpoint becomes permission to continue instead of independent quality gate.

5. `Audit backend, plan, implement, verify.`
   - Likely baseline: blends audit, planning, implementation, and verification.
   - Failure: baseline disappears; post-fix state may be reported as original state.

6. `Checkpoint this before deploy.`
   - Likely baseline: runs local build/tests/lint and env docs.
   - Failure: treats pre-deploy as local CI only; misses staging/live parity, migrations, secrets, cron/queue behavior, flags, smoke path, rollback, target branch.

7. `Checkpoint the browser workflow in the background while I study.`
   - Likely baseline: starts/reuses browser or dev server, clicks happy path.
   - Failure: weak evidence; stale route/auth/session context; may rely on impression instead of screenshots/logs/network/errors.

## Patterns The Skill Must Prevent

- Treating checkpoint as vague review instead of bounded evidence gate.
- Continuing implementation before recording baseline state.
- Conflating local, browser, staging, and live production verification.
- Accepting user optimism as evidence.
- Reporting production quality without deploy target, env, data, auth, observability, and rollback coverage.
- Fixing security issues before proving scope, risk, and verification path.
- Using checklist language without concrete artifacts.
- Letting background browser checkpoints proceed without explicit target, success criteria, timeout, and captured evidence.

