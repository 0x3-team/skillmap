# SkillMap Free Public Launch Implementation Plan

Date: 2026-07-12
Status: active implementation authority
Parent program: `implementation-orchestrator`
Repository: `/home/codex/projects/skillmap`
Branch at plan creation: `codex/hosted-library-foundation`
Baseline commit: `bb054b7`
Receipt ledger: `docs/plans/2026-07-12-skillmap-free-public-launch-implementation-plan-implementation-ledger.jsonl`

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

## Current baseline

Already implemented and locally accepted:

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
- remote Supabase/Vercel projects, live OAuth, canonical domain, backup/restore receipt, deployment, or live acceptance

Existing local validation is not deployment proof. The branch is ahead of its remote and retains user-owned uncommitted `.gitignore`, `.chunk/`, `.claude/`, and `.codex/` state that this program must not overwrite or commit.

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

- exact-candidate CI, dependency audits, migrations, RLS, contracts, type drift, browser, accessibility, responsive, performance, privacy, and secret-canary gates pass
- provider ownership, region, plan, cost boundary, OAuth app, domain, backup owner, incident owner, and rollback owner are recorded
- backup and restore, revocation, worker replay, and web rollback are exercised
- an exact commit is pushed, deployed, and verified live; those states are recorded separately
- at least five external users complete the primary flow and at least four submit or save a skill without operator coaching

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
- the composed hosted browser gate now runs API, authenticated account, submission, report, export/deletion, no-row evidence, and real receipt-row rendering against a disposable local Supabase stack, and GitHub CI binds that gate explicitly;
- the visual harness now guards only the generated workspace and revision labels during the two screenshot paints, proves a simulated late refresh is normalized before paint, and disconnects immediately after capture so later functional behavior remains observable.

These fixes improve local candidate evidence only. They do not change the external provider, push, deploy, OAuth, restore, corpus, pilot, policy, or live-verification gates.

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

- Gitea authoritative lanes for new contracts, worker, migrations/RLS, and end-to-end local hosted smoke
- GitHub workflow parity where spending permits
- dependency, secret, migration-drift, backup/restore, worker-replay, and rollback gates
- CSP, HSTS, cache, cookie, OAuth, RLS, cross-account, and lifecycle-leak probes
- health, structured redacted logs, error-rate/run-lag/queue-depth metrics, and alert thresholds
- staging and production environment matrix

Exit:

- no unresolved P0/P1 security or data-integrity finding
- backup restore and web rollback are exercised against an exact candidate

### Batch 9 — remote alpha deployment and external pilots

This batch is blocked until the owner chooses and authorizes provider ownership, free/paid infrastructure limits, region, domain, and OAuth application ownership.

Deliverables after authorization:

- isolated Supabase project and production web project
- exact migrations, generated-type parity, secrets, OAuth callbacks, and indexing mode
- exact-commit deployment receipt
- anonymous, authenticated, cross-account, submission, worker, publish, report, revocation, accessibility, responsive, performance, and rollback live smokes
- five external user sessions and at least one external-style publisher submission
- an initial corpus of at least 20 fully evidenced versions across at least five useful alternative or complement groups

Exit:

- at least four of five users complete browse/save/submit without operator coaching
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
supabase db lint --local --level warning
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

Allowed final verdicts are `GO`, `CONDITIONAL GO`, and `NO-GO`. Local success alone cannot produce `GO` for a public launch.

### Current readiness snapshot

| Area | Validated locally | Verified live | Current verdict |
| --- | --- | --- | --- |
| Product | Discovery, save, exact-source submission, field-local remediation, owner status, audit/grade evidence, reporting, and deletion workflows | No production origin or OAuth account selected | `NO-GO` for public launch |
| Data | Migrations, forced RLS, pgTAP, generated types, disposable backup/reset/replay | No encrypted off-host hosted restore | `NO-GO` |
| Security | No source execution, constrained worker, secret canary, cross-account isolation, bounded public projections, lifecycle removal | No provider-global abuse control or live secret inspection | `NO-GO` |
| Reliability | Claim leases, idempotent completion/publication, replay, report disposition, lifecycle controls, web failure states | No hosted scheduler, monitoring, alert, rollback, or incident drill | `NO-GO` |
| Quality | Root/web/contracts/database/browser/accessibility/performance/visual/release gates available and locally exercised | No exact deployed-commit browser receipt | `NO-GO` |
| Operations | Runbooks, policy draft, GTM kit, and hosted-pilot protocol checked in | Owners, jurisdiction, retention approval, support identity, and backup destination unset | `NO-GO` |
| Launch | Free/no-billing scope, stage/indexing gate, announcement and outreach copy | Domain, corpus of 20, five pilots, push/deploy, and public indexing absent | `NO-GO` |

## Go-to-market plan

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

- the existing GitHub repository and release notes
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
2. Web host/team and whether any recurring provider charge is approved. A free-to-user product does not imply unauthorized infrastructure spend.
3. Canonical web domain and whether API/status/docs use subdomains.
4. GitHub OAuth application owner, homepage, callback, and secret custodian.
5. Production service-role secret custodian and operator worker host/schedule.
6. Support, security response, license review, incident, backup, and release owners.
7. Public repository/package visibility, prerelease version/tag, and npm publication decision; these are separate from web launch.

## Stop conditions

Stop and request owner direction if:

- implementation requires paid infrastructure or a new external account without approval
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
- Worker lanes: product/user journey, audit-and-grading backend, release/go-to-market readiness
- Worker count: three bounded read-only discovery workers for Batch 0; later write scopes must remain disjoint
- No visible user-owned threads were created
- High-assurance surfaces: migrations/RLS, auth, source fetching, receipt authority, operator mutation, deployment, and launch claims
- Parent integration duties: canonical plan, schema/contract coherence, scope arbitration, testing, ledger, and final readiness verdict
- Reconsideration triggers: external provider gate, unexpected identity migration, user-owned conflict, or failure of cross-account/adversarial acceptance
