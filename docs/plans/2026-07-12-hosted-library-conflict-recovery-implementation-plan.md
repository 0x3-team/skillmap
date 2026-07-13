# SkillMap Hosted-Library Conflict-Recovery Implementation Plan

## Planner Metadata

- Repository/path: `/home/codex/projects/skillmap`
- Branch at planning: `codex/hosted-library-foundation` (`d6d2839`)
- Canonical tracked source: `gitea/main` (`a30cf9a`, recorded Phase 1 receipts through PRs #7–#10)
- Stale review reference: `codex/hosted-library-foundation-review` (`999b44d`)
- Date: 2026-07-12
- Planning mode: full worker run
- Worker scopes: Git conflict topology; validation and release contract
- References inspected: current index stages, Git worktree graph, clean review worktree, canonical Gitea `main`, package scripts, hosted security/deploy/test artifacts
- Research sources: repository and Git metadata only; no external product research was needed
- Assumption: the requested outcome is a safe local recovery of the current worktree, not a remote push, deployment, migration, or provider setup.

## Executive Goal

Replace the stale interrupted hosted-library squash integration with the already-reviewed, later canonical `gitea/main` content, preserve user-local sidecar state, remove every unmerged path and conflict delimiter, and prove the recovered tree locally to the degree the available environment permits.

## Source Of Truth Contract

- Intent: recover the current feature worktree without discarding user-local changes or regressing reviewed hosted-catalog hardening.
- Current behavior: the index is left in an interrupted squash integration. It has 26 unmerged paths, while the working files contain conflict delimiters. Its staged third side corresponds to the older `94574d0` review state, not the final review tip or the later accepted mainline implementation.
- Expected outcome: the tracked hosted-library tree matches current `gitea/main` (`a30cf9a`) and has no unmerged index entries or conflict delimiters. A local recovery commit documents the cutover; `.gitignore` sidecar entries and untracked `.chunk/`, `.claude/`, and `.codex/` remain untouched.
- Truth owner: `gitea/main` after a fresh fetch, not the stale stage-three blobs and not the older review worktree.
- Contract boundary: tracked application, database, CI, test, and documentation files are canonical-main owned. The explicitly unstaged `.gitignore` sidecar lines and the three untracked local-tool directories are user-local state.
- Displaced path: the interrupted squash state targeting `94574d0`, including all current conflict-stage variants.
- Cutover: source every tracked path that differs between current `HEAD` and refreshed `gitea/main` from canonical main; do not select the stale conflict side wholesale. Commit the resolved result as the intended squash-style recovery only after integrity checks pass.
- Acceptance evidence: current `gitea/main` content comparison, zero unmerged paths, no conflict delimiters, whitespace-clean staged diff, focused contract/web checks, and independent adversarial verification.
- Evidence lane: local Git/tree evidence and local test output. Gitea CI, remote Supabase, OAuth, deployment, and live acceptance remain separate and unverified.
- Kill criteria: stop before committing if the canonical ref changes during fetch, a non-local user change is discovered outside the declared boundary, the staged tree differs unexpectedly from canonical main, or any merge-integrity check fails.
- Forbidden moves: no `git reset --hard`, no broad checkout/revert, no blind `--theirs`, no deletion of `.chunk/`, `.claude/`, `.codex/`, no push, no deployment, no remote migration, and no use of service-role secrets outside a bounded local smoke process.

## Native Planning Superiority

- Codex Native baseline: resolve visible markers by choosing one side and run a build.
- What this plan adds: it identifies the interrupted squash provenance, distinguishes the stale review branch from the later canonical Gitea mainline, records local-state ownership, and makes database/auth/live proof explicit rather than inferred.
- User-specific context used: preserve dirty worktrees; separate locally validated, live-verified, pushed, and deployed states; complete operationally rather than only describing the conflict.
- Superiority score target: 5/5.
- Proof artifacts: this plan, its implementation ledger, Git integrity output, focused checks, and independent verification receipt.

## Orchestration Decision

- Mode: full worker run.
- Worker count: 2 planning workers, then 1–2 read-only implementation validators.
- Decision reason: API, security proxy/CSP/rate limits, Supabase seeds/RLS, CI, tests, and release documentation all cross the stale squash boundary.
- Independent surfaces: Git/source provenance; validation/release contract; post-resolution adversarial QA.
- Workers used or skipped: Git-topology and validation workers are used. No write-scoped worker is used because all edits overlap in one conflicted worktree.
- Thread decision: no visible thread; the repair is one parent-owned task.
- Reconsider trigger: add a specialist if fetching changes `gitea/main`, a canonical-main comparison exposes a real divergent feature, or a focused validation failure has an unclear cause.

## Background Browser Lane

- Needed: not for merge recovery itself.
- Target/surface: only the optional local hosted API/auth smoke after the tree is clean.
- Safety boundary: use a disposable local Supabase project and a production Next process; do not expose secrets to browser or persisted application environment.
- Required receipt: process/port and test-fixture cleanup.
- Stop condition: skip the lane and report `implemented but unproven` if local Supabase/Auth prerequisites are unavailable.

## Research And Inspiration Findings

No external reference was needed. The decisive evidence is the repository graph:

1. The current worktree is an interrupted squash integration targeting `94574d0`.
2. `codex/hosted-library-foundation-review` advanced to `999b44d` after that point.
3. The later reviewed and accepted mainline is `gitea/main` at `a30cf9a`, which includes the hosted private-alpha implementation plus Phase 1 closeout/accessibility/terminal-receipt follow-ups.
4. Every one of the current 26 conflicted paths appears in the `HEAD..gitea/main` path set. Canonical main is therefore the correct replacement source for the entire stale conflict family.

## Current State

- `git status` reports 26 unmerged paths and conflict delimiters in hosted API, security, data/RLS, tests, docs, and operations material.
- `SQUASH_MSG` records the intended old squash source. No `MERGE_HEAD` exists, so a normal merge continuation would be incorrect.
- The canonical mainline is newer than the review branch and contains final Phase 1 acceptance receipts.
- `.gitignore` has an unstaged sidecar comment and two `.chunk/sidecar` ignore patterns. `.chunk/`, `.claude/`, and `.codex/` are untracked local state and are not part of this cutover.

## Future State

The feature branch becomes a clean, locally committed squash recovery whose tracked product tree is canonical-main-equivalent, with this recovery plan and ledger as the only new task artifacts. It has no unresolved index state and can be validated without implying remote deployment or OAuth completion.

## Non-Goals

- Reimplementing the hosted catalog or changing its product scope.
- Pushing, opening a PR, changing remote branch protection, deploying, running a remote migration, or configuring OAuth/providers.
- Removing user-local sidecar state or cleaning unrelated tool directories.
- Treating local tests as proof of Gitea CI, live Supabase, Vercel, GitHub OAuth, or production readiness.
- Fixing the documented CI gap where hosted API/auth smoke coverage is still separate from the reduced Gitea database workflow.

## Phase Plan

### Phase 0 — Re-anchor canonical evidence

1. Fetch `gitea` without modifying working files and confirm the current `gitea/main` commit.
2. Re-check the worktree, squash metadata, unmerged index list, and local-only `.gitignore`/untracked boundary.
3. If main moved, repeat source comparison before changing any path.

Acceptance criteria:

- The canonical commit is recorded in the ledger.
- The target still contains every current conflict path.
- No user-local file outside the declared boundary is about to be overwritten.

### Phase 1 — Replace the stale squash tree

1. Generate the exact null-delimited path set from `git diff --name-only -z HEAD gitea/main`.
2. Restore that set from `gitea/main` into both index and worktree. This intentionally replaces the old conflict-stage content with accepted mainline content.
3. Leave `.gitignore`, `.chunk/`, `.claude/`, and `.codex/` untouched.
4. Verify that the recovered staged tree is canonical-main-equivalent except for this plan/ledger once staged.

Acceptance criteria:

- `git diff --name-only --diff-filter=U` is empty.
- A repository-wide conflict-delimiter scan is empty.
- `git diff --cached --check` is clean.
- No unexpected staged path differs from `gitea/main`.

### Phase 2 — Record the recovery without remote side effects

1. Create the append-only implementation ledger.
2. Stage only the canonical recovery tree plus this plan and ledger; keep the local-only `.gitignore` edit unstaged.
3. Make one local squash-style recovery commit. The prior operation was intentionally a squash integration, so do not manufacture a merge parent.
4. Confirm the branch is ahead locally and has not been pushed.

Acceptance criteria:

- The local recovery commit contains no conflict delimiters.
- `git status` shows only the preserved user-local state after commit.
- No remote refs are changed.

### Phase 3 — Validate the recovered product tree

Run checks in this order and stop at the first unexplained failure:

1. Merge integrity: `git diff --check`, zero unmerged paths, delimiter scan.
2. Focused code checks: `npm ci`, `npm --prefix apps/web ci`, `npm run test:contracts`, and `npm run check:web`.
3. If Docker, Supabase CLI, and local Auth/PostgREST are available: local reset/lint/pgTAP/type-generation comparison for the hosted schemas and RLS suite.
4. If bounded production Next plus local Supabase secrets can be supplied safely: run the explicit hosted API and auth smokes, then clean their process, data, and temporary artifacts.
5. Run broader regression (`npm test`, then `npm run check:all`) only after focused checks pass and within the remaining execution window.

Acceptance criteria:

- Tests/builds prove the restored contracts and web build locally.
- Target evidence includes real local API/RLS/auth behavior whenever prerequisites exist.
- Any unavailable database/auth/browser evidence is reported as a precise blocker, not a pass.

## Task Backlog

| Order | Task | Owner | Files/surfaces | Completion evidence |
|---|---|---|---|---|
| 1 | Fetch/re-anchor `gitea/main` | Parent | refs and Git metadata | exact refreshed SHA and graph check |
| 2 | Replace stale squash paths from canonical main | Parent | all `HEAD..gitea/main` tracked paths | no unmerged paths/markers; canonical-tree comparison |
| 3 | Preserve local sidecar state | Parent | `.gitignore`, `.chunk/`, `.claude/`, `.codex/` | unchanged local diff/status |
| 4 | Create plan ledger and local recovery commit | Parent | `docs/plans/` plus index | one local commit; no remote update |
| 5 | Adversarial Git/source QA | Validator | Git/index/tree and marker scan | independent receipt |
| 6 | Focused contracts/web checks | Parent + validator | root/web tests | commands and target outputs |
| 7 | Optional local RLS/API/auth proof | Parent | Supabase/Next local runtime | only if prerequisites pass; cleanup receipt |

## Acceptance Criteria

- The active worktree has zero unmerged files and zero conflict delimiters.
- No stale review-stage content is selected merely because it is `theirs`.
- All restored hosted paths match the refreshed canonical mainline, apart from the new plan/ledger.
- The `.gitignore` sidecar edit and untracked local-tool directories remain intact and uncommitted.
- A local recovery commit exists; no push or deploy occurs.
- `npm run test:contracts` and `npm run check:web` pass, or an exact failure is investigated and documented.
- For this HIGH slice, an independent adversarial verification checks source ownership, stale state, dirty-worktree preservation, and misleading-success risks.

## Validation Plan

### Required immediately

```bash
git diff --check
git diff --name-only --diff-filter=U
rg -n '^(<{7}|={7}|>{7})' --glob '!**/node_modules/**' .
npm ci
npm --prefix apps/web ci
npm run test:contracts
npm run check:web
```

### Required when local Supabase prerequisites are available

```bash
supabase start
supabase db reset --local
supabase db lint --local --level warning
supabase test db supabase/tests/hosted_catalog_rls.test.sql --local
```

Generate API types only to a temporary path, strip the CLI's terminal blank line with `sed -e '${/^$/d;}'`, and compare the normalized output with `apps/web/lib/supabase/database.types.ts`. Start a fresh production Next process only for the explicit hosted API/auth smoke commands; the service role must be scoped to the auth test process and every process/fixture must be removed afterward.

### Adversarial probes

- `dirty_worktree`: verify the `.gitignore` diff and untracked directories before and after recovery.
- `stale_state`: prove conflict stages are replaced by refreshed `gitea/main`, not `94574d0` or `999b44d` alone.
- `misleading_success_output`: require zero unmerged paths plus marker scan and canonical-tree comparison; a successful `git status` alone is insufficient.
- `flaky_test` and `hung_or_long_command`: use focused checks first; capture process cleanup for Supabase/Next/browser tests.
- `malformed_input`: if hosted API smoke runs, include duplicate query keys, invalid cursors, and bounded request behavior already covered by the suite.

## Risks And Dependencies

- `gitea/main` may move during recovery; a changed fetch invalidates the planned tree comparison and requires re-anchoring.
- Local package/database tooling can be unavailable. A missing prerequisite blocks only the related claim, not merge integrity.
- Gitea CI currently does not exercise the full API/auth smoke path described in some docs; that is a follow-up automation gap, not evidence that the checks passed.
- Remote provider ownership/cost, Supabase project, Vercel, GitHub OAuth, migrations, deployment, and live acceptance require separate user authorization.

## Implementation Orchestrator Handoff

### First implementation slice

Recover the stale squash into canonical mainline content and validate merge integrity plus focused contracts/web checks.

### Allowed changes

- Replace tracked paths in the `HEAD..gitea/main` diff with canonical main content.
- Add this plan and its append-only ledger.
- Create one local recovery commit after the tree is clean.

### Disallowed changes

- Any push/deploy/provider action, destructive reset, global hook change, remote migration, or modification/removal of user-local sidecar state.

### Required tools and checks

- Git for refreshed source comparison, canonical restoration, and local commit.
- Node/npm for root and web focused checks.
- Supabase/Next only when local prerequisites are independently verified.
- One read-only validator for the HIGH-slice adversarial verification.

### Stop conditions

- Do not commit if source ownership is ambiguous, the staged canonical comparison has unexpected paths, conflict delimiters remain, or a user-local change appears outside the declared boundary.
- Do not report `verified` until an independent validator accepts the recovered tree and target-perspective evidence is captured. If local Supabase/API/auth evidence cannot run, report `implemented but unproven` for those specific boundaries.

The implementation orchestrator should create its own execution goal, maintain the sibling ledger, run the implementation/validation loop, and continue until these acceptance criteria pass or a concrete blocker is documented.

## Planning Closeout

- Workers actually used: Git-topology planner; validation/release planner.
- Worker results accepted: the topology worker established the interrupted-squash/stale-stage boundary; the validation worker established the focused, database, API/auth, and release evidence matrix.
- Parent verification: branch graph confirmed that `gitea/main` contains later accepted Phase 1 receipts and that every active conflict path is covered by the canonical-main diff.
- Gaps that would benefit from more workers: only an unexplained post-recovery test failure or a live provider task.
- Visible thread considered: no; a user-visible follow-up is unnecessary for this bounded parent-owned recovery.

## Implementation Result — 2026-07-12

- Recovery status: the stale squash state was replaced from freshly fetched `gitea/main` at `a30cf9a`. The staged product tree equals canonical main; this plan and ledger are the only staged delta from it.
- Integrity status: zero unmerged entries, zero conflict delimiters, and a clean staged whitespace check. The user-local `.gitignore` sidecar edit and `.chunk/`, `.claude/`, and `.codex/` remain outside the recovery.
- Focused local validation: passed contracts, web fixtures/typecheck/lint/production build, full root suite, local migration/reset/lint/96 pgTAP tests, normalized generated API types, hosted API smoke, hosted authenticated browser smoke, and root/web production dependency audits.
- Independent verification: two read-only validators accepted canonical-source ownership, dirty-worktree preservation, and the adversarial recovery checks.
- Aggregate regression: `npm run check:all` reached and passed cross-browser and accessibility acceptance, then stopped at the local-app `overview-ready` visual baseline (0.6432% pixel delta versus a 0.0100% threshold). The staged local-app source and baseline equal `gitea/main`, so this is not a recovery delta. Do not refresh the baseline without a separate visual-review task.
- Runtime cleanup: the temporary Next session and local Supabase stack were stopped; temporary generated types were removed.
