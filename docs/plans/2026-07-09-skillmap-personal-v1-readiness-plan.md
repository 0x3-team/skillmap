# SkillMap Personal V1 Readiness Implementation Plan

## Planner Metadata

- Repository/path: `/home/codex/projects/skillmap`
- Branch: `main`
- Current commit inspected: `02a3c90 Add SkillMap handoff document`
- Date: 2026-07-09
- Planning mode: full worker run with parent synthesis
- Worker scopes:
  - CLI/runtime personal workflow readiness
  - Dashboard/local connector readiness
  - Eval/source governance readiness
  - Release/QA/operability readiness
- References inspected:
  - `README.md`
  - `HANDOFF.md`
  - `package.json`
  - `docs/architecture.md`
  - `docs/commands.md`
  - `docs/curation.md`
  - `docs/dogfood.md`
  - `docs/first-run.md`
  - `docs/hooks.md`
  - `docs/host-compatibility.md`
  - `docs/release-checklist.md`
  - `docs/security.md`
  - `docs/threat-model.md`
  - `docs/troubleshooting.md`
  - `docs/plans/2026-07-09-skillmap-beui-website-dashboard-plan.md`
  - `src/cli.ts`
  - `src/core/roots.ts`
  - `src/core/status.ts`
  - `src/core/route.ts`
  - `src/commands/init.ts`
  - `src/commands/status.ts`
  - `src/commands/export.ts`
  - `src/commands/eval.ts`
  - `src/commands/sources.ts`
  - `src/commands/curate.ts`
  - `src/commands/hook.ts`
  - `src/commands/mcp.ts`
  - `apps/web/README.md`
  - `apps/web/package.json`
  - `apps/web/lib/contracts/skillmap-dashboard.ts`
  - `apps/web/lib/fixtures.ts`
  - `apps/web/components/skillmap/dashboard-page.tsx`
  - `apps/web/scripts/browser-smoke.mjs`
  - `apps/web/scripts/capture-screenshots.mjs`
  - `apps/web/scripts/check-fixtures.mjs`
- Research sources:
  - Local repo docs and source code
  - Existing SkillMap handoff evidence
  - Prior SkillMap/shadcn registry memory context
  - Hindsight `masih` reflection for stable preferences and architecture boundaries
  - No new external product research was required for this planning pass
- Assumptions:
  - "Personal V1" means stable daily use for one operator on this machine, not public npm release, hosted auth, billing, team policy, or a public marketplace.
  - The CLI remains the operational source of truth.
  - The web dashboard is included only as a local, redacted, read-only operator console if it can load real local snapshots.
  - Original user skill roots must not be mutated by SkillMap without explicit user approval.
  - Runtime route, hook, and MCP paths must remain deterministic and must not call an LLM or network service.

## Executive Goal

Make SkillMap personal V1 ready as a stable local SkillOps product for one operator:

1. It can scan the real skill roots the user relies on.
2. It can produce a reviewed, policy-backed effective registry.
3. It can route real prompts with compact, traceable recommendations.
4. It can show honest readiness state through `skillmap status` and the local dashboard.
5. It can optionally install a passive project-local Codex hook after readiness gates pass.
6. It can prove the state through real-root dogfood evidence, evals, source provenance, hook rollback, MCP smoke, package checks, and browser checks.

The target is not "SkillMap is published" or "SkillMap is a hosted service." The target is "I can use this every day without guessing whether the router, hook, source state, or dashboard is real."

## Source Of Truth Contract

- Intent: turn the current release-candidate CLI plus fixture-backed dashboard into a stable personal-use local product.
- Current behavior:
  - The CLI has scan, doctor, curation, apply-policy, graph, route, eval, source, export/import, hook, status, and read-only MCP commands.
  - The current checkout has no `.skillmap/` artifacts, so `node dist/cli.js status --json` reports `blocked`.
  - The web dashboard exists under `apps/web`, but it renders fixture data and hardcoded source rows.
  - The worktree is not clean: `.gitignore` and `package.json` are modified, `apps/` and `docs/plans/` are untracked.
  - Docs and code drift in important places: source updates are documented as preview-only while code can write with `sources update --confirm`; V1 eval thresholds in docs are stricter than current default pass logic.
- Expected outcome:
  - `skillmap status --json` is the authoritative personal readiness gate.
  - A redacted dashboard snapshot can be generated from real `.skillmap` artifacts and rendered by `/dashboard`.
  - Personal V1 evidence exists from current checkout and real roots, not only from the older handoff.
  - Hook install is optional and protected by readiness preflight.
- Truth owner:
  - CLI artifacts under `.skillmap/` own operational truth.
  - `src/core/status.ts` owns readiness judgment.
  - `apps/web/lib/contracts/skillmap-dashboard.ts` owns dashboard snapshot shape.
  - Docs under `docs/` own user workflow and release criteria.
- Contract boundary:
  - CLI may read skill metadata and `.skillmap` artifacts.
  - CLI may write `.skillmap` artifacts and explicit hook config only through documented commands.
  - Web may read redacted dashboard snapshots and fixtures.
  - Web must not read raw skill bodies, raw prompts, unredacted absolute paths, or mutate local skill roots.
- Displaced path:
  - Fixture-only dashboard state is displaced by a real local redacted snapshot flow.
  - Hidden default root scanning is displaced by explicit, persisted personal root configuration.
  - Chat-only readiness claims are displaced by saved evidence artifacts.
- Cutover:
  - Personal V1 is considered cut over when a clean install can run the full real-root dogfood loop and the dashboard can render a current redacted snapshot from that loop.
- Acceptance evidence:
  - Current `git status --short --branch`.
  - Root and web validation command logs.
  - `.skillmap/status` JSON output showing ready or only accepted non-blocking warnings.
  - `.skillmap/eval-report.json` from real prompts meeting V1 thresholds.
  - `.skillmap/source-status.json` and `.skillmap/source-decisions.json` with no unreviewed non-clean records.
  - Hook dry-run/install/uninstall proof against a temporary hooks file.
  - MCP JSON-RPC smoke transcript.
  - Browser screenshots and smoke output for `/` and `/dashboard` if the web dashboard is in V1 scope.
- Evidence lane:
  - Use `outputs/skillmap-personal-v1/` or `.skillmap/reports/personal-v1/` for local evidence.
  - Keep private local paths and raw artifacts out of published package contents.
- Kill criteria:
  - Any command can overwrite real skill roots without a new explicit dangerous flag.
  - Runtime route/hook/MCP calls an LLM or network service.
  - Dashboard claims live connector state without a real local snapshot or heartbeat.
  - Eval confidence is claimed from fixtures or from a tiny synthetic suite.
  - Global Codex hook is installed without explicit user approval.
- Forbidden moves:
  - Do not publish npm, create a GitHub tag/release, or install a global hook in this personal V1 implementation.
  - Do not add hosted backend/auth/billing/team features.
  - Do not store raw prompts or raw skill bodies in dashboard fixtures, dashboard snapshots, or browser-visible payloads.
  - Do not make source updates auto-apply in personal V1.

## Native Planning Superiority

- Codex Native baseline:
  - Likely produces a generic roadmap: finish dashboard, run tests, install hook, write docs.
  - Risks treating old handoff evidence as current proof.
  - Risks missing code/doc drift around source updates and eval thresholds.
  - Risks treating fixture dashboard state as real connector readiness.
- What this planning run does better:
  - Anchors current repo branch, commit, dirty state, missing `.skillmap` artifacts, and current status output.
  - Separates CLI readiness, dashboard snapshot readiness, governance gates, and release/QA evidence.
  - Uses worker evidence to identify concrete blockers in code paths.
  - Converts "personal V1" into specific pass/fail acceptance gates.
  - Saves a durable implementation handoff instead of leaving decisions only in chat.
- User-specific context used:
  - The user wants SkillMap to work because skills are hosted outside model context.
  - The user values context savings, route governance, and useful operator UI over a passive registry.
  - The user prefers local-first, deterministic, evidence-backed tooling and dislikes ambient hook bloat.
- Superiority score target: 5
- Proof artifacts:
  - This plan file.
  - Worker outputs summarized in orchestration closeout.
  - Current repo commands and source paths listed above.

## Orchestration Decision

- Mode: full worker run
- Worker count: 4
- Decision reason: personal V1 spans CLI/runtime, dashboard/local connector, eval/source governance, hook/MCP integration, package hygiene, and browser validation.
- Independent surfaces:
  - CLI first-run and roots/profile behavior
  - Status/eval/source/curation governance
  - Local dashboard snapshot and UI utility
  - Hook/MCP/package/browser release evidence
- Workers used or skipped:
  - Used CLI/runtime worker.
  - Used dashboard/local connector worker.
  - Used eval/source governance worker.
  - Used release/QA/operability worker.
  - Skipped visible thread creation because this is one parent-owned plan artifact.
- Thread decision: no user-visible threads.
- Token/context rationale: local docs and source are broad, and workers produced independent evidence without duplicating the parent synthesis.
- Reconsider trigger: add a new worker only if the scope expands into hosted backend/auth/billing, public release, or multi-user team governance.

## Background Browser Lane

- Needed: not during planning.
- Target/surface: during implementation, use the running local app route for `/` and `/dashboard`.
- Safety boundary: browser evidence must be from a real running server, not stale screenshots or an unreachable port.
- Required receipt:
  - Server command and port.
  - HTTP proof for `/` and `/dashboard`.
  - Playwright smoke output.
  - Screenshots at 1440x1000, 1024x768, 390x844, and 320x740.
- Stop condition: stop browser validation if the server route does not respond, and report it as blocked rather than visually verified.

## Research And Inspiration Findings

No new external research was requested for this planning pass. The relevant product principles come from prior SkillMap research and the current repo:

- Adopt:
  - Treat SkillMap as a local skill access layer, not as another prompt-loaded catalog.
  - Make context savings visible through hook length, catalog avoided, and full-body avoided estimates.
  - Make readiness state first-class: inventory, policy, curation, eval, source, graph, hook, and connector state.
  - Keep the UI dense, calm, and operational.
- Adapt:
  - Marketplace concepts become trust and provenance cards, not install buttons.
  - Registry concepts become local source records and review receipts, not automatic updates.
  - Hosted-service language becomes "local snapshot and future hosted surface" until backend exists.
- Avoid:
  - Claims that the dashboard can mutate local roots or install hooks automatically.
  - A public marketplace, account system, billing, or team governance in personal V1.
  - Decorative dashboard motion that hides readiness state.
- Not relevant for personal V1:
  - Public pricing pages.
  - Multi-tenant backend schemas.
  - Organization admin flows.

## Current State

### Repo State

- Branch: `main`
- Commit inspected: `02a3c90`
- `git status --short --branch` shows:
  - `main...origin/main`
  - modified `.gitignore`
  - modified `package.json`
  - untracked `apps/`
  - untracked `docs/plans/`
- No repo-local `AGENTS.md` exists.
- The root package currently excludes `docs/plans` from npm files.
- Package repository metadata does not match the handoff:
  - `HANDOFF.md` says `Masih-0x3/skillmap`.
  - `package.json` points to `Masihhedayati/skillmap`.

### CLI State

- `README.md` still labels the project as experimental alpha moving toward V1.
- `node dist/cli.js status --json` currently reports `blocked` because `.skillmap/` is absent.
- `src/core/roots.ts` scans default user/project roots when no `--root` is provided:
  - `~/.agents/skills`
  - `~/.codex/skills`
  - `~/.claude/skills`
  - project-local `.agents/skills`
  - project-local `.codex/skills`
  - project-local `.claude/skills`
- `src/commands/init.ts` only writes `.skillmap/policy.yml` and `.skillmap/evals.json`; it does not persist personal roots or a readiness profile.
- `src/core/status.ts` already tracks inventory, policy, effective registry, curation receipt, eval report, source state, and next actions.
- `src/commands/mcp.ts` already exposes `show_skill`, so a separate CLI `show` command is optional rather than mandatory.

### Governance Drift

- `docs/dogfood.md` defines V1 targets:
  - at least 150 evals
  - top-1 expected hit rate at least 80 percent
  - top-3 expected hit rate at least 92 percent
  - avoid hits equal 0
- `src/commands/eval.ts` currently passes at 75 percent top-1 and 90 percent top-3 unless stronger thresholds are supplied externally.
- `docs/commands.md` and `README.md` say source update application is preview-only.
- `src/commands/sources.ts` can write upstream content with `sources update --confirm`.
- Curation receipts record output artifacts, but `status` only checks receipt staleness against inventory. It does not fully validate current policy/rationale/doctor-pack hashes.
- Source summaries warn on unknown, stale, and risky updates, but not all non-clean states are equally treated as V1 blockers.

### Web State

- `apps/web` exists as a private Next app with `/` and `/dashboard`.
- The web dashboard is explicitly fixture-backed in `apps/web/README.md`.
- `apps/web/lib/contracts/skillmap-dashboard.ts` defines a good redacted snapshot contract.
- `apps/web/lib/fixtures.ts` merges fixture JSON plus hardcoded source rows.
- The dashboard has useful operator sections: Overview, Route Lab, Skills, Policies, Trust, Sources, Connector, QA.
- Existing scripts cover fixture privacy, browser smoke, and screenshot capture.
- The in-app browser route reported by the user, `http://localhost:53622/dashboard`, did not respond from shell during planning. Prior implementation validation used `http://127.0.0.1:53040`.

## Future State

Personal V1 should be one coherent local workflow:

```text
init personal roots
scan real skills
doctor and create doctor pack
native-agent curation
ingest reviewed policy
apply strict policy
build graph
adopt/check/review sources
run real evals
status gate
export redacted dashboard snapshot
route and inspect traces
optional MCP and project-local passive hook
```

The daily operator experience should be:

1. Run one health command.
2. See whether SkillMap is ready, attention-required, or blocked.
3. Route a prompt and inspect why skills were recommended or excluded.
4. Open the dashboard and see the same state from a redacted snapshot.
5. Dry-run the hook before installing it.
6. Install only a project-local hook after status and evals are acceptable.
7. Revert cleanly.

## Non-Goals

- Public npm publish.
- GitHub tag or GitHub release.
- Global Codex hook install.
- Hosted backend.
- Auth, billing, team accounts, organization policy, or public marketplace.
- Automatic source update application.
- Runtime LLM calls in route, hook, or MCP.
- Raw prompt storage.
- Raw skill-body storage in dashboard payloads.
- Mutating original skill roots during dogfood without explicit approval.

## Phase Plan

### Phase 0 - Baseline, Scope Freeze, And Package Hygiene

Goal: make the current worktree and package boundary intentional before changing behavior.

Tasks:

- Decide and document whether `apps/web` is part of personal V1.
  - Recommended decision: include it as a local dashboard, but keep it out of the root npm package unless a separate web packaging decision is made.
- Keep generated web artifacts out of source and package claims:
  - `.next/`
  - `node_modules/`
  - `apps/web/artifacts/`
  - `*.tsbuildinfo`
- Resolve repository metadata mismatch between `HANDOFF.md` and `package.json`.
- Update docs to say the current web app exists and is additive, not future-only.
- Capture baseline:
  - `git status --short --branch`
  - `npm ci`
  - `npm run typecheck`
  - `npm test`
  - `npm pack --dry-run`
  - `cd apps/web && npm run test:fixtures`
  - `cd apps/web && npm run typecheck`
  - `cd apps/web && npm run lint`
  - `cd apps/web && npm run build`

Acceptance criteria:

- Dirty worktree state is intentional and explainable.
- Package contents exclude private plans, generated app output, local `.skillmap`, tests, fixtures, tarballs, secrets, and private reports.
- Docs do not claim the web app is unimplemented.
- Public release remains explicitly out of scope.

### Phase 1 - Personal Profile And First-Run Readiness

Goal: make SkillMap repeatable on a real personal skill library without hidden root assumptions.

Tasks:

- Add persisted personal root configuration.
  - Preferred shape: `.skillmap/config.yml` with `roots`, `profile`, and optional `dashboardSnapshotPath`.
  - Support `skillmap init --root PATH --root PATH`.
  - Preserve current default root behavior as fallback, but display the exact roots used.
- Update `scan`, `doctor`, `doctor-pack`, `apply-policy`, `graph`, `route`, and `eval` to consistently respect configured roots/artifacts where applicable.
- Add readiness phase to `SkillMapStatus`.
  - Example phases: `missing-inventory`, `needs-doctor`, `needs-curation`, `needs-policy`, `needs-graph`, `needs-sources`, `needs-eval`, `ready`, `blocked`.
- Fix ordered `nextActions`.
  - No inventory: suggest only init/scan.
  - Post-scan: suggest doctor/doctor-pack.
  - Post-doctor: suggest curation.
  - Post-curation: suggest apply-policy and graph.
  - Post-policy: suggest sources/eval.
  - Ready: suggest route/hook dry-run/export snapshot.
- Add a personal readiness command alias if useful.
  - Option A: `skillmap status --json` remains enough.
  - Option B: add `skillmap status --profile personal-v1`.
  - Prefer Option A unless implementation shows profile-specific thresholds require a flag.

Acceptance criteria:

- A fresh checkout can run:
  - `skillmap init --root ~/.agents/skills --root ~/.codex/skills --dry-run --json`
  - `skillmap init --root ~/.agents/skills --root ~/.codex/skills --json`
  - `skillmap scan --json`
  - `skillmap status --json`
- Status names the exact roots and readiness phase.
- Status never suggests curation before inventory exists.
- Missing `.skillmap` stays blocked, not "almost ready."

### Phase 2 - Governance Gates: Eval, Sources, Curation, Route Safety

Goal: make `status` a trustworthy personal V1 gate.

Tasks:

- Align eval behavior with docs.
  - Add explicit threshold flags or profile:
    - `--min-count`
    - `--min-top1`
    - `--min-top3`
    - `--max-avoid-hits`
  - Personal V1 defaults when using `--profile personal-v1`:
    - `--min-count 150`
    - `--min-top1 0.80`
    - `--min-top3 0.92`
    - `--max-avoid-hits 0`
  - Ensure `status` treats release-count-but-failing evals as not ready.
- Stop fixture confidence from looking like personal confidence.
  - If eval file is omitted, prefer `.skillmap/real-evals.json` when present.
  - If neither explicit file nor real eval file exists, fail with a clear message instead of silently using fixture evals for readiness.
  - Keep fixture fallback only for tests or explicit `--fixtures`.
- Resolve source update policy.
  - Recommended for personal V1: make `sources update` preview-only in normal commands.
  - If write behavior is retained, move it behind an intentionally scary post-V1/experimental flag and update docs. This is not recommended for personal V1.
- Improve source review receipts.
  - Store state plus relevant current/upstream hashes in `source-decisions.json`.
  - Mark review stale when state or hashes change.
  - Warn on unreviewed `external-modified`, `external-stale`, `external-risky-update`, `unknown`, and `error`.
- Strengthen curation staleness.
  - Compare receipt inputs and outputs against current inventory, doctor, doctor-pack, policy, and rationale artifacts.
  - Require non-empty `policy-rationale.md`.
  - Keep model identity explicitly user-reported unless provider verification exists.
- Add route-safety regressions.
  - Broad/generic prompts should not pull high-risk specialists.
  - Explicit-only skills should not route unless named.
  - Blocked/archived skills should never recommend.
  - Script-bearing skills should be demoted unless the prompt is specific.
  - Generic words like `review` and `dashboard` should not be enough.

Acceptance criteria:

- `skillmap eval --file .skillmap/real-evals.json --min-count 150 --min-top1 0.80 --min-top3 0.92 --max-avoid-hits 0 --save-report --json` fails if any V1 gate is missed.
- `skillmap status --json` is not ready unless eval report passes current V1 gates.
- `sources update` cannot overwrite a real skill through ordinary documented V1 commands.
- Source review receipts become stale when upstream/local state changes.
- Curation receipt becomes stale when policy/rationale or input artifacts drift.

### Phase 3 - Real Skill Library Dogfood And Evidence

Goal: produce current personal evidence from real roots, not only fixture tests or older handoff files.

Tasks:

- Run read-only real-root inventory:
  - `skillmap scan --json`
  - `skillmap status --json`
  - `skillmap doctor --json`
  - `skillmap doctor --fix-plan`
  - `skillmap doctor-pack --summary --json`
- Curate policy through native Codex:
  - `skillmap curate codex --prepare`
  - Produce `.skillmap/proposals/policy.yml`.
  - Produce `.skillmap/proposals/policy-rationale.md`.
  - `skillmap curate codex --ingest ... --model <user-reported-model> --confirm`
  - `skillmap apply-policy --strict`
  - `skillmap graph build`
- Adopt and check important external sources:
  - Start with high-value external skills only.
  - Do not force every local-authored skill into an external source record.
  - Review or hold unknown/stale/risky records.
- Build real eval set:
  - Seed from actual prompts the user has used.
  - Include expected skills and avoid lists.
  - Include negative and near-miss prompts.
  - Store as `.skillmap/real-evals.json`.
- Save evidence:
  - `.skillmap/eval-report.json`
  - `.skillmap/source-status.json`
  - `.skillmap/source-decisions.json`
  - `.skillmap/curation/receipt.json`
  - `.skillmap/reports/fix-plan.md`
  - a human-readable evidence index under `.skillmap/reports/personal-v1/`

Acceptance criteria:

- No fixture-root warnings.
- No unmatched policy entries.
- Duplicate inventory-name groups are resolved or intentionally held.
- Source states are clean, local-authored, or reviewed/held.
- Eval meets personal V1 thresholds.
- `status` is `ok` or shows only documented non-blocking warnings.

### Phase 4 - Local Dashboard Snapshot

Goal: make `/dashboard` useful for the personal operator by loading real redacted local state.

Tasks:

- Add a dashboard snapshot generator.
  - Preferred command: `skillmap export --dashboard-snapshot --redact-paths --output .skillmap/dashboard-snapshot.json`.
  - Alternative if command scope must stay smaller: `apps/web/scripts/build-local-snapshot.mjs` that reads `skillmap export --redact-paths` output.
  - Preferred implementation is CLI-owned because dashboard truth should not be a web-only script.
- Transform current artifacts into `DashboardSnapshot`.
  - Inputs:
    - `status`
    - inventory
    - effective registry
    - eval report
    - route trace samples
    - source status
    - source decisions
    - curation receipt
  - Output:
    - redacted `DashboardSnapshot` version 1
    - no raw prompts
    - no raw skill bodies
    - no unredacted local paths
    - snapshot hash
    - generated time
    - CLI version
    - source type: `fixture` or `local-snapshot`
- Update web data loading.
  - Add server-side snapshot loading from an environment variable such as `SKILLMAP_DASHBOARD_SNAPSHOT`.
  - Keep fixture fallback for demo mode.
  - Show source, generated time, hash, stale state, and redaction state in the UI.
- Make connector status honest.
  - `online` only when a current local snapshot exists and passes freshness rules.
  - `offline` when no snapshot path is configured.
  - `blocked` when snapshot exists but status says blocked/attention-required.
  - `unauthorized` only for future connector auth, not for local snapshots unless a real permission error occurs.
- Make key actions useful.
  - Copy route hook text to clipboard.
  - Copy exact next command to clipboard.
  - Copy snapshot export command.
  - Keep all actions read-only/copy-only.
- Add dashboard states.
  - no snapshot
  - stale snapshot
  - blocked status
  - no confident route
  - unknown source state
  - risky source state held
  - eval failing thresholds

Acceptance criteria:

- `/dashboard` can render from fixture mode or local snapshot mode.
- UI clearly labels which mode is active.
- Fixture mode cannot be mistaken for verified local readiness.
- Local snapshot privacy check passes.
- Browser smoke covers source mode, command palette, mobile drawer, Route Lab, connector blocked/offline state, and no page-level horizontal overflow.

### Phase 5 - Codex Hook And MCP Personal Integration

Goal: make the daily agent integration useful and reversible.

Tasks:

- Add hook readiness preflight.
  - `hook install codex --passive` should inspect `status`.
  - Block or require `--force` when:
    - inventory missing
    - effective registry missing/stale
    - curation missing/stale
    - eval missing/failing
    - source status missing or unreviewed non-clean states exist
  - Always allow `hook dry-run`.
- Improve hook dry-run output.
  - Include readiness verdict.
  - Include registry generated time.
  - Include exact hook command.
  - Include whether hook text is empty due to no confident route.
- Run controlled hook smoke.
  - Use a temporary hooks file with an existing non-SkillMap hook.
  - Install SkillMap hook.
  - Verify existing hook remains.
  - Uninstall SkillMap hook.
  - Verify only SkillMap hook is removed.
  - Verify backup created when expected.
- Run MCP smoke.
  - `skillmap mcp manifest`
  - `skillmap mcp call route_prompt --prompt "..."`
  - `skillmap mcp call search_skills --query frontend`
  - `skillmap mcp call show_skill --name <skill>`
  - `skillmap mcp call doctor_summary`
  - JSON-RPC initialize, tools/list, tools/call.
- Decide whether CLI `show` is needed.
  - Current MCP `show_skill` may be enough.
  - Add CLI `skillmap show <name>` only if daily use shows MCP access is not ergonomic.

Acceptance criteria:

- No global hook install is performed.
- Project-local hook install is blocked unless readiness is acceptable or user explicitly forces it.
- Hook rollback leaves unrelated hooks untouched.
- MCP remains read-only and deterministic.
- Daily route-to-load path is documented and works.

### Phase 6 - Docs, Runbook, And Evidence Packet

Goal: make personal V1 repeatable on a new checkout or machine.

Tasks:

- Update `README.md`.
  - Replace broad alpha wording with precise current state after implementation.
  - Keep public-release status separate from personal V1 readiness.
- Update `docs/first-run.md`.
  - Include explicit roots.
  - Include readiness phases.
  - Include when to stop and review.
- Update `docs/dogfood.md`.
  - Encode personal V1 flow and thresholds.
  - Add dashboard snapshot validation if web is in scope.
- Update `docs/commands.md`.
  - Reflect source update behavior accurately.
  - Add dashboard snapshot command if implemented.
  - Add eval threshold flags if implemented.
- Update `docs/security.md` and `docs/threat-model.md`.
  - Preserve no raw prompt/body/no runtime LLM/no network route boundaries.
  - Document dashboard snapshot redaction.
- Update `docs/hooks.md`.
  - Document preflight behavior and `/hooks` manual trust requirement.
- Add `docs/personal-v1-runbook.md` or `docs/personal-v1.md`.
  - One ordered path from clean install to daily use.
  - Include rollback.
- Add evidence index template.
  - Recommended path: `.skillmap/reports/personal-v1/evidence-index.md`.

Acceptance criteria:

- A fresh implementation agent or user can follow one doc from install to useful route/hook output.
- Docs and code agree on source update behavior.
- Docs do not claim hosted connector or public release.
- Evidence index distinguishes:
  - validated locally
  - verified in browser
  - package dry-run only
  - not published
  - not globally hooked

### Phase 7 - Final Validation Gate

Goal: prove personal V1 from the current checkout.

Required commands:

```bash
git status --short --branch
npm ci
npm run typecheck
npm test
npm pack --dry-run
```

Personal real-root loop:

```bash
node dist/cli.js init --root ~/.agents/skills --root ~/.codex/skills --json
node dist/cli.js scan --json
node dist/cli.js status --json
node dist/cli.js doctor --json
node dist/cli.js doctor --fix-plan
node dist/cli.js doctor-pack --summary --json
node dist/cli.js curate codex --prepare --json
node dist/cli.js curate codex --ingest .skillmap/proposals/policy.yml --rationale .skillmap/proposals/policy-rationale.md --model codex-gpt-5 --confirm --json
node dist/cli.js apply-policy --strict --json
node dist/cli.js graph build --json
node dist/cli.js sources check --json
node dist/cli.js eval --file .skillmap/real-evals.json --min-count 150 --min-top1 0.80 --min-top3 0.92 --max-avoid-hits 0 --save-report --json
node dist/cli.js status --json
node dist/cli.js route "make this dashboard less generic and verify mobile" --trace --json
node dist/cli.js hook dry-run codex "make this dashboard less generic and verify mobile" --json
```

Hook smoke:

```bash
node dist/cli.js hook install codex --passive --config /tmp/skillmap-hooks.json --dry-run --json
node dist/cli.js hook install codex --passive --config /tmp/skillmap-hooks.json --json
node dist/cli.js hook uninstall codex --config /tmp/skillmap-hooks.json --json
```

MCP smoke:

```bash
node dist/cli.js mcp manifest --json
node dist/cli.js mcp call route_prompt --prompt "make this dashboard less generic" --json
node dist/cli.js mcp call search_skills --query frontend --json
node dist/cli.js mcp call show_skill --name frontend-design --json
node dist/cli.js mcp call doctor_summary --json
```

Web validation if included:

```bash
cd apps/web
npm ci
npm run test:fixtures
npm run typecheck
npm run lint
npm run build
SKILLMAP_WEB_BASE_URL=http://127.0.0.1:<port> npm run test:browser
SKILLMAP_WEB_BASE_URL=http://127.0.0.1:<port> npm run screenshots
```

Acceptance criteria:

- All relevant commands pass.
- Browser screenshots are visually inspected.
- Status is ready from real artifacts, not fixtures.
- Hook install is proven only on a temporary/project-local config.
- Evidence packet is saved.

## Task Backlog

| ID | Task | Primary files | Depends on | Acceptance |
| --- | --- | --- | --- | --- |
| V1-00 | Freeze scope and clean/package boundary | `.gitignore`, `package.json`, `README.md`, `HANDOFF.md` | none | Git/package state is intentional; web scope decided |
| V1-01 | Add personal root config | `src/commands/init.ts`, `src/core/roots.ts`, `src/commands/scan.ts`, docs | V1-00 | `init --root` persists roots; scan reports exact roots |
| V1-02 | Add readiness phase and ordered next actions | `src/core/status.ts`, `src/commands/status.ts`, tests | V1-01 | Missing state is blocked with correct next action |
| V1-03 | Align eval thresholds with V1 docs | `src/commands/eval.ts`, `src/core/status.ts`, tests, docs | V1-02 | V1 eval gate enforces 150, 80 percent, 92 percent, 0 avoid |
| V1-04 | Stop accidental fixture confidence | `src/commands/eval.ts`, tests, docs | V1-03 | Real readiness cannot use fixture default silently |
| V1-05 | Resolve source update safety drift | `src/commands/sources.ts`, docs, tests | V1-00 | Normal V1 source update cannot overwrite roots |
| V1-06 | Strengthen source review receipts | `src/commands/sources.ts`, `src/core/status.ts`, tests | V1-05 | Non-clean unreviewed source states block readiness |
| V1-07 | Strengthen curation stale checks | `src/commands/curate.ts`, `src/core/status.ts`, tests | V1-02 | Policy/rationale/input drift marks curation stale |
| V1-08 | Add route safety regressions | `test/*.mjs`, `test/fixtures/*`, `src/core/route.ts` if needed | V1-03 | Near-miss/high-risk cases behave conservatively |
| V1-09 | Add dashboard snapshot export | `src/commands/export.ts` or new command, `apps/web/lib/contracts/*` | V1-02 | Redacted `DashboardSnapshot` generated from real artifacts |
| V1-10 | Load local dashboard snapshot | `apps/web/lib/*`, `apps/web/components/skillmap/dashboard-page.tsx`, scripts | V1-09 | Dashboard shows fixture vs local snapshot honestly |
| V1-11 | Make dashboard copy actions real | `apps/web/components/skillmap/dashboard-page.tsx`, UI components | V1-10 | Copy hint/command works and has success/error states |
| V1-12 | Add hook readiness preflight | `src/commands/hook.ts`, `src/core/status.ts`, tests, docs | V1-02 to V1-07 | Hook install blocks unsafe state unless forced |
| V1-13 | Run real-root dogfood | commands and evidence files | V1-01 to V1-12 | `.skillmap` artifacts prove personal readiness |
| V1-14 | Update personal V1 docs/runbook | `docs/*.md`, `README.md`, `HANDOFF.md` | V1-01 to V1-13 | One doc can onboard from clean install to daily use |
| V1-15 | Final validation and evidence packet | `.skillmap/reports/personal-v1/*`, outputs | all | Evidence proves local validated state |

## Acceptance Criteria

### Personal V1 Ready

- Current checkout has intentional git state.
- Root package checks pass.
- Web checks pass if web is in scope.
- `.skillmap` artifacts exist from real roots.
- `status` reports ready or only accepted non-blocking warnings.
- Curation receipt is current.
- Effective registry and graph are current.
- Source states are clean/local or reviewed/held.
- Eval report meets V1 thresholds.
- Route traces show useful recommendations and conservative exclusions.
- Hook dry-run works.
- Hook install/uninstall is proven on a temporary/project-local config.
- MCP read-only tools work.
- Dashboard renders a real redacted snapshot or clearly labels fixture mode.
- Evidence packet exists.

### Not Ready

Any of the following should prevent a personal V1 ready claim:

- `.skillmap/inventory.json` missing.
- Fixture roots in inventory.
- Missing or stale curation receipt.
- Missing or stale effective registry.
- Missing graph.
- Missing eval report.
- Eval report below V1 thresholds.
- Any avoid hit in evals.
- Unreviewed unknown/stale/risky/modified source record.
- Dashboard only fixture-backed but labeled as live/online.
- Hook installed globally.
- Source update can overwrite skill files through normal V1 commands.

## Validation Plan

### Static And Unit Validation

- `npm ci`
- `npm run typecheck`
- `npm test`
- `npm pack --dry-run`

### CLI Behavior Validation

- no-inventory status output
- init with explicit roots
- scan real roots
- doctor and doctor fix-plan
- doctor-pack summary
- curation prepare and ingest
- strict apply-policy
- graph build/query/explain
- route trace with status warnings
- eval V1 thresholds
- source check/diff/review/update dry-run
- export redacted snapshot
- import dry-run
- hook dry-run/install/uninstall with temp config
- MCP manifest/call/serve JSON-RPC

### Privacy Validation

- Search generated dashboard snapshots and fixtures for:
  - `/home/`
  - `/Users/`
  - `C:\\Users\\`
  - `/private/var/`
  - raw prompt fields
  - raw skill body fields
- Verify route traces store `promptHash` and `promptPreview`, not raw prompts.
- Verify snapshots set `redacted: true`.

### Browser Validation

- Start local web server on a known port.
- Verify `/` and `/dashboard` return HTTP 200.
- Run browser smoke at desktop and mobile.
- Capture screenshots at:
  - 1440x1000
  - 1024x768
  - 390x844
  - 320x740
- Manually inspect:
  - landing hero
  - dashboard overview
  - mobile drawer
  - tab rail behavior
  - command palette
  - Route Lab
  - connector blocked/offline/local-snapshot states
  - no overlapping text
  - no page-level horizontal overflow

### Release Evidence Validation

- Save command outputs or JSON summaries.
- Save package dry-run contents.
- Save tarball clean install proof if package state matters.
- Save hook before/after redacted config.
- Save MCP transcript.
- Save screenshot paths.
- Save final `status --json`.

## Risks And Dependencies

- Real skill roots may contain hundreds of skills, duplicate names, missing frontmatter, or script-bearing skills. The plan assumes curation can resolve policy without mutating roots.
- GitHub raw source checks may rate-limit. Unknown states must stay attention-required unless reviewed.
- Hook command paths can become stale after moving checkout or installing from package. Hook dry-run output must expose the exact command path.
- Eval quality depends on real prompts. A synthetic suite can create false confidence.
- Dashboard snapshot generation can accidentally expose paths or prompt text if not tested carefully.
- Web local server port can drift. Browser validation must use the actual responding URL.
- Prior release-candidate evidence in `HANDOFF.md` is useful but stale for this checkout.

## Implementation Orchestrator Handoff

### Source-Of-Truth Contract For First Slice

- First slice goal: make CLI readiness truthful before improving dashboard usefulness.
- Truth owner: `src/core/status.ts`, `src/commands/eval.ts`, `src/commands/sources.ts`, `src/commands/curate.ts`, tests, and docs.
- Boundary: do not touch web UI in the first slice except docs if needed.
- Acceptance evidence:
  - no-inventory status phase fixed
  - eval thresholds fixed
  - source update safety fixed
  - curation/source stale checks improved
  - tests prove all above

### Recommended First Implementation Slice

Implement Phase 1 and Phase 2 together as "personal V1 readiness gates":

1. Add persisted root config and readiness phase.
2. Fix ordered status next actions.
3. Align eval thresholds with V1 docs.
4. Stop fixture evals from counting as readiness.
5. Make source update behavior match docs.
6. Strengthen curation/source staleness.
7. Add focused regression tests.
8. Update docs for the changed gates.

Do not start with dashboard snapshot work. The dashboard should consume truthful status; it should not define truth.

### Phase Order And Dependency Constraints

- Phase 0 before everything.
- Phase 1 before governance gates because gates need roots/artifact phases.
- Phase 2 before hook preflight and dashboard readiness.
- Phase 3 after Phase 2 because real dogfood needs correct gates.
- Phase 4 after at least Phase 2 because dashboard snapshot depends on truthful status.
- Phase 5 after Phase 2 and preferably after Phase 3.
- Phase 6 and Phase 7 after implementation slices have real behavior to document and validate.

### Likely Files To Change

CLI:

- `src/cli.ts`
- `src/core/args.ts`
- `src/core/roots.ts`
- `src/core/status.ts`
- `src/core/fs.ts`
- `src/commands/init.ts`
- `src/commands/scan.ts`
- `src/commands/status.ts`
- `src/commands/eval.ts`
- `src/commands/sources.ts`
- `src/commands/curate.ts`
- `src/commands/export.ts`
- `src/commands/hook.ts`
- `src/schemas/types.ts`

Tests and fixtures:

- `test/*.mjs`
- `test/fixtures/*`

Docs:

- `README.md`
- `HANDOFF.md`
- `docs/first-run.md`
- `docs/dogfood.md`
- `docs/commands.md`
- `docs/security.md`
- `docs/threat-model.md`
- `docs/hooks.md`
- `docs/troubleshooting.md`
- new `docs/personal-v1.md` if useful

Web:

- `apps/web/lib/contracts/skillmap-dashboard.ts`
- `apps/web/lib/fixtures.ts`
- `apps/web/lib/*snapshot*`
- `apps/web/components/skillmap/dashboard-page.tsx`
- `apps/web/scripts/check-fixtures.mjs`
- `apps/web/scripts/browser-smoke.mjs`
- `apps/web/README.md`

### Allowed Changes

- Add CLI flags when they reduce ambiguity.
- Add a `.skillmap/config.yml` or equivalent persisted root config.
- Add status fields as long as JSON remains versioned.
- Add tests and fixtures for personal V1 gates.
- Add dashboard snapshot export and redacted web loading.
- Update docs to match real behavior.

### Disallowed Changes

- No public publish/tag/release.
- No global hook install.
- No hosted backend/auth/billing.
- No automatic source update application.
- No route/hook/MCP LLM calls.
- No raw prompt/body storage.
- No destructive skill-root mutation.

### Required Skills And Tools For Implementation Run

- `implementation-orchestrator` for execution.
- `engineering-acceptance-review` after the first implementation slice.
- `frontend-design` only when implementing dashboard behavior or UI copy/states.
- Context7 if implementation asks about current Next.js/shadcn/library behavior.
- Browser/Playwright checks for web.
- Hindsight/memory as routing context, not proof.

### Open Questions

Block implementation:

- Should `apps/web` be part of personal V1 or a post-V1 local demo? Recommended: include as local dashboard only after snapshot loading exists.
- Which real roots should the first personal config persist? Recommended: `~/.agents/skills` and `~/.codex/skills`, with `~/.claude/skills` optional.

Can resolve during execution:

- Whether root config is YAML or JSON.
- Whether dashboard snapshot is `export --dashboard-snapshot` or a new `dashboard snapshot` command.
- Whether CLI `show` is needed or MCP `show_skill` is enough.
- Exact evidence folder path.

### Stop Conditions

- Stop if source update behavior cannot be made safe without breaking important tests.
- Stop if root config migration risks overwriting existing `.skillmap` artifacts.
- Stop if real-root scan exposes sensitive data that should not be stored in the repo.
- Stop if dashboard snapshot cannot be redacted with automated privacy checks.
- Stop if hook preflight would require global config mutation.

### Do Not Claim Complete Until

- Current checkout validation passes.
- Real-root `.skillmap` artifacts exist.
- Status readiness gates are truthful.
- Eval thresholds match docs and pass on real prompts.
- Source update policy is safe and documented.
- Hook rollback and MCP smoke are proven.
- Dashboard, if in scope, renders a real redacted snapshot and passes browser smoke.
- Evidence packet is saved.

The future implementation orchestrator should turn the chosen slice into its own goal, run implementation and validation cycles, and continue until the slice acceptance criteria are satisfied or a real blocker is documented.

Implementation must not report "verified" unless target-perspective evidence is captured from the real route, payload, record, artifact, trace, rendered UI, or operator-visible output.

## Orchestration Closeout

- Workers actually used: 4
- Worker scopes:
  - CLI/runtime personal workflow readiness
  - Dashboard/local connector readiness
  - Eval/source governance readiness
  - Release/QA/operability readiness
- Worker results accepted:
  - Current checkout is blocked because `.skillmap/` artifacts are missing.
  - Personal V1 should be local-first and evidence-gated, not public release.
  - Dashboard must become redacted local snapshot-backed before it is useful.
  - Eval thresholds and source update behavior must be corrected before readiness claims.
  - Hook and MCP need controlled smoke evidence.
- Worker results rejected:
  - None rejected.
- Worker results unverified:
  - Worker screenshots were existing artifacts; implementation must recapture screenshots on a live server.
  - Prior RC evidence in `HANDOFF.md` was not treated as current proof.
- Parent verification:
  - Read planner skill.
  - Checked repo status and current commit.
  - Confirmed no `.skillmap` directory exists in this checkout.
  - Ran `node dist/cli.js status --json` and confirmed blocked status.
  - Read CLI roots/init/status/export/eval/sources/curate/hook/MCP code paths.
  - Read web contracts, fixtures, and scripts.
  - Used Hindsight memory for stable preference boundaries.
- Gaps that would benefit from more workers:
  - Add a hosted/backend worker only if scope expands past personal V1.
  - Add a public-release worker only if npm/GitHub publication becomes in scope.
- Visible thread considered: yes, rejected because this is a single parent-owned planning artifact.
