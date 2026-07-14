# SkillMap Handoff

Originally created: 2026-07-08
Last reconciled: 2026-07-14
Repo: https://github.com/0x3-team/skillmap
Current canonical branch: `main`
Historical pushed baseline: `2709937347cb4f556ceb0c123306f6db3df8f8af`
Merged operator feature candidate: `69e7d1e7f2042ae996c1bed379891ec65ece84a4`
Operator feature merge on `main`: `8a30578520974257a1ab4ee2f6c7442696ee0289`
Operator feature release tree: `67235ad3ce1553c4b3ba47a36c8e22f9c53cf89c`
Current status: the operator read-plane candidate was locally validated, pushed, accepted by the required scoped remote CI, and merged into canonical GitHub `main` with the identical release tree. Gitea candidate run `50` passed; GitHub Actions run `29294494176` job `86964954830` passed the one-shot self-hosted `hosted-web` scope; GitHub PR `#12` squash-merged the tree; and Gitea protected sync PR `#2` retained the exact GitHub merge commit. Gitea sync-branch run `51`, PR run `52`, and post-merge `main` run `53` all passed. The one-shot runner self-removed and GitHub reported zero registered repository runners afterward. The overall GitHub workflow remained red only because unrelated GitHub-hosted jobs were blocked by the organization allowance, so acceptance is scoped solely to the named hosted-web job. The frozen static receipt is `sha256:7dec38b69c6b709c13f6e0aac4d5f6767411e3a2b2e07b3226b87f16902bdd13`; the frozen database receipt is `sha256:74b8e840a2e1b5343df5daa79d8bbb2bc08d28bdd54ebd51277c9d912bc37fa6`. Those receipts prove source integration and only their recorded CI scopes. The product is not deployed or verified live, and no remote database/web project, OAuth path, backup destination, worker schedule, domain, public indexing, or open-user launch is claimed. Launch remains `NO-GO`.

Current continuation boundary: the service-role-only, bounded, redacted submission summary/list/detail read plane and corrected operator commands are now bound to the second release-ledger row. The raw generated Supabase types remain byte-exact for schema parity, and the web application uses a narrow override for nullable return fields from the three operator `RETURNS TABLE` RPCs. The recorded local database, CLI, root, web, package, adversarial, and scoped remote-CI evidence covers only candidate `69e7d1e7f2042ae996c1bed379891ec65ece84a4` and tree `67235ad3ce1553c4b3ba47a36c8e22f9c53cf89c`; any subsequent product change needs a new row.

Current source continuation: the launch-readiness slice adds atomic confirmed-report enforcement, retained report and lifecycle replay outcomes, paired report pagination, bounded operations alerts, an identifier-free no-store health route, server-owned profile creation time, and a mobile-first save/sign-in action. Its checked-in plan section and append-only implementation-ledger row bind the local acceptance scope without claiming deployment. Exact source integration must be established by the two Gitea jobs and the named one-shot GitHub hosted-web job against the frozen candidate; the provider logs and pull request own that non-self-referential receipt.

## Purpose of this handoff

This document lets a fresh agent continue SkillMap without needing the full original Codex thread. It summarizes what was built, what was validated, what remains intentionally gated, and which artifacts should be treated as source evidence.

Do not duplicate or reinterpret the whole planning history. Use this handoff as the map, then inspect current repo state before editing.

## Product summary

SkillMap is a local-first skill registry, SkillGraph, router, source tracker, and quality system for coding agents.

Current surface boundary: `apps/web` contains a locally validated Supabase-backed catalog, free-account saved-skill flow, exact-commit submission/status/withdrawal, current-version public audit and provisional-grade projections, authenticated suspicious-listing reports, export, self-deletion, and an identifier-free no-store readiness route alongside the separate recorded-fixture/redacted-snapshot dashboard. A constrained server-only worker can claim one queued submission, fetch bounded inert public GitHub bytes, emit static-audit and letterless provisional-grade receipts, complete/requeue it, and publish reviewed metadata through service-only RPCs. A separate service-only read plane summarizes and cursor-pages the submission and report queues, returns bounded redacted exact receipt history without claiming or mutating rows, and evaluates explicit identifier-free operations thresholds; its application type boundary corrects nullable RPC return fields without weakening raw generated-type parity. Confirmed report disposition atomically hides the exact version, and receipt-backed deprecate/quarantine/revoke/restore controls retain their idempotent historical outcomes. The package contains `assets/local-app/v1`, served only by the foreground `skillmap dashboard` loopback connector. Source integration through the operator read-plane tree is pushed, merged, and accepted by the named scoped remote CI; later product changes need their own exact candidate receipt. No hosted path is claimed provisioned, deployed, scheduled, or verified live. Team sync, billing, package mirroring/loading, TUF distribution, advanced hosted routing, and current-letter behavioral grading remain unimplemented or deliberately deferred.

The strongest intended architecture is:

```text
skills live outside the host model prompt context
SkillMap indexes and curates them
user prompt arrives
SkillMap route/MCP selects relevant skills
agent receives compact route advice
agent loads only selected skill content when needed
```

This is different from adding another skill list into Codex. The main value appears when SkillMap becomes the skill access layer, not when it sits on top of an already-loaded host skill registry.

## Historical baseline and current local implementation

The historical baseline commit above passed its then-current CI. The current implementation substantially changes its identity, evidence, export, dashboard, hosted submission/trust workflow, and test contracts. The free-public-alpha candidate is locally validated, pushed, merged, and accepted by the recorded scoped remote CI, but remains experimental because it has not been accepted against a remote database/web environment, live OAuth path, restore/rollback exercise, publisher-authorized receipt-backed corpus publication, or external pilot.

Completed surfaces:

- CLI scan/list/doctor/doctor-pack/status.
- `doctor --fix-plan` review-only repair plan.
- Native Codex curation workflow: `curate codex --prepare` and `curate codex --ingest`.
- Strict policy application and effective registry generation.
- SkillGraph commands: build/query/explain/duplicates/conflicts/export.
- Deterministic route and hook output.
- Passive Codex hook install/uninstall with backup/merge safety.
- Source provenance and update checker: list/adopt/check/diff/update/review.
- Source review receipts for reviewed stale/risky/unknown states.
- Receipt-verified `eval-suite/v3` / `eval-run/v3` support with qualified identities, immutable current/baseline replay, and prompt-free traces; eval v2 and self-labeling suites are candidate/demo evidence and cannot authorize release.
- Local export/import with redaction and conflict reporting.
- Read-only MCP surface: manifest/call/serve.
- First-run, troubleshooting, host compatibility, security, and threat model docs.
- GitHub issue templates.
- Canonical runtime contracts shared by CLI, hook, MCP, API, snapshots, and web adapters.
- Qualified root/path identity and explicit hash-bound canonical duplicate decisions.
- Fenced, fsynced immutable workspace revisions with compare-and-swap publication, last-known-good routing, migration, recovery, verified history, and rollback.
- Capability-authenticated IPv4-loopback connector with origin/CSRF/Host limits, bounded responses, foreground lifecycle, and versioned packaged assets.
- Live local UI routes for onboarding, workspaces, overview, Route Lab, skills/variants, policy, eval, sources, trust, integrations, activity, and settings.
- Bounded redacted route/feedback/job ledgers, restart-safe allowlisted jobs, and explicit cancellation before publication.
- Cross-browser, accessibility, deterministic visual-diff, performance-budget, privacy, failure, migration, and clean-consumer-install test lanes. Gitea covers root/web quality plus restored database/RLS/type authority; GitHub contains a separate complete disposable hosted-browser job for API, Auth, submission, report, and evidence. Candidate `69e7d1e7f2042ae996c1bed379891ec65ece84a4` passed Gitea run `50` and GitHub one-shot self-hosted `hosted-web` job `86964954830`; the identical tree was merged as feature `main` commit `8a30578520974257a1ab4ee2f6c7442696ee0289`, retained through Gitea protected sync PR `#2`, and passed sync-branch run `51`, PR run `52`, and post-merge `main` run `53`. The GitHub acceptance remains scoped to that job rather than the red overall workflow.
- Separate hosted contracts plus local Supabase `api`/`private` schemas, deterministic first-party seeds, RLS/grant tests, public `/skills` and `/api/v1/skills` routes, Supabase SSR auth, free-account saves, exact-commit submissions, constrained audit/provisional-grade processing, operator publication, reports, lifecycle actions, export, and deletion. These are locally implemented, not deployed.
- A 20-version/five-group/six-publisher initial-corpus manifest plus fail-closed preparation and shared-memoized inert audit tooling. All exact trees completed local static audit with two passed, 18 warning, zero blocked, and 20 provisional grade states; every entry remains blocked pending publisher consent and none is a submitted or published database row.

## Historical validation evidence (not current release proof)

The following evidence belongs to the 2026-07-08 baseline. It is retained for history and must not be used as proof that the current worktree is release-ready:

- Commit: `2709937347cb4f556ceb0c123306f6db3df8f8af`
- CI run: https://github.com/0x3-team/skillmap/actions/runs/28982829760
- CI result: success
- `npm ci`: passed with 0 vulnerabilities reported
- `npm run typecheck`: passed
- `npm test`: passed, 16/16 tests
- `npm --cache /private/tmp/skillmap-npm-cache pack --dry-run`: passed
- `npm --cache /private/tmp/skillmap-npm-cache publish --dry-run`: passed
- Clean consumer install from local tarball: passed
- `skillmap status` on copied corpus: `ok`
- Eval: 185 prompts, 183/185 top-1, 185/185 top-3, 0 avoid hits; the current evidence rules classify this self-labeling dataset as demo evidence, not release confidence
- MCP serve JSON-RPC smoke: initialized and listed 6 read-only tools
- Temp hook install/uninstall smoke: passed

Important local evidence artifacts outside the repo:

- `/Users/stevmq/Documents/Codex/2026-07-01/wha/outputs/2026-07-08-skillmap-v1-completion-report.md`
- `/Users/stevmq/Documents/Codex/2026-07-01/wha/outputs/skillmap-v1-dogfood/skillmap-effect-audit.md`
- `/Users/stevmq/Documents/Codex/2026-07-01/wha/outputs/skillmap-v1-dogfood/skillmap-effect-audit.json`
- `/Users/stevmq/Documents/Codex/2026-07-01/wha/outputs/skillmap-v1-dogfood/clean-install-final-latest.json`

These output files are not part of the published package. They are audit evidence from this local workspace.

## Historical demo audit summary

The prior run compared SkillMap to a raw inventory-only lexical baseline over 185 labeled prompts. Under the retained legacy eval-v2 classification this dataset is useful directional/demo evidence, not a release gate; it must be migrated and independently reviewed before it can enter the v3 authority flow.

Results:

- SkillMap top-1: 183/185 = 98.9%
- Baseline top-1: 179/185 = 96.8%
- SkillMap top-3: 185/185 = 100%
- Baseline top-3: 179/185 = 96.8%
- Top-1 gain: +2.2 percentage points, positive but not statistically decisive on this sample
- Top-3 gain: +3.2 percentage points, statistically meaningful on this sample
- Avoid hits: 0 for both
- Mean SkillMap hook output: about 70 chars, about 17.5 tokens
- Full name+description catalog: about 17,523 tokens
- Full skill bodies: about 384,016 tokens

Scientific conclusion:

The directional result supports further testing of context efficiency and governance. It does not prove current release readiness or production routing quality. The honest current claim is compact, policy-backed skill access with explicit evidence gates.

## Current design truth

Codex does not literally dump every full skill body into every prompt by default. The more accurate model is:

- Codex can expose a large skill registry or capability manifest.
- Full skill bodies are loaded progressively when selected or read.
- SkillMap only saves major tokens if the host uses SkillMap as the router/access layer instead of exposing a broad native skill catalog.

Best architecture:

```text
SkillMap = external skill registry + router + policy layer + MCP/CLI loader
```

Not:

```text
SkillMap = another list of skills inside Codex
```

## Release boundary

The repository contains an experimental free-public-alpha implementation that is pushed and merged with scoped remote CI acceptance. It is not deployed, verified live, indexed, publicly launched, tagged, or published. Public release actions remain gated on explicit owner decisions, provider and policy closure, restore/rollback, publisher-authorized receipt-backed corpus publication, pilot, and live-acceptance receipts.

Not yet done:

- `npm publish`
- GitHub tag/release
- Global hook install
- Applying held risky/stale upstream third-party skill updates
- The dedicated five-seat hosted pilot and its mandatory workflow receipts
- Recorded manual screen-reader, keyboard, zoom/reflow, contrast, forced-colors, and operating-system review for the eventual beta candidate
- Remote database/web provisioning, live GitHub OAuth, hosted worker scheduling, encrypted backup/restore, domain/indexing, deployment, or production operations

CI receipt note: Gitea feature run 18 passed `1427e277e46315de5792a973deded1af4c274195`, and main run 19 passed `f9ea0fa0d9711b5b0a61d24555ed9102fff20eb3`; those commits share historical tree `be96e2a71f2b38ded52ac6e1077ebbcd1dc0bbc1`. Historical hosted-foundation feature run 14 passed `00e29a442b3ef03345f25970aa2abff4655d259d`, and main run 15 passed `295dffe031d3010bb241ade75e9f249c97cd6063`. The prior free-public-alpha baseline receipt is Gitea run `44` plus GitHub Actions run `29285742074`, JIT `hosted-web` job `86937705880`, against candidate `67129297d08f7f7bc88800015b336a2a7bb1b139`; its identical tree was squash-merged as `main` commit `29a356a9b809d29ff8c986fbd5a0af78d87e479c`, and post-merge Gitea run `47` passed. The latest product receipt is Gitea candidate run `50` plus GitHub Actions run `29294494176`, one-shot self-hosted `hosted-web` job `86964954830`, against candidate `69e7d1e7f2042ae996c1bed379891ec65ece84a4`; its identical tree was squash-merged as feature `main` commit `8a30578520974257a1ab4ee2f6c7442696ee0289`, retained through Gitea protected sync PR `#2`, and passed Gitea runs `51`, `52`, and `53`. GitHub acceptance is scoped to the named hosted-web job and is not a whole-workflow, deployment, or live-product receipt.

Before public release, a fresh agent should verify current state again because package registries, CI, and repo state can drift.

## Source update state

During copied-root dogfooding, several Matt Pocock skills had upstream drift.

Safe copy-local updates applied during the v1 run:

- `handoff`
- `writing-great-skills`

Held with review receipts:

- `ask-matt`: risky upstream update references renamed flows not present locally.
- `grilling`: risky behavior wording change held.
- `implement`: stale update assumes spec/tickets/code-review naming not present locally.
- `setup-matt-pocock-skills`: stale update assumes to-spec/to-tickets naming not present locally.
- `tdd`: large upstream rewrite held for manual review.
- `diagnosing-bugs`, `edit-article`, `handoff`: latest source check hit GitHub raw 429; held until recheck succeeds.

The original user skill roots were not mutated. Work was performed on copied skill roots under local outputs.

## Suggested skills for next agent

Use these only when relevant:

- `engineering-acceptance-review`: final review before release/publish.
- `checkpoint-quality-loop`: repeat quality gates after any meaningful change.
- `implementation-orchestrator`: if implementing post-v1 changes.
- `planning-orchestrator`: if creating a v1.1 roadmap or public-release plan.
- `codegraph`: inspect blast radius before multi-file refactors if index is available.
- `handoff`: create a new concise handoff after any substantial continuation.

## Recommended next actions

If the next goal is a public CLI/package release:

1. Re-anchor repo state.
2. Run `git status --short --branch`.
3. Run `npm ci`.
4. Run `npm run check:all`, the root and web dependency audits, and the full regression suite from the repo root. Do not run mutating CLI workflows from the repo root because its ignored `.skillmap` state is protected evidence.
5. Run `npm run test:consumer-install` and `npm pack --dry-run`; inspect the exact tarball manifest.
6. Complete every manual item in `docs/ui-acceptance-matrix.md` and five real sessions from `docs/external-pilot-runbook.md` against the exact candidate tarball.
7. Push a reviewed commit and verify the supported Node/OS, browser, privacy, migration, failure, and consumer-install jobs in the approved package-release CI. Record any unavailable provider and scope difference explicitly; this package-only path does not satisfy the hosted alpha's separate dual-provider CI gate.
8. Confirm package name, prerelease version/tag, npm account, trusted-publishing environment, support owner, and visibility with the user.
9. Only after explicit approval: create the immutable tag, publish with provenance, verify a registry install, and create the GitHub release. Report npm, tag, release, and any web deployment as separate states.

If the next goal is product improvement:

1. Build a true no-SkillMap human/agent A/B test, not only raw lexical baseline.
2. Add a `show`/`load` command for selected skill content if not already sufficient through MCP `show_skill`.
3. Improve host integration so Codex/Claude can avoid broad native skill registry exposure.
4. Continue the authorized hosted-registry phases only through their explicit evidence gates; do not collapse local runtime, hosted catalog, package, grade, and router authority into one state.
5. Expand evals with real missed routes from daily use, not only generated examples.

If the next goal is the private hosted alpha:

1. Obtain explicit approval for a zero-cost-compatible database and web-provider path, ownership, plan limits, region, and free-tier backup/pausing constraints. Do not create, upgrade, or attach a paid provider resource.
2. Create the SkillMap database and web projects only after that approval, then record project ownership, region, plan, deployment/rollback commands, and owners without committing credentials.
3. Configure the GitHub OAuth app, Supabase provider, exact site/callback URLs, and approved web-host environment variables from `docs/operations/hosted-alpha-deploy.md`.
4. Apply the checked-in migrations and seed, verify generated-type parity and backup/restore readiness, then deploy the exact reviewed commit.
5. Run anonymous catalog, authenticated save/unsave/submission/report/export/deletion, worker publication/lifecycle, cross-account isolation, OAuth, cache-policy, mobile, accessibility, restore, and rollback acceptance against the exact live private-alpha deployment before calling it verified live or inviting the dedicated five-seat hosted cohort.
6. Obtain and retain redacted publisher-consent references, ingest the pinned 20-version corpus through normal quota-aware submissions, and verify every receipt-backed public listing before enabling indexing.

## Important constraints

- Do not mutate original user skill roots unless the user explicitly asks.
- Do not install global hooks without explicit approval.
- Do not publish npm, create tags, or create GitHub releases without explicit approval.
- Treat local outputs as evidence, not package artifacts.
- Preserve the local-first runtime and privacy boundary while implementing the now-authorized hosted catalog as a separate online trust plane.
- Be honest about benefits: large context savings, modest measured routing quality improvement.

## Quick commands for a fresh agent

```bash
cd /home/codex/projects/skillmap
git status --short --branch
npm run typecheck
npm test
npm run check:web
npm run test:consumer-install
npm pack --dry-run
```

Run CLI workflow reproductions only in a disposable consumer workspace, for
example:

```bash
WORKSPACE="$(mktemp -d)"
cd "$WORKSPACE"
node /home/codex/projects/skillmap/dist/cli.js --help
```

Never use the repository directory as the working directory for `init`,
`scan`, `state`, `policy`, `eval --save-report`, or another command that writes
`.skillmap`; earlier acceptance work proved that doing so can overwrite ignored
evidence even while tracked files remain untouched.
