# SkillMap Free Public Launch Implementation Plan

Date: 2026-07-12
Status: active implementation authority
Parent program: `implementation-orchestrator`
Repository: `/home/codex/projects/skillmap`
Branch at plan creation: `codex/hosted-library-foundation`
Baseline commit: `bb054b7`
Receipt ledger: `docs/plans/2026-07-12-skillmap-free-public-launch-implementation-plan-implementation-ledger.jsonl`
Release ledger: `docs/plans/2026-07-12-skillmap-release-ledger.md`

Latest product release truth: launch-readiness candidate
`e6fc09e9d8300fbd5bb974899cb18b5d1b2d8af6` with tree
`94c910c02b224bd421905126da7c783a8f3fb0d7` was locally validated, pushed,
accepted by the named scoped remote CI, and squash-merged as feature `main`
commit `426efb1af480dff57713d604bac617cea0e00ef2`. Gitea protected sync PR `#4`
retained that exact commit. The GitHub acceptance is scoped only to one-shot
self-hosted hosted-web job `86981228569`; unrelated allowance-blocked
GitHub-hosted jobs left the overall workflow red. This closes source integration
through that product tree only. No deployment, live verification, public
indexing, or open-user launch is claimed; the public-launch verdict remains
`NO-GO`. Any subsequent product slice requires a new candidate/merge receipt in
the release ledger before this source gate can be treated as covering it.

## Executive decision

Launch SkillMap first as a free public skill directory and trust workflow, not as a package marketplace or billing product.

The launch wedge is one complete, truthful loop:

```text
discover -> sign in -> submit an exact GitHub skill version
         -> bounded static audit -> reproducible grade receipt
         -> operator review -> public canonical skill page
         -> save, report, update, deprecate, or revoke
```

The first public release remains metadata-only for third-party submissions. It links to exact public GitHub commits, does not mirror or execute submitted packages, does not run untrusted scripts, does not upload user prompts, and contains no billing, Stripe, entitlement, or paid-account dependency.

This plan deliberately narrows the older eight-phase product design into the smallest marketable public product. Package/TUF loading, the advanced portfolio router, a Codex plugin, private teams, and payments remain later programs. They are not launch dependencies for users to discover, submit, audit, grade, save, and review skills.

## Source-of-truth boundary

This plan inherits stable contracts and safety decisions from:

- `docs/plans/2026-07-11-skillmap-hosted-skill-library-launch-implementation-plan.md`
- `docs/specs/hosted-identity-v1.md`
- `docs/specs/evidence-states-v1.md`
- `docs/specs/grade-receipt-v1.md`
- `docs/specs/package-format-v1.md`
- `docs/architecture/hosted-registry.md`
- `docs/security/hosted-threat-model.md`
- `docs/operations/hosted-alpha-deploy.md`
- `HANDOFF.md`
- the checked-in contracts, migrations, generated database types, tests, and current application code

When prose and executable artifacts disagree, the checked-in contract, migration, RLS test, or implementation owns current behavior. The ledger records every later change to that truth.

## Baseline at plan creation

Already implemented and locally accepted at plan creation:

- public Supabase-backed catalog list and detail
- bounded public API with no-store behavior and explicit missing-configuration failure
- GitHub OAuth integration points
- free account profile, save, unsave, and stable saved-skill pagination
- explicit `api` and `private` schemas, forced RLS, grants, public projections, immutable version coordinates, and three truthful first-party seeds
- independent provenance, audit, compatibility, lifecycle, license, redistribution, and grade states
- root CLI/local application, deterministic router, doctor, source tracking, eval, and passive hook boundaries
- CI lanes for root/web quality and local database reset, lint, pgTAP, and generated-type drift

Not implemented at this baseline:

- user skill submissions or publisher workflow
- a submission queue or operator review workflow
- automated hosted ingestion, audit, grade, publication, update, deprecation, revocation, or appeal
- public audit and grade receipt detail
- abuse reporting and public launch analytics
- remote database/web projects, live OAuth, canonical domain, backup/restore receipt, deployment, or live acceptance

Existing local validation was not deployment proof. At plan creation, the branch was ahead of its remote and retained user-owned uncommitted `.gitignore`, `.chunk/`, `.claude/`, and `.codex/` state that this program could not overwrite or commit. The later frozen candidate excluded that state and closed the scoped source-integration gate recorded at the top of this plan; deployment and live acceptance remain open.

## Definition of market-ready

SkillMap is ready to invite public users only when all of the following are true.

### Anonymous visitor

- can understand the product promise and current alpha limits
- can search and browse real catalog data
- can open a canonical skill page whose current source version and bounded evidence are explicit; permanent historical-version URLs remain post-alpha
- can distinguish source identity, license, compatibility, audit, grade, freshness, and lifecycle states
- can inspect the public portion of an audit and grade receipt
- can start a suspicious-listing report and is asked to sign in before submitting it; anonymous report submission remains deferred until provider-level anti-spam is configured

### Free account user

- can sign in with GitHub, sign out, save, and unsave skills
- can export and delete the account data SkillMap owns
- can submit an exact public GitHub repository, immutable commit, relative `SKILL.md` path, version label, and license claim
- receives validation errors without losing safe form input
- can see every own submission and its current state, timestamps, public result, and bounded remediation message
- can withdraw a queued submission but cannot forge review, audit, grade, or publication state
- never needs a credit card and never encounters billing or entitlement UI

### Reviewer/operator

- can claim and process a queued submission with one documented command
- can reproduce source fetch, normalization, audit, compatibility, and grading from an immutable commit
- can accept, request changes, reject, publish, deprecate, quarantine, revoke, restore, and replay without ad hoc production row edits
- can see idempotency, source digest, worker version, rubric version, host profile, reason codes, and consequential audit events
- can stop publication on license ambiguity, unsafe content, incomplete evidence, duplicate identity, or source drift

### Public trust

- no submitted code is executed
- a submission cannot become public through a browser-controlled field
- all public grades are version-bound, reproducible, explainable, and current; incomplete evidence is visibly provisional or blocked
- hidden, draft, processing, rejected, quarantined, revoked, restricted, and legally unavailable records do not leak
- two users cannot read or mutate each other's submissions
- a worker or webhook retry cannot create duplicate public consequences

### Operations

- the exact candidate passes both current Gitea authority lanes and the GitHub `hosted-web-browser` lane, plus dependency, migration, RLS, contract, type-drift, browser, accessibility, responsive, performance, privacy, and secret-canary gates; an unavailable required CI provider remains `NO-GO`
- provider ownership, region, plan, cost boundary, OAuth app, domain, backup owner, incident owner, and rollback owner are recorded
- backup and restore, revocation, worker replay, and web rollback are exercised
- an exact commit is pushed, deployed, and verified live; those states are recorded separately
- the dedicated five-seat hosted pilot passes: at least four participants finish uncoached and uncoached receipts cover browse/evidence, save/return, submit/status, and author follow-through through receipt-backed publication inspection

## Product scope

### Required for free public launch

- public search, catalog, detail, receipt, trust, security, privacy, support, and release-status surfaces
- free GitHub account and saved skills
- exact-commit public GitHub submission
- user-owned submission dashboard and withdrawal
- deterministic bounded source fetch and static audit
- deterministic internal package normalization, versioned rubric, behavioral evaluation, and grade receipt
- reviewer queue and documented operator commands
- publication, update, deprecation, quarantine, revocation, restore, and audit trail
- abuse/report intake with anti-spam controls and operator disposition
- privacy-safe aggregate launch metrics
- canonical metadata, sitemap, robots/indexing policy, social cards, and launch copy
- deployment, backup/restore, monitoring, incident, rollback, and support runbooks

### Explicitly deferred

- billing, Stripe, entitlements, trials, paid accounts, or publisher payments
- private organizations, SSO, SCIM, enterprise RBAC, or private source ingestion
- arbitrary Git providers or private repositories
- package mirroring, TUF distribution, automatic installation, or execution
- hosted raw prompt collection
- advanced hosted routing, route playground authority, or a new Codex plugin
- a claim to index every skill on the internet

## Launch architecture

### Trust planes

```text
browser/authenticated user
  -> api.skill_submissions under auth.uid() RLS
  -> own submission status only

operator worker with server-only secret
  -> claim one queued submission through a service-role-only RPC
  -> fetch exact allowlisted GitHub bytes with size/time bounds
  -> normalize and hash without executing content
  -> write immutable audit/compatibility/grade receipts
  -> request changes, reject, or publish transactionally

anonymous catalog
  -> security-invoker public projections only
  -> current published/non-revoked version and bounded public receipts
```

The browser receives only the Supabase publishable key. The service-role/secret key is confined to the operator worker environment and is never exposed to Next.js client code, screenshots, logs, or deployment metadata.

### Initial ingestion profile

Accepted source coordinates:

- `https://github.com/<owner>/<repository>` with no credentials, query, fragment, or alternate host
- a lowercase immutable 40- or 64-hex commit
- one safe relative path ending in `SKILL.md`
- one bounded version label
- an optional submitter license claim that never becomes verified evidence by itself

The worker follows only allowlisted GitHub endpoints, rejects cross-host redirects, applies a short timeout and byte limit, records response identity, hashes exact bytes, and never evaluates Markdown, HTML, shell, JavaScript, Python, or binaries.

The worker may build an inert, bounded normalized evaluation package and inventory the submitted tree. That package is private evaluation evidence, not a public download or installation artifact. Public package distribution and TUF remain deferred.

### Submission state machine

```text
queued -> processing -> accepted -> published
   |          |             |
   |          +-> changes-requested -> queued
   |          +-> rejected
   |          +-> failed -> queued
   +-> withdrawn
```

Rules:

- users may insert only `queued` rows owned by `auth.uid()`
- users may change only their own eligible row to `withdrawn`
- users cannot set receipt IDs, reviewer fields, status messages, or public skill IDs
- only the worker may claim, complete, retry, or publish
- source coordinates are immutable after insertion; a changed commit is a new submission/version
- every transition produces an append-only event
- duplicate delivery or retry is idempotent on submission ID plus source digest plus worker version

### Audit state

The static audit emits bounded checks with stable codes and severities. Launch checks include:

- exact source fetch and content digest
- valid bounded YAML frontmatter
- safe name and meaningful description
- body present and within size limits
- broad trigger language
- prompt-injection or instruction-confusion patterns
- executable/script, binary, network, tool, secret, credential, and destructive-command indicators
- relative link/path safety
- declared license evidence and redistribution disposition
- duplicate identity/content signals against the current catalog
- Codex host-profile compatibility

Audit outcomes are `passed`, `warnings`, or `blocked`. Findings are evidence, not claims that a skill is harmless.

### Grade state and rubric

The launch rubric is deterministic and versioned. It produces:

- hard-gate results
- dimension scores
- a total score from 0 to 100
- a confidence value
- an optional letter band
- stable reason codes
- a canonical receipt digest

Initial dimensions:

| Dimension | Weight | Launch evidence |
| --- | ---: | --- |
| Instruction quality | 25 | frontmatter, task clarity, bounded workflow, outputs |
| Safety and permissions | 25 | static risk checks, script/network/tool disclosure |
| Routing quality | 20 | distinct triggers, exclusions, breadth, description quality |
| Reproducibility | 15 | exact source identity, deterministic content, references |
| Maintenance and provenance | 15 | commit pin, repository identity, license disposition, freshness |

Bands: A `>= 90`, B `>= 80`, C `>= 70`, D `>= 60`, F `< 60`.

A letter band is forbidden when a hard gate fails. Hard gates include invalid source identity, unreadable or oversized content, invalid required frontmatter, detected secret/credential material, unsafe path behavior, restricted redistribution, unresolved license policy, critical prompt-injection behavior, incomplete host-compatibility evidence, or missing required behavioral evaluation. Such receipts are `blocked`; incomplete but non-critical evidence is `provisional` with no band. Only a receipt bound to the normalized package, audit, compatibility, baseline, frozen suite, evaluator, and rubric can be `current`. Static inspection alone never earns a current letter grade.

The UI never collapses publisher verification, provenance, static audit, host compatibility, and grade into one "safe" badge.

## Data model changes

### Exposed account-owned tables

- `api.skill_submissions`
  - immutable source coordinates and submitter
  - current workflow state
  - bounded user-visible status and remediation
  - receipt/public-result references
  - created, submitted, claimed, completed, and updated timestamps
- `api.skill_reports`
  - reporter-owned authenticated opaque intake with per-account duplicate suppression and cooldowns
  - category, bounded message, target skill/version, status, and timestamps

Anonymous report submission is not part of the first public alpha. The public detail page exposes the report route, but final submission requires a free authenticated account. This is an intentional abuse boundary until a production provider-level global limiter and anonymous case-receipt design are reviewed; it is not represented as anonymous coverage.

### Private canonical tables

- `private.skill_audit_receipts`
- `private.skill_grade_receipts`
- `private.submission_events`
- `private.review_cases`
- `private.worker_runs`

Receipt rows are append-only. Public receipt projections expose only bounded checks, scores, reason codes, versions, digests, and timestamps; private raw responses, operator notes, identifiers, and credentials never enter public views.

### Operator functions

Only service-role/worker authority receives execute permission for:

- claim next or exact queued submission
- record failed attempt with bounded retry
- request changes or reject
- accept and publish transactionally
- deprecate, quarantine, revoke, and restore
- replay a failed job idempotently

Every `security definer` function sets an empty search path, validates the JWT role, uses fully qualified identifiers, exposes no arbitrary SQL, and has pgTAP coverage for grants and adversarial inputs.

## Implementation program

Each batch must end with focused tests, updated generated artifacts, a ledger receipt, `git diff --check`, and an explicit local/live/pushed/deployed status.

### Local candidate scope reconciliation

The implemented launch candidate uses a one-shot queue command intended for a reviewed scheduler rather than a permanently draining daemon. Public audit and grade pages are current-version routes at `/skills/[publisher]/[slug]/audit` and `/skills/[publisher]/[slug]/grade`, backed by bounded security-invoker views; they deliberately identify themselves as current evidence projections, not full `projectionDigest` receipt envelopes or permanent historical-receipt URLs. Historical version pages, historical receipt permalinks, and public tombstones remain a post-alpha trust program and must not be claimed at launch.

Authenticated report intake, the owner report history, service-only queue/disposition, and lifecycle controls are in the local candidate. Anonymous intake, formal appeal/legal-hold case management, production-global rate limiting, aggregate visitor analytics, hosted alerts, encrypted off-host restore, and provider rollback remain deployment/policy work. The public alpha may use truthful provisional numeric grades with no letter; any current letter remains blocked until the required signed compatibility and behavioral evidence path is operated.

### 2026-07-13 launch-gap closure

The first committed candidate exposed four locally actionable gaps under a fresh adversarial and pilot-readiness pass. The current working candidate closes them without changing the public trust boundary:

- server validation on `/submit` now returns a bounded field-local error without navigation, preserving every other safe input, both acknowledgements, and the stable idempotency request ID; the no-JavaScript fallback remains fail closed;
- `SKILLMAP_RELEASE_STAGE` now selects truthful `local-candidate`, `private-alpha`, or `public-alpha` copy, while public indexing requires the exact independent pair `SKILLMAP_RELEASE_STAGE=public-alpha` and `SKILLMAP_INDEXING_MODE=public`; `robots.txt` is request-time dynamic so a build cannot freeze the wrong directive;
- the composed hosted browser gate now runs API, authenticated account, submission, report, export/deletion, no-row evidence, and real receipt-row rendering against a disposable local Supabase stack, treats synthetic cleanup/postcondition failure as fatal, emits pass only after zero auth/publisher/repository/skill/version rows remain, and is explicitly bound in GitHub CI;
- the visual harness now guards only the generated workspace and revision labels during the two screenshot paints, proves a simulated late refresh is normalized before paint, and disconnects immediately after capture so later functional behavior remains observable.

At that checkpoint, these fixes improved local candidate evidence only. They did not change the external provider, push, deploy, OAuth, restore, corpus, pilot, policy, or live-verification gates. The later source-integration receipt is recorded below.

### 2026-07-13 completion audit and launch-readiness remediation

Three bounded audits covered the complete product journey, the audit/grading backend, and release/go-to-market operations. A separate integrated adversarial review then challenged the combined candidate. No P0 issue was found. Every locally actionable P1/P2 issue was accepted and closed in the working candidate:

- public listings and evidence pages now bind the exact GitHub commit/path, publisher, lifecycle, publish/update timestamps, and owner follow-through links; audit and grade output is semantic first with bounded raw JSON available only as supporting detail;
- report outcomes are database-verified or short-lived same-browser receipts rather than trusted query strings, field-local report errors preserve bounded input, and the streamed Next.js surface explicitly states its JavaScript requirement instead of claiming unsupported no-JavaScript continuity;
- save/unsave now uses a native same-origin POST/303 route with owner/RLS enforcement and a validated public-origin redirect; speculative prefetch is disabled on high-cardinality operational links so catalog browsing cannot consume the same-browser request budget;
- 320 px, 390 px, 200% zoom, keyboard, visible-focus, forced-colors, semantic-control, invalid-query-heading, Chromium, Firefox, and WebKit cases are enforced by the hosted frontend gate with nine deterministic zero-diff baselines and zero unexpected browser diagnostics;
- completion-time collision evidence and publication eligibility are rechecked under advisory locks, a fifth expired claim dead-letters idempotently, collision disposition is immutable, and a blocked provisional grade may omit a compatibility digest only when the exact failed compatibility hard gate explains it;
- operator CLI paths now expose dead-letter, collision-list, and collision-review workflows, with pgTAP and static contract coverage for their authority boundaries;
- hosted synthetic cleanup is fatal and proves zero remaining auth, publisher, repository, skill, and version rows; both Gitea quality authority and the exact GitHub hosted-browser lane remain mandatory, with zero-cost-compatible infrastructure as a launch constraint rather than a paid fallback;
- canonical social images, public support configuration, pilot workflow coverage, deployment/runbook language, launch cleanup, and candidate-binding documentation now agree with the implemented product.

The integrated local acceptance result at that checkpoint was: root tests `376/376`, contracts `34/34`, pgTAP `341/341`, hosted boundary tests `29/29`, release path `47/47`, production dependency audits with zero vulnerabilities, all three hosted auth browsers, the complete hosted launch flow, nine zero-diff hosted baselines, accessibility, forced-colors, responsive, performance, packaging, and post-cleanup database validation passed. Those remain local receipts. The later scoped remote-CI closure is recorded separately below; deployment and live acceptance remain absent.

The next locally actionable launch slice was the initial corpus: prepare at least 20 exact, license-evidenced skill versions across at least five useful comparison groups, then qualify each version through the inert audit and provisional-grade path. That preparation is now complete as described below. Authenticated submission, receipt-backed publication, provider ownership, domain, OAuth, public policy/support identity, hosted restore/rollback, named operators, five-seat pilot, deployment, and live verification remain external `NO-GO` gates.

### 2026-07-13 initial-corpus preparation and inert audit

The local launch corpus is pinned in `docs/launch/initial-corpus-v1.json` and operated through `docs/launch/initial-corpus-operations.md`:

- exactly 20 immutable GitHub versions cover five comparison groups with four alternatives or complements per group and six repository owners;
- every selected `SKILL.md` and Apache-2.0/MIT evidence path was verified at the exact commit; unclear, missing, CC-only, proprietary, conflicting, and deprecated sources were excluded;
- the deterministic preparer rejects mutable refs, duplicate coordinates, unsafe paths, unresolved license expressions, publisher mismatches, unknown fields, and fewer than 20 entries or five groups;
- the preparation digest is `sha256:b4e993e0a40ecb7b26c713b459b433af5353895a66d21034bbb0537fad96524a`;
- the shared-memoized, unauthenticated, inert GitHub audit completed `20/20` with zero fetch failures, two `passed` audits, 18 `warnings` audits, zero `blocked` audits, and 20 truthful `provisional` grades; its owner-only local receipt digest is `sha256:156ff3ead25ff7af9400f44c028cb00134410b50fcf0df927cac89e2ecc071cf`;
- no source content was executed and no database, production service, account submission, consent, publication, current letter grade, or public launch authority was used.

All 20 entries intentionally remain `blocked-pending-publisher-consent`. Public visibility and an open-source license are not presented as publisher endorsement. The launch corpus gate closes only after reviewed consent/authority, normal quota-aware authenticated submissions, service-role audit receipts, collision review, receipt-backed publication, and deployed public-route verification exist for all 20 versions.

### 2026-07-13 final mutation and publication-authority closure

The final locally actionable trust gaps were closed before freezing a release candidate:

- save/remove and account-deletion success now require bounded same-browser HttpOnly receipts, while submission success notices require matching account-owned database state; forged query-string success is suppressed;
- recoverable and transport-level submission failures preserve the canonical inputs, acknowledgements, and stable request ID, clear pending state, and move focus to an actionable alert;
- the published submission contract is explicitly letterless and provisional, so static evidence cannot fabricate a current grade;
- exact license evidence is append-only and claim-scoped, supports only explicitly fetched root or enclosing `LICENSE`/`COPYING` files at the submitted immutable commit, and remains retryable after a worker crash between evidence recording and completion;
- publisher authorization is append-only, exact-source and exact-publisher bound, required and unexpired at the public RLS boundary, and an exact post-publication revocation atomically blocks, quarantines, and revokes the source-derived version across accounts and publisher handles; a narrow account-detached tombstone prevents identity-transfer and resubmission replay after account deletion;
- collision approval for an update binds the exact current publisher, skill, and version target, while an expired replaced claim records a durable cancelled worker-run receipt;
- authorization and publication share an exact-source transaction lock and recheck wall-clock expiry, revocation, the full active catalog graph, and exact version coordinates after locking; stale authorized and publication replays fail closed;
- audit, grade, and license receipt validators reject JSON-null or incorrectly typed authority scalars, and callers require an explicit `TRUE` result rather than accepting SQL-null predicates;
- operator commands expose publisher authorization/revocation, license evidence, collision review, dead-letter, lifecycle, and report disposition boundaries; the static preflight now hard-binds worker startup through `20260713050000_submission_authority_completion.sql`, while Gitea workflows emit commit/tree-bound, bounded, retained gate receipts without credentials.

The frozen candidate evidence is root tests `396/396`, contracts `34/34`, pgTAP `436/436`, hosted boundary tests `31/31`, bounded adversarial Node/static checks `87/87`, affected authority Node checks `22/22`, database lint with zero findings, exact generated API type parity, web typecheck/lint/build, all three hosted browsers, composed private/public-stage workflows, accessibility, responsive, forced-colors, performance, nine deterministic zero-diff visual baselines, synthetic cleanup, production dependency audits with zero vulnerabilities, consumer install, and package dry run. The one account visual baseline change was independently reviewed as the exact 80-pixel expansion required by the tombstone-retention disclosure, with no clipping, overlap, overflow, or alignment regression; the complete non-update hosted gate then passed.

Candidate `67129297d08f7f7bc88800015b336a2a7bb1b139` with tree `3a70dbafca99153ad80d67601a5b2e3bbc2d47d5` passed Gitea candidate run `44` and GitHub Actions run `29285742074`, JIT `hosted-web` job `86937705880`. The identical tree was squash-merged as canonical `main` commit `29a356a9b809d29ff8c986fbd5a0af78d87e479c`; post-merge Gitea `main` run `47` then passed. The frozen static receipt is `sha256:3dd68b69f5faad0e6cf70e03dbf98cedb735ed5661dc2c6a8d01c799ed7b2996`, and the frozen database receipt is `sha256:ada2c9d819dce02a3b89971c44119eb96ef89f244ccd692439e80281f64056d1`. This establishes locally validated, pushed, merged, and scoped remote-CI-verified status. The GitHub receipt covers only the recorded hosted-web job; none of these receipts proves deployment, a live origin, OAuth, backup/restore, public indexing, or open-user launch.

The operator read-plane continuation was subsequently frozen as candidate `69e7d1e7f2042ae996c1bed379891ec65ece84a4` with tree `67235ad3ce1553c4b3ba47a36c8e22f9c53cf89c`. Its exact local evidence includes root tests `409/409`, contracts `34/34`, pgTAP `492/492`, hosted boundaries `31/31`, release path `47/47`, clean schema lint, byte-exact generated API type parity plus the narrow runtime-nullability assertions, web typecheck/lint/optimized build, zero production dependency vulnerabilities, clean consumer install, and package dry run. Gitea candidate run `50` passed, and GitHub Actions run `29294494176` one-shot self-hosted `hosted-web` job `86964954830` passed for that exact scope. GitHub PR `#12` squash-merged the identical tree as feature `main` commit `8a30578520974257a1ab4ee2f6c7442696ee0289`; Gitea protected sync PR `#2` retained that exact commit. Gitea sync-branch run `51`, PR run `52`, and post-merge `main` run `53` all passed. The runner self-removed and GitHub reported zero registered repository runners afterward. The overall GitHub workflow remained red only because unrelated GitHub-hosted jobs were blocked by the organization allowance, so it is not accepted as a whole-workflow receipt. Frozen static receipt: `sha256:7dec38b69c6b709c13f6e0aac4d5f6767411e3a2b2e07b3226b87f16902bdd13`; database receipt: `sha256:74b8e840a2e1b5343df5daa79d8bbb2bc08d28bdd54ebd51277c9d912bc37fa6`. These receipts still do not prove deployment, a live origin, OAuth, backup/restore, public indexing, or open-user launch.

### 2026-07-14 launch-readiness closeout slice

The remaining provider-independent launch gaps were re-audited across product journey, backend trust, and release operations, then closed in one bounded source slice:

- confirmed report disposition now requires and atomically applies an exact-version quarantine or revocation, retains the original result for safe replay, and refuses to upgrade a target containing legacy resolved reports without a reviewed forward reconciliation;
- catalog lifecycle receipts now retain their historical result, so an idempotent quarantine or revocation retry cannot borrow the mutable state of a later restore;
- the report queue uses paired cursor pagination, the operator transport admits the schema's maximum valid Unicode page inside a bounded response ceiling, and both report/lifecycle CLIs reject contradictory result projections;
- `/api/v1/health` exposes an identifier-free, fail-closed, no-store readiness projection, while `hosted:operations:check` evaluates explicit queue-age, backlog, expired-claim, retry, failure, and dead-letter thresholds and exits nonzero on alert without emitting account or report identifiers;
- mobile skill detail places the visible save/sign-in action before the long evidence and report workflow at 320px and 390px while preserving the desktop sticky action panel and logical keyboard order;
- hosted visual fixtures use a fixed server-controlled profile timestamp, and authenticated clients can insert only their profile identity rather than forging `created_at`;
- public security copy, migration/runbook contracts, generated API types, preflight bindings, and the hosted browser smokes now describe the implemented metadata-only static-audit and letterless provisional-grade boundary.

At candidate freeze, the slice passed `418/418` root tests, focused operator tests, schema reset/lint, byte-exact generated type parity, `503/503` pgTAP assertions, `32/32` hosted boundary tests, web typecheck/lint/optimized build, Chromium/Firefox/WebKit authenticated flows, the complete submission/report/evidence/deletion cleanup path, accessibility, forced-colors, 320px/390px containment and action-order checks, eleven strict zero-diff visual baselines, and private/public-stage runtime checks. Candidate `e6fc09e9d8300fbd5bb974899cb18b5d1b2d8af6` with tree `94c910c02b224bd421905126da7c783a8f3fb0d7` then passed Gitea candidate run `57` and GitHub Actions run `29299879085` one-shot hosted-web job `86981228569`, whose fifteen steps succeeded and retained the exact `hosted-web-browser` artifact. GitHub PR `#14` squash-merged the identical tree as canonical `main` commit `426efb1af480dff57713d604bac617cea0e00ef2`; Gitea protected sync PR `#4` retained that exact commit, and Gitea sync-branch run `58`, PR run `59`, and post-merge `main` run `60` passed both required jobs. The runner self-removed, dedicated resources and temporary credentials were deleted, and both remotes resolved `main` to the same commit and tree. The frozen static receipt is `sha256:79509a1ba5ad50b6b9be09a47c761268b71c261695cdee30d0839309ef11ce85`; the frozen database receipt is `sha256:3bd274cd5043819a9d5bc707000f70aad3500ef2540874c6a2d4aa0e23238715`. Those provider logs and pull requests are exact-source receipts; they are not deployment or live-product proof.

This closes the locally implementable health, alert-policy, report-integrity, replay, pagination, profile-integrity, and mobile-save gaps. Public launch remains blocked on the explicit external decisions and live receipts below: zero-cost provider/region/domain/OAuth ownership, approved policy and public support identity, provider-global abuse control and trusted ingress, encrypted off-host restore plus web rollback, publisher consent and normal publication for all 20 corpus entries, a scheduled worker and notification destination, the five-seat pilot, deployment, live acceptance, and public indexing.

### 2026-07-14 completion-audit provider-backpressure repair

A final completion audit found two recoverability gaps that were still locally actionable. Submission actions now return local result states for validation, quota, authentication, service, and idempotency failures, preserving safe form values, request identifiers, repository checks, and deterministic post-commit focus. Account submission history also exposes the row's update time. The worker now peeks the exact next candidate before claiming, checks the unauthenticated GitHub core budget with a two-request reserve, and treats bounded primary, secondary, and reset-time rate limits as typed provider backpressure. Pre-claim exhaustion is mutation-free; post-claim exhaustion atomically returns only the exact current claim to `queued`, refunds its attempt, records separate defer/cooldown telemetry, creates no worker-run failure, and leaves a recoverable lease if persistence itself fails.

The repair passed `432/432` root tests, `39/39` focused preflight/provider/fetcher/worker tests, all eight pgTAP files with `545/545` assertions, database lint, byte-exact generated API type parity, `32/32` hosted boundary tests, web typecheck/lint/optimized build, zero production dependency vulnerabilities, and `git diff --check`. The full hosted gate passed Chromium, Firefox, and WebKit authentication; submission, report, evidence, export, deletion, and synthetic cleanup; recoverable quota failure with zero inserted rows; eleven strict zero-diff visual baselines; accessibility, forced-colors, and public-stage runtime checks. This is local acceptance only. It does not yet claim an exact candidate, push, merge, deployment, or live verification and remains outside the preceding launch-readiness source boundary until the required remote receipts are appended.

### Batch 0 — plan and baseline reconciliation

Deliverables:

- this plan and sibling ledger
- current branch/worktree receipt
- current test and known visual-diff baseline receipt
- implementation-orchestrator worker findings integrated into priorities
- deterministic visual masking for generated workspace, revision, trace, digest, and connection identifiers, plus a two-independent-workspace repeatability assertion

Exit:

- plan names every required user/operator journey, safety boundary, acceptance gate, external blocker, and stop condition
- the default visual threshold passes because independent runs render identical normalized evidence, not because the tolerance was increased

### Batch 1 — submission contract, migration, and RLS

Deliverables:

- hosted submission and public receipt JSON Schemas
- generated root/web types and validators
- `api.skill_submissions` plus private receipt/event/review/worker tables
- forced RLS, grants, indexes, immutability, state constraints, and transition protections
- user-owned insert/select/withdraw rules
- service-role-only operator RPCs with explicit grants
- expanded database types and pgTAP suite

Exit:

- two users cannot read or alter each other's rows
- browser roles cannot forge processing, grade, receipt, or publication fields
- hidden and private receipt fields cannot be selected through PostgREST
- duplicate source coordinates are deterministic and idempotent

### Batch 2 — submitter experience

Deliverables:

- `/submit` authenticated form
- strict server-only validation/data-access module
- `/account/submissions` list and detail/status UI
- queue, empty, unavailable, invalid, duplicate, withdrawn, changes-requested, rejected, accepted, and published states
- navigation and sign-in return paths
- account export and deletion with documented retention and deletion limits
- authenticated browser smoke covering create, isolation, validation, withdrawal, and status

Exit:

- a signed-in user can submit an exact public GitHub skill and see its truthful queued state
- malformed URLs, branch names, traversal paths, duplicate parameters, and oversized fields fail before mutation

### Batch 3 — deterministic audit and grade engine

Deliverables:

- pure root TypeScript source-normalization, audit, compatibility, grade, and receipt modules
- a separate constrained `apps/worker` package for transport and queue execution
- versioned rubric and host profile fixtures
- golden vectors for passing, warning, provisional, and blocked skills
- canonical hashing and reason codes
- bounded GitHub exact-source fetcher with timeout, byte, redirect, content-type, and host controls
- no-network unit tests and explicit opt-in integration smoke

Exit:

- identical inputs reproduce identical deterministic receipt content and digest
- untrusted content is never executed
- hostile redirects, oversized files, malformed YAML, secrets, traversal, and critical instructions fail closed

### Batch 4 — operator worker and transactional publication

Deliverables:

- one-shot and drain-queue worker commands
- dry-run mode that writes a local redacted receipt without database mutation
- claim timeout, retry budget, dead-letter state, idempotency key, and stale-claim recovery
- accept/request-changes/reject actions
- transactional creation or update of publisher, repository, skill, immutable version, current pointer, receipts, and events
- operator runbook and cleanup procedure

Exit:

- one first-party fixture and one external-style fixture complete queued-to-published without row surgery
- retry produces no duplicate version, receipt, or event consequence
- a changed commit creates a new immutable version and preserves the prior public pin

### Batch 5 — public audit, grade, and lifecycle UX

Deliverables:

- public receipt projections and APIs
- skill detail evidence summary plus audit and grade methodology links
- `/skills/[publisher]/[slug]/versions/[version]`
- `/skills/[publisher]/[slug]/audit/[receipt]`
- `/skills/[publisher]/[slug]/grade/[receipt]`
- stale, provisional, blocked, deprecated, quarantined, revoked, and tombstone behavior
- shareable metadata and accessible grade explanations

Exit:

- every public claim links to version-bound evidence
- public pages never expose raw submitted content, private findings, user IDs, or operator notes

### Batch 6 — review, reporting, and abuse controls

Deliverables:

- operator queue summary and CLI disposition commands
- suspicious-listing report form and bounded operator intake
- per-account submission limits, cooldowns, duplicate suppression, provider-level rate-limit configuration, and abuse runbook
- revocation, restore, legal hold, and appeal receipts
- dependency/source freshness checks appropriate to metadata-only launch

Exit:

- an operator can reconstruct and reverse every consequential action from receipts
- a compromised or disputed listing can be removed from all public projections without deleting history

### Batch 7 — market-facing product and launch assets

Deliverables:

- search-first landing copy and primary calls to browse or submit
- clear free/no-billing statement and alpha limitations
- getting-started flow for visitors, submitters, and local CLI users
- trust/methodology, privacy, security, support, release-status, contribution, and governance updates
- approved publisher/submission agreement, ownership authorization, acceptable-use, retention, takedown, and appeal text
- sitemap, public robots switch, canonical URLs, Open Graph metadata, and social image
- privacy-safe aggregate funnel definitions: visit, sign-in, save, submission, audit completion, publication, report, and retained return
- launch announcement, short demo script, FAQ, outreach list template, feedback survey, and first-week operating checklist

Exit:

- launch copy describes only implemented behavior
- no fixture statistic is presented as live product data
- analytics collect no raw prompt or skill body and require an explicit retention statement

### Batch 8 — CI, security, and production operations

Deliverables:

- Gitea authority lanes for root/web quality plus restored migrations/RLS/type parity
- the exact-commit GitHub `hosted-web-browser` authority lane for the complete disposable Auth/PostgREST/API/submission/report/evidence workflow; inability to run it blocks release rather than weakening the gate
- dependency, secret, migration-drift, backup/restore, worker-replay, and rollback gates
- CSP, HSTS, cache, cookie, OAuth, RLS, cross-account, and lifecycle-leak probes
- health, structured redacted logs, error-rate/run-lag/queue-depth metrics, and alert thresholds
- staging and production environment matrix

Exit:

- no unresolved P0/P1 security or data-integrity finding
- backup restore and web rollback are exercised against an exact candidate

### Batch 9 — remote alpha deployment and external pilots

This batch is blocked until the owner chooses and authorizes provider ownership, zero-cost-compatible infrastructure limits, region, domain, and OAuth application ownership. No paid provider resource may be created or attached for this launch.

Deliverables after authorization:

- isolated Supabase project and production web project
- exact migrations, generated-type parity, secrets, OAuth callbacks, and indexing mode
- exact-commit deployment receipt
- anonymous, authenticated, cross-account, submission, worker, publish, report, revocation, accessibility, responsive, performance, and rollback live smokes
- the exact five-seat hosted pilot with three skill users, two authorized authors, and assigned mandatory workflow coverage
- an initial corpus of at least 20 fully evidenced versions across at least five useful alternative or complement groups

Exit:

- at least four of five participants finish uncoached and uncoached receipts cover browse/evidence, save/return, submit/status, and author follow-through through receipt-backed publication inspection
- every discovered issue is fixed, accepted as a documented limitation, or blocks launch

### Batch 10 — public launch and first-week operation

Deliverables:

- indexing enabled only after live acceptance
- launch announcement and direct outreach
- daily first-week queue, error, abuse, feedback, and funnel review
- rapid rollback and incident ownership
- public known-limitations and status updates

Exit:

- product is live, free, observable, supportable, and collecting real user feedback
- pushed, deployed, verified-live, and publicly launched receipts point to the same commit

## Validation matrix

### Required local commands

```bash
npm run typecheck
npm run test:contracts
npm test
npm run check:web
npm audit --omit=dev --audit-level=high
npm --prefix apps/web audit --omit=dev --audit-level=high
supabase db reset --local
supabase db lint --local --schema api,private,public --level warning --fail-on warning
supabase test db --local
supabase gen types typescript --local --schema api
npm --prefix apps/web run test:hosted-api
npm --prefix apps/web run test:hosted-auth
npm run test:hosted-gates
npm run test:cross-browser
npm run test:a11y
npm run test:visual
npm run test:perf
npm run test:consumer-install
npm run test:release-path
npm pack --dry-run
git diff --check
```

Generated database types must byte-match after the repository's documented final-blank-line normalization. Browser/auth smokes require the disposable local Supabase stack and a production Next.js server. Any unavailable browser or provider lane must be reported as blocked rather than passed.

### Manual acceptance

- keyboard-only and visible focus
- 200% zoom and 320/390 px reflow
- screen-reader landmarks, names, errors, status, and grade explanation
- high contrast/forced colors
- source and receipt copy/paste accuracy
- OAuth consent and logout
- two-account isolation
- one malicious submission and one license-ambiguous submission
- worker retry and operator revocation
- backup restore and web rollback

## Production-readiness gate

The final gate must publish one verdict per area:

| Area | Required verdict evidence |
| --- | --- |
| Product | complete user and operator journeys; truthful copy |
| Data | migration, RLS, type parity, backup/restore, retention |
| Security | threat model, no secret leak, no execution, abuse controls |
| Reliability | idempotency, retries, DLQ, health, rollback |
| Quality | tests, browser, a11y, responsive, visual, performance |
| Operations | owners, alerts, runbooks, support, incident drill |
| Launch | domain, OAuth, indexing, announcement, pilot results |

Allowed final verdicts are `GO`, `CONDITIONAL GO`, and `NO-GO`. Local success or scoped source CI alone cannot produce `GO` for a public launch.

### Current readiness snapshot

| Area | Validated locally | Verified live | Current verdict |
| --- | --- | --- | --- |
| Product | Discovery, receipt-verified mobile-first save/delete, exact-source submission, failure-preserving remediation, owner status/withdrawal, audit/provisional-grade evidence, reporting, and cross-account isolation | No production origin or OAuth account selected | `NO-GO` for public launch |
| Data | Nine ordered migrations, forced RLS, `545/545` pgTAP assertions across eight files, exact generated type parity, disposable reset/replay, server-owned profile timestamps, durable account-detached terminal revocation tombstones, atomic report enforcement, and attempt-preserving exact-claim provider deferral | No encrypted off-host hosted restore | `NO-GO` |
| Security | No source execution, exact-commit license evidence, expiring publisher authorization, cross-account and cross-handle atomic consent revocation, transaction-locked replay resistance, fail-closed typed receipt validators, target-bound collision review, atomic confirmed-report restriction, secret canary, bounded public projections, and lifecycle removal | No provider-global abuse control, trusted-ingress receipt, or live secret inspection | `NO-GO` |
| Reliability | Claim leases, claim-scoped crash retry, durable expired-run receipts, idempotent completion/publication, attempt-preserving pre/post-claim provider deferral with bounded cooldown telemetry, retained report/lifecycle replay outcomes, paired queue cursors, post-lock expiry and revocation checks, bounded non-mutating inspection, active-catalog-graph replay validation, identifier-free health, explicit operations thresholds, and failure-preserving web submission states | No hosted scheduler, notification delivery, monitored deployment, rollback, or incident drill | `NO-GO` |
| Quality | Root `432/432`, contracts `34/34`, pgTAP `545/545`, hosted boundaries `32/32`, release path `47/47`, corpus tooling, three hosted auth browsers including quota recovery, eleven zero-diff hosted baselines, accessibility, responsive, forced-colors, performance, clean consumer install, package, exact type parity, schema lint, and dependency gates passed locally | Launch-readiness candidate `e6fc09e9d8300fbd5bb974899cb18b5d1b2d8af6` passed Gitea candidate run `57` and GitHub one-shot hosted-web job `86981228569`; identical-tree `main` commit `426efb1af480dff57713d604bac617cea0e00ef2` passed Gitea runs `58` through `60`. The later completion-audit repair is locally accepted only and awaits its exact source receipt. No deployed-commit browser receipt exists | `NO-GO` |
| Operations | Mutation-explicit write commands, credential-explicit read-only queue/detail/operations commands, a no-store health route, migration-bound preflight, bounded retained Gitea gate receipts, thresholded alert policy, runbooks, policy draft, GTM kit, corpus-consent procedure, and hosted-pilot protocol checked in | Source through the launch-readiness boundary is pushed and merged with the required scoped remote CI, runner/resource cleanup, and dual-remote reconciliation recorded; the completion-audit repair awaits its own exact receipt. Zero-cost-compatible host, scheduler/notification target, remaining owners, jurisdiction, retention approval, support identity, and backup destination remain unset | `NO-GO` |
| Launch | Free/no-billing scope, stage/indexing gate, announcement/outreach copy, and an exact 20-version/five-group corpus candidate with `20/20` inert audits and provisional grades | Publisher consent plus database/public publication for the corpus, domain, deployment, mandatory-workflow five-seat pilot, live acceptance, and public indexing absent | `NO-GO` |

## Go-to-market plan

### Remaining ordered path to market

Completed source integration through the full provider-independent launch-readiness tree: candidate `e6fc09e9d8300fbd5bb974899cb18b5d1b2d8af6` was locally validated, accepted by Gitea and the scoped GitHub hosted-web job, pushed, and merged as identical-tree canonical `main` commit `426efb1af480dff57713d604bac617cea0e00ef2`; protected Gitea synchronization and post-merge CI passed. The completion-audit provider-backpressure repair is locally accepted but has not yet joined that boundary; it must receive and append its own source-integration receipt. After that source step, the remaining path is:

1. Select and provision the approved zero-recurring-cost Supabase and web-hosting targets; assign the domain, OAuth, service-role, support, incident, backup, rollback, and release owners without adding billing.
2. Approve jurisdiction, retention/deletion, privacy, terms, acceptable-use, support, and security-response policy; publish the reachable support URL.
3. Obtain durable publisher authorization for the six initial-corpus owners, then ingest all 20 versions through the normal authenticated claim/audit/provisional-grade/collision/publication path rather than direct row seeding.
4. Deploy privately, bind the exact deployment commit, run encrypted off-host restore and web rollback drills, schedule the constrained worker, and verify monitoring/alerts without exposing credentials.
5. Complete the mandatory five-seat pilot across browse/evidence, save/return, submit/status/withdrawal, author publication follow-through, reporting, export, deletion, accessibility, mobile, and failure recovery.
6. Only after every prior receipt is accepted, enable the exact public-stage/indexing pair, run live acceptance, publish the launch announcement, and operate the first-week metrics and incident cadence.

### Audience

Primary: developers using several agent skills across Codex, Claude Code, or shared skill repositories who need discovery and trust evidence.

Secondary: skill authors who want an independent, reproducible quality review and a permanent shareable listing.

### Positioning

Primary message: **Find agent skills you can inspect, compare, and trust.**

Proof points:

- exact source version and digest
- independent audit, compatibility, and grade states
- reproducible public receipts
- free accounts and submissions
- local-first CLI remains useful without the hosted service

Avoid claims that SkillMap proves safety, indexes all skills, improves every prompt, or distributes every submitted package.

### Initial channels

- the existing GitHub repository and release notes only if the repository is made public and its free protection/ruleset gate is verified; otherwise use the canonical public site and community/direct-outreach channels while protected Gitea `main` remains the source-control authority
- direct outreach to the first five external testers and skill authors
- relevant agent-skill communities after live acceptance
- shareable public skill and receipt pages
- a short workflow demo: browse -> inspect receipt -> submit -> see status

### First-week metrics

- unique visitors and returning visitors, aggregated
- GitHub sign-ins
- save rate per catalog visitor
- submissions created and completed
- median queue and review time
- audit outcomes and publication rate
- report/appeal count
- external-user task completion and qualitative feedback

These metrics diagnose the launch; they do not affect grades or organic relevance.

## External blockers and owner decisions

Local implementation may proceed without these choices. Public deployment may not.

1. Supabase organization, project, region, plan, backup limitations, and owner.
2. Web host/team with terms and limits compatible with this public product at zero recurring provider cost. If no reviewed zero-cost-compatible option exists, deployment remains blocked; this program does not authorize a paid fallback.
3. Canonical web domain and whether API/status/docs use subdomains.
4. GitHub OAuth application owner, homepage, callback, and secret custodian.
5. Production service-role secret custodian and operator worker host/schedule.
6. Support, security response, license review, incident, backup, and release owners.
7. Public repository/package visibility, prerelease version/tag, and npm publication decision; these are separate from web launch. The current private GitHub repository cannot use free protection/rulesets and must not be advertised as a public acquisition/support channel unless the owner makes it public. Keeping GitHub private requires recording protected Gitea `main` as the compensating source-control authority and using non-GitHub launch channels; no paid fallback is authorized.

## Stop conditions

Stop and request owner direction if:

- implementation requires paid infrastructure, or a new external account without approval
- a public grade would require fabricated, incomplete, or non-reproducible evidence
- RLS cannot prove cross-user submission isolation
- a browser user can influence operator-only receipt or publication fields
- a source cannot be fetched by immutable coordinates or requires executing untrusted code
- third-party content would be mirrored without confirmed redistribution rights
- raw prompts, private skill bodies, credentials, or unredacted paths would leave the local trust boundary
- a migration would rewrite existing immutable version identity
- a live deployment, DNS, OAuth, indexing, npm publish, tag, or public announcement requires an owner choice not present in repository truth
- unrelated user-owned work conflicts with a required edit

## Orchestration receipt

- Mode: full worker run
- Parent owner: primary Codex agent
- Worker lanes: product/user journey, audit-and-grading backend, release/go-to-market readiness, followed by an independent integrated adversarial review
- Worker count: three bounded audit/remediation workers with disjoint write scopes plus one read-only integrated reviewer
- No visible user-owned threads were created
- High-assurance surfaces: migrations/RLS, auth, source fetching, receipt authority, operator mutation, deployment, and launch claims
- Parent integration duties: canonical plan, schema/contract coherence, scope arbitration, testing, ledger, and final readiness verdict
- Reconsideration triggers: external provider gate, unexpected identity migration, user-owned conflict, or failure of cross-account/adversarial acceptance
