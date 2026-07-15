# SkillMap Handoff

Originally created: 2026-07-08
Last reconciled: 2026-07-15
Repo: https://github.com/0x3-team/skillmap
Current canonical branch: `main`
Historical pushed baseline: `2709937347cb4f556ceb0c123306f6db3df8f8af`
Previous dual-remote source anchor: `5b9fb6e49ee3fcbcfc63336c810cbb1cc3bff93a`
Latest accepted product-code candidate: `33e66c4175676355c275db091eb876bae81e29cf`
Latest accepted product-code merge: `72ce471f378db36dfeb4faa31ec52c05e2e57654`
Latest accepted product-code tree: `c0fc2ce7e8d4584ee2f7ed5ae2fb72e54b69ade6`
Current status: the product-checkpoint candidate `33e66c4175676355c275db091eb876bae81e29cf` was frozen from direct parent `5b9fb6e49ee3fcbcfc63336c810cbb1cc3bff93a`, locally validated, pushed, accepted by protected Gitea candidate run ID `78` (UI run `61`), and accepted for the exact commit by GitHub Actions run `29388840669` one-shot self-hosted hosted-web job `87267621311`, which passed all fifteen target steps and retained unexpired artifact `8332525171`. GitHub PR `#19` squash-merged the identical tree as product-code merge `72ce471f378db36dfeb4faa31ec52c05e2e57654` at 2026-07-15T04:32:15Z. Protected Gitea PR `#9` fast-forwarded that exact merge at 2026-07-15T04:46:15Z after sync-branch run ID `79` (UI `62`) and PR run ID `80` (UI `63`) passed; post-merge `main` run ID `81` (UI `64`) then passed both required jobs. The one-shot runner and isolated resources were removed. At that integration point both remotes resolved the exact merge and tree; moving branch heads must still be verified live rather than inferred from this handoff. The product is not deployed or verified live, and no remote database/web project, OAuth path, backup destination, worker schedule, domain, public indexing, or open-user launch is claimed. Launch remains `NO-GO`.

Current continuation boundary: the exact accepted product-code evidence covers candidate `33e66c4175676355c275db091eb876bae81e29cf` and tree `c0fc2ce7e8d4584ee2f7ed5ae2fb72e54b69ade6`; product merge `72ce471f378db36dfeb4faa31ec52c05e2e57654` has that identical tree and direct parent `5b9fb6e49ee3fcbcfc63336c810cbb1cc3bff93a`. The later documentation/tests-only receipt descendant records this evidence but does not create a new product candidate or change the accepted product tree. Verify GitHub and Gitea moving heads live before operational work, and require every later product change to obtain its own candidate, CI, merge, and append-only receipt. The raw generated Supabase types remain byte-exact for schema parity, and the web application uses a narrow override for nullable return fields from the three operator `RETURNS TABLE` RPCs.

Current source continuation: opaque binary/non-UTF-8 source is an audit and grade hard gate; report intake requires current publisher authorization; literal visitor and submitter acquisition paths expose recorded freshness without inventing a current verdict; and five consequential operator RPCs require an exact short-lived approval plus execution by a distinct role-scoped operator. The accepted product checkpoint additionally pins worker/audit/grade evidence authority and closes report idempotency/recovery, accessibility, production-seed, metadata, CI-source, and release-truth gaps. Its exact local, candidate-CI, one-shot GitHub, merge, protected-sync, and cleanup receipts are recorded below. Nothing is deployed or verified live.

## Purpose of this handoff

This document lets a fresh agent continue SkillMap without needing the full original Codex thread. It summarizes what was built, what was validated, what remains intentionally gated, and which artifacts should be treated as source evidence.

Do not duplicate or reinterpret the whole planning history. Use this handoff as the map, then inspect current repo state before editing.

## Product summary

SkillMap is a local-first skill registry, SkillGraph, router, source tracker, and quality system for coding agents.

Current surface boundary: `apps/web` contains a locally validated Supabase-backed catalog, free-account saved-skill flow, exact-commit submission/status/withdrawal, current-version public audit and provisional-grade projections, authenticated suspicious-listing reports, export, self-deletion, and an identifier-free no-store readiness route alongside the separate recorded-fixture/redacted-snapshot dashboard. A constrained server-only worker can claim one queued submission, fetch bounded inert public GitHub bytes, emit static-audit and letterless provisional-grade receipts, complete/requeue it, and publish reviewed metadata through dual-controlled service-only RPCs. A separate service-only read plane summarizes and cursor-pages the submission and report queues, returns bounded redacted exact receipt history without claiming or mutating rows, and evaluates explicit identifier-free operations thresholds; its application type boundary corrects nullable RPC return fields without weakening raw generated-type parity. Confirmed report disposition atomically hides the exact version, and receipt-backed deprecate/quarantine/revoke/restore controls retain their idempotent historical outcomes. The package contains `assets/local-app/v1`, served only by the foreground `skillmap dashboard` loopback connector. Source integration through product-checkpoint candidate `33e66c4175676355c275db091eb876bae81e29cf` is pushed, merged as product-code commit `72ce471f378db36dfeb4faa31ec52c05e2e57654`, protected-dual-remote reconciled, and accepted by the named scoped remote CI. No hosted path is claimed provisioned, deployed, scheduled, or verified live. Team sync, billing, package mirroring/loading, TUF distribution, advanced hosted routing, and current-letter behavioral grading remain unimplemented or deliberately deferred.

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

## Historical baseline and accepted checkpoint implementation

The historical baseline and go-to-market candidates retain their recorded scopes. The later product-checkpoint candidate `33e66c4175676355c275db091eb876bae81e29cf` is now the latest accepted product-code boundary, merged as `72ce471f378db36dfeb4faa31ec52c05e2e57654`; the exact scoped receipts are recorded in the append-only ledgers. The free-public-alpha source remains experimental because no remote database/web environment, live OAuth path, restore/rollback exercise, publisher-authorized receipt-backed corpus publication, or external pilot has been accepted.

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
- Cross-browser, accessibility, deterministic visual-diff, performance-budget, privacy, failure, migration, and clean-consumer-install test lanes. Gitea covers root/web quality plus restored database/RLS/type authority; GitHub contains a separate complete disposable hosted-browser job for API, Auth, submission, report, and evidence. Candidate `33e66c4175676355c275db091eb876bae81e29cf` passed Gitea candidate run ID `78` (UI `61`) and GitHub one-shot self-hosted hosted-web job `87267621311`; the identical tree was merged as product-code commit `72ce471f378db36dfeb4faa31ec52c05e2e57654`, retained through Gitea protected sync PR `#9`, and passed sync-branch run ID `79` (UI `62`), PR run ID `80` (UI `63`), and post-merge `main` run ID `81` (UI `64`). The GitHub acceptance remains scoped to that job rather than the red overall workflow.
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

The repository contains an experimental free-public-alpha implementation through the product checkpoint that is pushed, merged, protected-dual-remote reconciled, and accepted by the named scoped remote CI. It is not deployed, verified live, indexed, publicly launched, tagged, or published. Public release actions remain gated on explicit owner decisions, provider and policy closure, restore/rollback, publisher-authorized receipt-backed corpus publication, pilot, and live-acceptance receipts.

Not yet done:

- `npm publish`
- GitHub tag/release
- Global hook install
- Applying held risky/stale upstream third-party skill updates
- The dedicated five-seat hosted pilot and its mandatory workflow receipts
- Recorded manual screen-reader, keyboard, zoom/reflow, contrast, forced-colors, and operating-system review for the eventual beta candidate
- Remote database/web provisioning, live GitHub OAuth, hosted worker scheduling, encrypted backup/restore, domain/indexing, deployment, or production operations

CI receipt note: Gitea feature run 18 passed `1427e277e46315de5792a973deded1af4c274195`, and main run 19 passed `f9ea0fa0d9711b5b0a61d24555ed9102fff20eb3`; those commits share historical tree `be96e2a71f2b38ded52ac6e1077ebbcd1dc0bbc1`. Historical hosted-foundation feature run 14 passed `00e29a442b3ef03345f25970aa2abff4655d259d`, and main run 15 passed `295dffe031d3010bb241ade75e9f249c97cd6063`. The prior free-public-alpha baseline receipt is Gitea run `44` plus GitHub Actions run `29285742074`, JIT `hosted-web` job `86937705880`, against candidate `67129297d08f7f7bc88800015b336a2a7bb1b139`; its identical tree was squash-merged as `main` commit `29a356a9b809d29ff8c986fbd5a0af78d87e479c`, and post-merge Gitea run `47` passed. The operator read-plane receipt is Gitea candidate run `50` plus GitHub Actions run `29294494176`, one-shot self-hosted hosted-web job `86964954830`, against candidate `69e7d1e7f2042ae996c1bed379891ec65ece84a4`; its identical tree was squash-merged as feature `main` commit `8a30578520974257a1ab4ee2f6c7442696ee0289`, retained through Gitea protected sync PR `#2`, and passed Gitea runs `51`, `52`, and `53`. The launch-readiness receipt is Gitea candidate run `57` plus GitHub Actions run `29299879085`, one-shot self-hosted hosted-web job `86981228569`, against candidate `e6fc09e9d8300fbd5bb974899cb18b5d1b2d8af6`; its identical tree was squash-merged through GitHub PR `#14` as `main` commit `426efb1af480dff57713d604bac617cea0e00ef2`, retained through Gitea protected sync PR `#4`, and passed Gitea runs `58`, `59`, and `60`. The completion-audit receipt is Gitea candidate run `61` plus GitHub Actions run `29304994899`, one-shot self-hosted hosted-web job `86996452876`, against candidate `918a5015bcb8c264f9fe39c6cdd7940e67aef02e`; its identical tree was squash-merged through GitHub PR `#15` as `main` commit `a4f97fa0d32b1abaaf29bc38f81d81cbc593b04b`, retained through Gitea protected sync PR `#5`, and passed Gitea runs `62`, `63`, and `64`. The go-to-market/dual-control receipt is Gitea candidate run ID `70` (UI `53`) plus GitHub Actions run `29317179590`, one-shot self-hosted hosted-web job `87033792983`, against candidate `413d8759e244005406280cd8d7c2fe2ec01b84bf`; its identical tree was squash-merged through GitHub PR `#17` as product-code commit `8bb2b1d25befeb53e13d0e05a6934dacc9d45cd7`, retained through Gitea protected sync PR `#7`, and passed Gitea run IDs `71`, `72`, and `73` (UI `54`, `55`, and `56`). The latest product-code receipt is candidate `33e66c4175676355c275db091eb876bae81e29cf`, Gitea run IDs `78` through `81` (UI `61` through `64`), GitHub Actions run `29388840669` named one-shot job `87267621311`, GitHub PR `#19`, Gitea protected sync PR `#9`, and product-code merge `72ce471f378db36dfeb4faa31ec52c05e2e57654`. GitHub acceptance is scoped to the named hosted-web job and is not a whole-workflow, deployment, or live-product receipt.

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
4. Apply the checked-in migrations without the local development seed, verify generated-type parity and backup/restore readiness, then deploy the exact reviewed commit.
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
