# SkillMap Product Application Completion Plan

## Planner Metadata

- Repository/path: /home/codex/projects/skillmap
- Branch: main
- Commit anchored: 02a3c90 Add SkillMap handoff document
- Date: 2026-07-09
- Planning mode: full worker run with three read-only specialist lanes and parent synthesis
- Scope: truthful routing core, complete local product UI, working local backend, optional hosted control plane, security, QA, packaging, release, and operations
- Plan artifact: /home/codex/projects/skillmap/docs/plans/2026-07-09-skillmap-product-application-implementation-plan.md
- Implementation status: not started by this planning run; only this plan file was added
- Worktree state: materially dirty before planning; existing modified and untracked product work belongs to the user and must be preserved
- Worker scopes:
  - UI/product surface: rendered landing/dashboard, responsive behavior, accessibility, route model, and false affordances
  - Backend/architecture: CLI artifacts, state ownership, connector/API boundary, privacy, migration, and hosted control plane
  - Product/release: users, north-star workflow, evidence quality, packaging, pilot, CI, and launch gates
- Primary local sources inspected:
  - README.md
  - HANDOFF.md
  - package.json
  - .github/workflows/ci.yml
  - docs/architecture.md
  - docs/commands.md
  - docs/dogfood.md
  - docs/first-run.md
  - docs/hooks.md
  - docs/release-checklist.md
  - docs/security.md
  - docs/threat-model.md
  - docs/troubleshooting.md
  - docs/personal-v1-runbook.md
  - both prior plans under docs/plans
  - src/commands, src/core, src/schemas, and test/core.mjs
  - apps/web routes, components, contracts, fixtures, scripts, and screenshots
  - local .skillmap status, eval, source, snapshot, and evidence artifacts
- Rendered surfaces inspected:
  - / and /dashboard at desktop and mobile
  - fixture and local-snapshot states
  - screenshots at 1440x1000, 1024x768, 390x844, and 320x740
  - a fresh production server at http://127.0.0.1:53140 during planning; the server was stopped after verification
- Current validation observed:
  - root typecheck passed
  - root tests passed, 23/23
  - web fixture privacy/contract check passed for seven files
  - web typecheck and lint passed
  - current web production build passed in the UI/release lanes
  - fresh / and /dashboard returned HTTP 200
  - local-snapshot browser interaction smoke passed on a fresh server
  - git diff --check passed
- Documentation research:
  - Context7 library /vercel/next.js/v16.2.9, the closest indexed version to installed Next.js 16.2.10
  - Current Next.js guidance supports Route Handlers as a public BFF/proxy with validation, but does not treat them as a full backend replacement
  - Serverless Route Handlers are unsuitable for shared in-memory state, filesystem ownership, long-running work, or durable WebSocket connections
- CodeGraph:
  - MCP was available, but this repository had no .codegraph index
  - initialization was intentionally skipped; targeted rg, file reads, runtime checks, and tests were used
- Assumptions:
  - The next shippable product should be local-first and useful for one operator before team cloud, billing, or marketplace work.
  - The deterministic router must remain local, fast, offline-capable, and free of runtime LLM calls.
  - Skill roots remain user-owned filesystem truth and cannot be silently mutated.
  - Raw prompts, raw skill bodies, secrets, and absolute paths stay off-cloud by default.
  - A hosted team product is a later control plane, not the every-prompt routing dependency.

### Plan Authority

This file is the implementation source of truth from 2026-07-09 forward.

- docs/plans/2026-07-09-skillmap-beui-website-dashboard-plan.md is historical design evidence; its statement that no frontend exists is superseded.
- docs/plans/2026-07-09-skillmap-personal-v1-readiness-plan.md is historical planning evidence; its statements that .skillmap is absent and status is blocked are superseded.
- The old Personal V1 DoneClaim is retained as implementation-smoke evidence, not as current product acceptance.
- HANDOFF.md remains useful history, but current repo/runtime evidence and this plan control future implementation.

## Executive Goal

Turn SkillMap from a capable CLI plus polished snapshot prototype into a product that a new operator can install, trust, use daily, and later connect to an optional team control plane.

The product must support this complete workflow:

~~~text
install
→ detect and approve skill roots
→ scan
→ resolve duplicates and material findings
→ review assisted policy
→ validate on credible natural prompts
→ run a real route
→ connect one agent host
→ receive compact route advice in daily work
→ review misses, source drift, and policy changes
→ update or roll back safely
~~~

Operator verdict:

- The deterministic CLI foundation is real and substantial.
- The current web UI has a credible visual system and responsive foundation.
- The current dashboard is not yet a working product backend client; it is a snapshot/fixture viewer with several false affordances.
- The current ready/release evidence is not trustworthy enough for product acceptance.
- More visual polish is not the first priority. Truthful readiness, safe sharing, qualified skill identity, and a live local service must come first.

## What Complete Means

### UI complete

The UI is complete when a user can finish onboarding, run a real route, inspect a real trace, resolve duplicate skills, review policies and sources, run credible evals, connect an agent host, understand every blocker, and recover from stale/offline/error states without editing JSON or YAML manually.

Every prominent control must either perform its named action or be explicitly disabled and labeled as demo-only. URLs must preserve the active workspace, screen, filters, and trace. Desktop and mobile must be keyboard-accessible, free of overflow, and verified with real backend responses.

### Backend working

The backend is working when one versioned domain/service layer owns state, the CLI/hook/MCP/UI agree on the same approved workspace revision, writes are atomic and recoverable, the local API is loopback-only and authenticated, Route Lab executes the deterministic router, jobs have receipts and idempotency, privacy rules are enforced by schemas and tests, and failures produce truthful blocked/degraded states.

For hosted team use, the backend additionally needs authenticated tenants, RBAC, outbound connector pairing, redacted versioned sync, audit events, backups, migrations, observability, and tenant-isolation proof.

### Product-level application

The application is product-level when it has:

- a precise target user and north-star workflow
- credible routing and safety evidence
- install, update, rollback, and uninstall paths
- complete onboarding and recovery states
- supported local integrations
- CI for CLI, web, browser, privacy, migrations, and clean installs
- security, privacy, support, and incident documentation
- product analytics that distinguish observed behavior from estimates
- pilot evidence from new users
- explicit local-beta, public-beta, hosted-beta, and production gates

## Source Of Truth Contract

- Intent: make SkillMap a trustworthy local SkillOps product first, then an optional hosted team control plane.
- Current behavior:
  - The CLI implements scan, doctor, curation, policy, graph, route, eval, sources, export/import, hook, status, and read-only MCP.
  - Local status currently reports ok/ready from 150 skills and a 150-case eval.
  - The web app renders fixtures or one environment-selected redacted snapshot.
  - Route Lab input, policy/source review actions, and several landing actions do not execute their advertised workflow.
  - There is no product API, local connector service, database, auth, tenant model, queue, or hosted sync.
- Expected outcome:
  - Raw skill roots remain immutable external truth.
  - Config, canonical-variant decisions, reviewed policy, curation receipts, and source-review receipts are canonical user intent.
  - Inventory, effective registry, graph, status, eval summaries, and UI models are derived projections bound to an exact workspace revision.
  - CLI, hook, MCP, local API, and UI consume the same validated last-known-good revision.
  - Snapshot files remain portable evidence exports, not the live application transport.
  - Team cloud stores only an allowlisted, redacted sync envelope by default.
- Truth owner:
  - Installed SKILL.md files: configured skill roots.
  - Local user intent: versioned workspace state under .skillmap.
  - Runtime decision: approved effective workspace revision.
  - UI contract: shared runtime-validated product schemas.
  - Hosted membership and shared policy: hosted control-plane database after that phase exists.
- Contract boundary:
  - Local route input may be processed in memory.
  - Raw route prompts are not persisted or uploaded by default.
  - Local mutation endpoints are allowlisted use cases, never arbitrary shell commands.
  - Remote policy changes are proposals until explicitly approved and applied locally.
- Displaced path:
  - Name-only policy identity is displaced by qualified immutable skill IDs and explicit canonical-variant decisions.
  - Count-only eval confidence is displaced by composition, provenance, leakage, holdout, and safety gates.
  - Environment-file snapshot loading is displaced as the live transport by a versioned local API.
  - Fixture-derived route history and productivity metrics are displaced by observed route events and clearly labeled eval/estimate data.
  - Present-tense hosted/team claims are displaced by truthful local-beta language until hosted capability exists.
- Cutover:
  - Local product cutover occurs when a fresh operator can complete onboarding to a trusted live route through skillmap dashboard without manual artifact editing.
  - Public beta cutover occurs only after cross-platform packaging, credible eval evidence, browser/privacy gates, and pilot onboarding pass.
  - Hosted cutover is a separate decision after local routing remains functional through a cloud outage.
- Acceptance evidence:
  - workspace revision and digest receipts
  - credible held-out eval report
  - real Route Lab request/response and persisted redacted trace
  - duplicate canonicalization receipt
  - safe-export canary scan
  - snapshot tamper rejection
  - connector offline/stale/version-mismatch browser evidence
  - clean-install and rollback transcripts
  - tenant-isolation, backup/restore, and outage evidence for hosted phases
- Evidence lane:
  - local private evidence under .skillmap/reports
  - shareable redacted release evidence under a dedicated ignored artifact folder
  - CI artifacts for package, browser, privacy, migration, and security lanes
- Kill criteria:
  - unresolved duplicate variants can still report ready
  - templated self-labeling evals can still report release confidence
  - safe export contains raw prompts, skill bodies, secrets, or absolute paths
  - a dashboard labels fixture or stale data as live
  - cloud failure prevents local routing
  - any mutation occurs without revision check, confirmation semantics, and an audit receipt
  - a tenant can read or influence another tenant
- Forbidden moves:
  - no npm publish, tag, release, deploy, billing, or global hook action without explicit approval
  - no runtime LLM call in route, hook, MCP, or connector
  - no automatic source update or skill-root mutation
  - no raw prompt/body/path upload by default
  - no marketplace work before personal and public beta product evidence
  - no UI claim of verified/live without target-perspective evidence

## Native Planning Superiority

- Codex Native baseline:
  - would likely suggest adding auth, a database, API routes, tests, and visual polish
  - could treat passing tests and the current ready status as proof
  - could miss the self-labeling eval corpus, duplicate-identity bypass, prompt leakage in safe export, and unverified snapshot payload digest
  - could build cloud features before the local product works
- What this planning run does better:
  - anchors the current dirty checkout and rendered product
  - separates visual quality from functional truth
  - directly audits eval composition and duplicate identities
  - defines local and hosted backends as different trust boundaries
  - provides concrete schemas, routes, jobs, screens, phase gates, evidence, and stop conditions
  - saves a durable implementation handoff
- User-specific context used:
  - keep always-on routing deterministic, local, and lightweight
  - use stronger models for offline curation/proposals rather than every prompt
  - give literal onboarding and exact next actions
  - treat local validation, browser verification, publication, deployment, and hosted state as separate claims
- Superiority score target: 5
- Proof artifacts:
  - this plan
  - three specialist planning reports
  - live browser and command evidence recorded in planner metadata
  - direct eval, duplicate, export, and snapshot-integrity audits

## Orchestration Decision

- Mode: full worker run
- Worker count: 3
- Decision reason: the goal spans product workflow, production UI/UX, local and hosted backend architecture, privacy/security, packaging, QA, and release.
- Independent surfaces:
  - UI and interaction completion
  - backend/data/connector architecture
  - product/release/evidence quality
- Workers used or skipped:
  - used one frontend-design worker
  - used one backend/code-architecture worker
  - used one product/release acceptance worker
  - skipped duplicate generic reviewers
- Thread decision: no user-visible thread creation; this is one parent-owned plan artifact.
- Token/context rationale: three bounded lanes produced independent evidence while the parent verified current runtime and synthesized one source of truth.
- Reconsider trigger: add a specialist only when implementation reaches hosted auth/provider selection, production deployment, or a security finding that needs a focused threat-model pass.

## Background Browser Lane

- Needed: yes during implementation and every UI acceptance cycle.
- Target/surface:
  - fresh local skillmap dashboard URL for personal product work
  - deployed preview and production URLs for hosted phases
- Safety boundary:
  - never accept stale screenshots or an old next start process as current proof
  - record build ID, server command, source mode, workspace revision, and URL
  - use synthetic or redacted data in hosted preview environments
- Required receipt:
  - server command, PID/process owner, port, build/revision
  - HTTP proof
  - Playwright transcript
  - console/page/network error report
  - screenshots at required widths
  - light, dark, and reduced-motion results
- Stop condition:
  - if the route does not respond, the build and server revision disagree, or data source cannot be proven, mark browser verification blocked and do not reuse old screenshots

## Research And Inspiration Findings

### Current product UI

Adopt:

- the calm teal/ink identity
- dense but readable operational hierarchy
- strong labels for local snapshot, redaction, staleness, connector state, and read-only mode
- restrained motion, reduced-motion CSS, dark mode, command palette, drawers, copy receipts, and responsive cards
- the principle that hook and mutation actions remain explicit

Adapt:

- the large snapshot source banner into a compact persistent status rail after onboarding
- the fixture selector into a real workspace/data-source switcher
- the command palette into real navigation and allowlisted operations
- the virtualized skill table into a responsive list/detail workflow

Avoid:

- decorative animation or Magic UI that does not improve comprehension
- more dashboard card sprawl
- hidden demo behavior
- hardcoded product metrics without methodology and source
- present-tense hosted/team/billing language before those capabilities exist

Not relevant:

- marketplace discovery UI
- creator monetization
- enterprise SSO surfaces in the local product

### Current Next.js documentation

Context7 guidance materially affected the backend boundary:

- Use Next.js Route Handlers as a browser-facing BFF/proxy with request validation.
- Do not make Next.js Route Handlers the authoritative workspace state engine.
- Do not depend on serverless filesystem writes, shared request memory, long-running jobs, or durable WebSockets.
- Keep the long-lived local connector and hosted job/control-plane service separate from the Next.js BFF.

Docs receipt:

- Context7 library: /vercel/next.js/v16.2.9
- Installed version: Next.js 16.2.10
- Topic: Route Handlers, Server Actions, BFF limits, validation, caching, and serverless constraints
- Fallback: none

## Current State

### What is genuinely working

- The CLI command surface is broad and deterministic.
- Root typecheck and all 23 current tests pass.
- Current real-root scan covers 150 skill records across two configured user roots.
- Hook install/uninstall has temporary-file smoke evidence.
- MCP exposes six read-only tools and has JSON-RPC smoke evidence.
- The web app builds, passes lint/typecheck/fixture checks, and renders well at desktop and mobile.
- A fresh current production server passed local-snapshot browser smoke.
- The dashboard clearly distinguishes fixtures from local snapshots.
- Snapshot privacy checks reject obvious raw prompt/body/path fields.

### Material findings

| Priority | Finding | Direct evidence | Product risk |
| --- | --- | --- | --- |
| P1 | Current release eval is self-labeling | 150/150 prompts contain the expected skill name; every case has one expected skill; 0/150 has an avoid label | ready/release and hook preflight are false confidence |
| P1 | Duplicate identity bypasses policy | 150 records, 142 unique names, eight duplicate groups, all sixteen variants route-eligible, no canonical choice, status still ready | the selected filesystem copy is implicit and policy can be bypassed |
| P1 | Safe export is not safe enough | generic export includes eval-report; path redaction does not remove raw eval prompts | sharing or hosted ingestion can leak prompt content |
| P1 | Snapshot payload integrity is not verified | the producer hashes the canonical base payload before adding digest fields, but the loader validates shape/redaction without recomputing and comparing that canonical payloadDigest | payload tampering cannot be detected; the full transport-file hash is expected to differ from the embedded payload digest |
| P1 | Reduced-motion hydration fails | AnimatedNumber initializes server/client from different reduced-motion state; UI worker reproduced production hydration errors | accessibility users receive broken hydration and untrusted UI state |
| P2 | Route Lab is a false affordance | textarea updates local state, but results always use snapshot.recentRouteTraces[0]; no run action exists | primary user workflow does not work |
| P2 | Landing contains no-op/overclaim | Run sample route returns undefined; hosted/team/billing claims describe future capability | polished marketing masks a prototype |
| P2 | Route/product metrics are synthetic | snapshot traces and productivity values derive from eval rows; token savings assume a broad catalog baseline | dashboard cannot distinguish observed use from estimates |
| P2 | Source gate is vacuously green | source status has zero tracked records but readiness reports no source warning | unknown provenance is mistaken for complete coverage |
| P2 | Product backend is absent | no app/api routes, connector server, database, queue, auth, tenant schema, or telemetry | no live application behavior or hosted product exists |
| P2 | State writes are not transactional | direct multi-artifact JSON/text writes have no workspace lock, revision manifest, or recovery pointer | interruption/concurrency can produce mixed truth |
| P2 | Mobile has known gaps | UI worker measured 475px document width on a 390px Connector view; snapshot switching is hidden below sm | product is not mobile complete |
| P2 | Accessibility primitives are incomplete | tabs lack roving keyboard behavior; dialogs need stronger focus trapping/restoration; table lacks aria-sort | keyboard/screen-reader use is not verified |
| P2 | CI covers only the root CLI | one Ubuntu/Node 22 job; web, browser, Node 20, macOS, Windows, migration, and privacy lanes are absent | regressions can ship outside current unit coverage |
| P3 | Status/release messaging conflicts | README says alpha, HANDOFF says release candidate, version is 0.1.0, current product work is uncommitted and unpublished | operators cannot tell what state is real |
| P3 | Frontend ownership is too broad | dashboard-client.tsx is roughly 1,400 lines and owns navigation, data selection, every feature panel, and interaction state | live backend integration will amplify coupling |

### Evidence boundary

The current checks prove:

- local CLI behavior for covered tests
- local real-root artifact generation
- fixture and snapshot rendering
- browser interaction smoke on a fresh local build

They do not prove:

- natural implicit routing quality
- safe share/export behavior
- canonical duplicate resolution
- live UI routing
- production backend behavior
- hosted auth, tenant isolation, deployment, or operations

## Product Definition

### Primary user

An AI power user or developer with dozens to hundreds of skills across Codex, Claude, Hermes, and other agent hosts who needs inventory, governance, deterministic routing, safety, and compact context.

### Secondary user

An AI platform owner or small engineering team that maintains a shared reviewed skill policy across people and agent hosts.

### Later user

Skill publishers distributing versioned skills with provenance. This is not the first product wedge.

### Poor initial target

Casual users with a small skill library; governance overhead is unlikely to repay itself.

### North-star workflow

Weekly accepted implicit routes from ready workspaces with no blocked or avoid-policy violations.

Supporting metrics:

- time to first trusted route
- route acceptance/override rate
- no-confident-route rate
- high-risk false-positive rate
- duplicate-resolution backlog
- source-review backlog age
- observed connector health
- context reduction against the actual configured host baseline

Do not mix these categories:

- eval evidence
- observed daily route behavior
- modeled token savings
- hosted usage

### Product tiers

| Tier | Product | Scope |
| --- | --- | --- |
| Personal V1 | Local CLI plus live local dashboard | real roots, qualified identities, governance, natural routing, route history, source/eval review, project-local integrations |
| Public developer beta | Installable supported product | published package after approval, cross-platform CI, diagnostics, support, opt-in telemetry, external pilots |
| Team cloud beta | Optional hosted control plane | accounts, workspaces, memberships, signed policy sync, outbound connector, redacted metadata, audit log |
| Production/enterprise | Hardened service | SSO/RBAC, retention, backups, incident response, compliance controls, billing when justified |
| Marketplace | Separate later product | publishing, licensing, moderation, takedowns, dependency review, reputation |

## Future State

### Architecture

~~~mermaid
flowchart LR
  Roots["User-owned skill roots"] --> Store["WorkspaceStateStore"]
  Store --> Revision["Approved workspace revision"]
  Revision --> CLI["CLI"]
  Revision --> Hook["Passive hook"]
  Revision --> MCP["Read-only MCP"]
  Revision --> LocalAPI["Loopback connector API"]
  LocalAPI --> LocalUI["Local product UI"]
  LocalAPI --> Ledger["Redacted event and job ledger"]
  Connector["Outbound connector session"] --> Cloud["Optional hosted control plane"]
  Revision --> Connector
  Cloud --> DB["Tenant database"]
  Cloud --> Queue["Jobs and audit events"]
  Cloud --> BFF["Next.js BFF"]
  BFF --> HostedUI["Hosted product UI"]
  Cloud -. "signed proposal" .-> Connector
~~~

### Local state model

Raw truth:

- configured SKILL.md roots

Canonical user intent:

- workspace config and approved roots
- canonical variant selections
- reviewed policy and rationale
- curation receipts
- source records and review receipts
- privacy/retention settings

Derived projections:

- inventory
- doctor report and doctor pack
- effective registry
- SkillGraph
- readiness status
- eval summaries
- dashboard views

Operational records:

- jobs
- redacted route events
- feedback
- diagnostics
- audit receipts

Required workspace revision envelope:

- kind
- schemaVersion
- workspaceId
- workspaceRevision
- generatedAt
- input digests
- payloadDigest
- producer version
- compatibility range
- redaction classification

Digest rules:

- payloadDigest hashes canonical payload bytes while excluding payloadDigest, transportDigest, and transport-only metadata.
- The loader must reconstruct the same canonical projection and compare payloadDigest.
- transportDigest may separately hash the complete serialized file or response.
- An embedded self-digest is never expected to equal the full file hash after the digest field is inserted.

### Qualified skill identity

Do not use display name as identity.

Recommended model:

- rootId: persisted opaque UUID assigned when a root is approved; never derived from or exposed as an absolute path
- skillId: sk_ plus base64url sha256 of identity-version, rootId, and version-normalized relative path
- displayName: frontmatter name
- contentRevision: hash of the complete security-relevant skill tree, including SKILL.md, scripts, references, assets, and relevant manifests
- canonicalForName: explicit workspace decision pointing to one skillId
- duplicateDecision: hash-bound receipt with actor, reason, and compared variants

A content edit changes contentRevision, not skillId. Moving a skill or changing its root requires an explicit migration/adoption decision. Normalization is versioned, traversal is rejected, symlink behavior is explicit, and any detected identity collision blocks readiness.

Policy v2 shape:

- version: 2
- canonicalByName: display name to one approved skillId
- skillsById: skillId to SkillPolicyEntry
- duplicateDecisions: display name to hash-bound comparison/selection receipt
- migration: source policy digest, migration version, unresolved names, and rollback artifact

Migration and precedence:

- A v1 name with exactly one inventory variant maps automatically to that skillId.
- A v1 name with multiple variants never maps automatically; it becomes unresolved.
- Exact skillsById policy controls the variant.
- canonicalByName selects the only implicit-routing variant for a duplicated display name.
- Noncanonical variants default to routeEligible false with state shadowed-duplicate, but remain inspectable and may be explicitly invoked only through a qualified identity if policy allows.
- Rollback restores the prior v1 policy artifact and revision pointer; it never rewrites skill roots.

### Transactional workspace state

Add a WorkspaceStateStore that provides:

- strict parsing and schema-version errors
- a workspace mutation lock
- immutable revision directories
- fsync of staged files and the revision directory before publication
- one atomically replaced current-revision pointer after the immutable revision is complete
- monotonic revision IDs
- current and last-known-good pointers
- manifest of all artifact digests
- corruption quarantine
- migration and rollback receipts
- one approved read model for route/hook/MCP/API/UI
- an exclusive writer lock with owner, expiry, and fencing token
- a state-version marker that prevents compatible v2 writers from using legacy mutable paths
- read-only legacy projections plus divergence detection for older tools

Readers resolve the current pointer once, then read only that immutable revision and verify its manifest. Publication never relies on cross-volume rename. An optional local SQLite file may index jobs/events, but it must be disposable and rebuildable. Portable canonical state remains versioned files.

Last-known-good is permitted only when canonical-intent digests are unchanged and the failure is limited to a derived projection or current-revision corruption. Root removal, root approval change, policy block, canonical-variant decision, source-security decision, privacy setting, or incompatible schema change invalidates old routing; hook/API must abstain until a new approved revision exists.

### Local connector

The minimum working backend is an explicitly started command:

    skillmap dashboard

Requirements:

- bind only to 127.0.0.1 on a random or specified port
- serve UI and /api/v1 from the same origin
- one-time bootstrap URL with fragment-delivered, origin-scoped session capability and CSRF proofs
- reject untrusted Host and Origin
- no permissive CORS
- CSRF protection for mutations
- request size, time, and concurrency limits
- graceful shutdown and explicit background-mode opt-in
- call shared TypeScript use cases directly
- never execute browser-provided shell commands
- keep raw route prompts in memory unless retention is explicitly enabled
- expose the active workspace revision/digest on every response
- use approved rootIds rather than trusting browser-supplied filesystem paths
- realpath every approved root and destination, reject traversal, define symlink containment, and recheck contentRevision before a mutation
- constrain import/export destinations to operator-approved locations

Local packaging topology must be settled before connector implementation:

- Build a versioned static local-app bundle from the current web source and serve it from skillmap dashboard.
- Serve the local API from the same process and origin.
- Keep the public/hosted Next.js deployment as a separate build target and use Route Handlers only as its BFF.
- Never let running processes share a mutable .next directory.
- Phase 4 hardens and releases this chosen topology; it does not reopen the topology decision.

### Minimum local API

| Method | Endpoint | Purpose | Mutation/safety |
| --- | --- | --- | --- |
| GET | /api/v1/health | process, version, compatibility, revision | read-only |
| GET | /api/v1/bootstrap | initialized/uninitialized/recovery state | read-only |
| POST | /api/v1/workspaces | create/select a local workspace record | explicit local action |
| POST | /api/v1/roots/validate | validate an operator-entered candidate without adopting it | no arbitrary read outside candidate metadata |
| POST | /api/v1/roots/approve | persist an approved opaque rootId | confirmation and realpath rules |
| GET | /api/v1/workspace | config, readiness, current/last-known-good revision | redacted |
| GET | /api/v1/dashboard | composed overview model | redacted |
| GET | /api/v1/skills | paginated/filterable variants | no bodies by default |
| GET | /api/v1/skills/:skillId | metadata, policy, provenance, revisions | body requires explicit local scope |
| POST | /api/v1/routes/preview | run deterministic route against approved revision | promptStored false |
| POST | /api/v1/routes/:id/feedback | correct/wrong/missing/unsafe feedback | redacted receipt |
| GET | /api/v1/routes | redacted route-event history | no raw prompt |
| GET | /api/v1/policy/reviews | duplicate/policy queues | read-only |
| POST | /api/v1/policy/proposals | create reviewed proposal | expectedRevision required |
| POST | /api/v1/policy/decisions | accept/hold/reject | confirmation and receipt |
| GET | /api/v1/sources | coverage/freshness/review | read-only |
| POST | /api/v1/sources/reviews | hold/accept decision | hash-bound receipt |
| GET | /api/v1/evals | suites/runs/composition | prompt previews redacted |
| POST | /api/v1/jobs | allowlisted maintenance job | idempotency and confirmation class |
| GET | /api/v1/jobs/:jobId | status/result/error | redacted |
| GET | /api/v1/events | SSE after polling is proven | jobs/revision only |

Route preview response must contain:

- recommendations
- exclusions
- reasons
- latency
- workspaceRevision
- effectiveDigest
- promptStored: false
- warning/degraded state

Do not echo or persist the full prompt in route history.

Common response envelope:

- schemaVersion
- requestId
- servingRevision
- currentRevision
- compatibility: compatible, upgrade-required, client-too-new, or degraded
- data on success
- error on failure, with machine code, safe message, retryable flag, conflict details, and expected/current revision

Use 409 REVISION_CONFLICT for optimistic-concurrency failures. Pagination defines opaque cursor, default limit, maximum limit, stable sort key, and end-of-list semantics. The UI must branch on machine codes rather than parsing messages.

### Job model

Allowlisted job types:

- scan
- doctor
- doctor-pack
- apply-policy
- graph-build
- source-check
- eval
- snapshot-export
- diagnostics-export

Every job requires:

- expectedRevision
- idempotency key
- requestedBy
- confirmation class
- queued/running/succeeded/failed/cancelled state
- timestamps and redacted result receipt

High-risk actions such as hook install or policy application remain separate confirmation flows and are never generic jobs.

Filesystem freshness:

- Use a debounced watcher over approved roots plus a bounded periodic manifest verification.
- A detected change marks the workspace filesystemDirty with observed hashes/timestamps.
- Detection never triggers scan, curation, policy application, or source update automatically.
- The UI offers the allowlisted next job and explains that the serving revision remains the prior approved revision.

### Hosted control plane

Only build this after the local product gate passes.

Next.js responsibilities:

- public site and product UI
- authenticated BFF Route Handlers
- request validation, session checks, response shaping

Separate control-plane service responsibilities:

- durable tenant data
- connector sessions
- jobs and audit events
- sync and idempotency
- migrations, backups, and retention
- observability

Local connector responsibilities:

- initiate outbound TLS
- authenticate with a scoped, rotatable device credential
- send allowlisted metadata and aggregate metrics
- receive signed/versioned proposals
- require local approval before applying policy
- preserve local routing through cloud outage

Default sync envelope excludes:

- raw skill bodies
- raw prompts
- absolute paths
- secrets
- hook tokens
- private evidence files

### Hosted data model

Core relational entities:

- users and auth identities
- organizations
- memberships and roles
- workspaces
- connectors/devices
- workspace revisions
- skill identities and skill variants
- policy revisions and policy decisions
- eval suites, cases, runs, and evidence provenance
- source records and source reviews
- redacted route events and feedback
- jobs and idempotency keys
- audit events
- scoped API/device tokens
- usage ledger after billing is justified

Rules:

- every tenant row carries organization/workspace ownership
- revisions are immutable
- authorization is enforced server-side on every request
- connector credentials are scoped, hashed, rotatable, and revocable
- destructive mutations use optimistic concurrency and audit events
- retention/export/delete behavior is explicit and tested

## UI Completion Plan

### Route and information architecture

Public surface:

- / — truthful positioning, clearly labeled interactive demo, sourced methodology, real CTA
- /getting-started — literal install-to-first-route workflow
- /security — local/cloud trust boundary
- /privacy — data collection, retention, deletion
- /sign-in and /invite/:token — only when hosted tenancy exists

Product surface:

- /app — workspace/bootstrap redirect
- /app/onboarding — resumable local setup
- /app/workspaces — create/select/recover workspace
- /app/:workspaceId/overview
- /app/:workspaceId/route
- /app/:workspaceId/traces/:traceId
- /app/:workspaceId/skills
- /app/:workspaceId/skills/:skillId
- /app/:workspaceId/policies
- /app/:workspaceId/evals
- /app/:workspaceId/sources
- /app/:workspaceId/trust
- /app/:workspaceId/integrations
- /app/:workspaceId/activity
- /app/:workspaceId/settings

Keep /dashboard as a compatibility redirect. In local mode, use a clearly named local workspace and Demo mode; do not imply a hosted session.

Offline semantics:

- Warm disconnect: an already-loaded local page must retain its last redacted view and show connector disconnected, retry, and serving-revision state.
- Cold connector unavailable: because the connector serves both local UI and API, the browser may show a connection failure. skillmap dashboard must fail with an actionable CLI diagnostic or restart the service; do not claim an in-app offline screen exists on cold load.
- Hosted UI with a disconnected outbound connector remains loadable and must show device offline separately from control-plane availability.

### Screen requirements

#### Onboarding

- detect or enter roots
- preview exact read scope
- run scan with progress
- present duplicates and P1 findings
- prepare/ingest curation with literal instructions
- import or create a credible eval suite
- run first live route
- configure MCP or project-local hook last
- pause/resume and exact rollback

#### Overview

- truthful readiness phase and blocker ownership
- active workspace revision and digest
- observed routes separate from eval and modeled token data
- connector version/health
- source/eval/policy coverage
- next action hidden when empty

#### Route Lab

- submit, cancel, retry
- real backend response
- loading, no-confidence, blocked, stale, and error states
- recommendations, exclusions, reasons, revision, and latency
- correct/wrong/missing/unsafe feedback
- copy hint/trace only after a real response
- trace detail URL

#### Skills

- search, filters, sorting, column controls, and saved view
- mobile card/list alternative
- stable skillId in URLs
- variant compare and canonical selection
- script risk, source, policy, route history, and content revision
- meaningful empty states

#### Policies

- duplicate, unmatched, uncovered, explicit-only, and blocked queues
- rationale and before/after diff
- dry-run impact
- accept/hold/reject with revision and receipt
- conflict/stale response handling

#### Evals

- suite composition and provenance
- target-name leakage warning
- explicit, implicit-natural, multi-skill, negative/near-miss categories
- train/holdout split
- avoid labels
- run progress and per-case trace
- baseline and confidence reporting

#### Sources

- not-configured, not-applicable, partial, covered, stale, risky, and error states
- source adoption and immutable reference
- diff and review receipt
- rate-limit/offline state
- no vacuous green status

#### Integrations

- connector bootstrap and version compatibility
- MCP manifest/call verification
- hook dry-run, project-local install, rollback, and manual trust step
- global hook action separated and never default
- exact diagnostics

#### Activity and settings

- redacted route events
- job history and audit receipts
- feedback backlog
- roots, privacy, retention, diagnostics, update channel, and uninstall
- team/member/billing settings only in hosted phases

### Cross-cutting UI requirements

- split dashboard-client.tsx into app shell and feature modules
- server state through a typed API client/query layer
- URL-owned navigation/filter state
- route-level loading.tsx, error.tsx, and not-found behavior
- skip link and route-specific titles
- focus traps, inert background, and focus restoration for dialogs
- arrow-key tabs with roving tabindex and aria relationships
- aria-sort and screen-reader validation for tables
- touch-accessible help instead of hover-only tooltips
- no document overflow at 320px and above
- compact mobile source status and discoverable workspace switching
- light, dark, reduced-motion, loading, empty, stale, offline, unauthorized, permission-denied, malformed, and server-error states
- fixtures only in explicit demo/test mode
- primitive-level accessibility and keyboard acceptance in every UI slice, with Phase 3 retaining a final audit rather than deferring accessibility
- 200 and 400 percent zoom/reflow, forced-colors/high-contrast, and minimum touch-target verification
- Chromium, Firefox, and WebKit coverage for onboarding, routing, policy, connector, and recovery
- deterministic screenshot baselines and visual diffs for critical route/state combinations
- explicit route-by-state applicability matrix; use N/A where a state is not meaningful
- no unexpected or unhandled console/page/network errors; expected offline/error requests must be asserted, not forbidden
- hosted auth lifecycle states when Phase 5 begins: invalid/expired invite, session expiry, access denied, reauthentication, organization/workspace switching, and connector-pairing recovery

Provisional UI performance budgets to approve before public beta:

- LCP at or below 2.5 seconds, INP at or below 200 ms, and CLS at or below 0.1 on the agreed test profile
- warm local app status visible within 1 second
- client route transition feedback within 200 ms
- 500-skill search/filter response within 100 ms
- route-specific JavaScript and total bundle budgets recorded in CI after a baseline is measured; regressions require review

## Non-Goals

- Do not turn the local router into a cloud or model-dependent runtime.
- Do not build billing, marketplace, creator monetization, or enterprise SSO before personal and public beta gates pass.
- Do not upload raw skill bodies, raw prompts, absolute paths, secrets, or private evidence by default.
- Do not automatically edit skill roots, install global hooks, apply remote policy, or update sources.
- Do not replace the CLI with a web-only workflow; CLI, hook, MCP, connector, and UI remain supported views over one domain layer.
- Do not call the current generated eval suite release evidence.
- Do not treat fixture screenshots, passing builds, or code diffs as proof of live product behavior.
- Do not select an auth, database, billing, or hosting vendor until the hosted-phase owner decisions are made.
- Do not refactor unrelated code while implementing these slices.

## Phase Plan

### Phase 0 — Truth Reset And Privacy Gate

Goal: stop false ready/hosted/safe claims before expanding the product.

Tasks:

- P0-01 Reclassify the current 150-case eval as demo/smoke evidence.
- P0-02 Add eval composition/provenance fields and make release confidence reject target-name leakage, missing negative coverage, and missing holdout evidence.
- P0-03 First block readiness on every unresolved duplicate-name group, then introduce qualified skill IDs and canonical decisions in Slice B.
- P0-04 Make source coverage explicit: not-configured, not-applicable, partial, or covered.
- P0-05 Make safe export allowlist-based; omit prompts, bodies, paths, diffs, and sensitive receipts by default.
- P0-06 Define payloadDigest over canonical payload bytes excluding digest fields, verify it on load, and optionally record a full transportDigest.
- P0-07 Fix reduced-motion hydration and mobile Connector overflow.
- P0-08 Make each no-op control either execute a deterministic labeled demo or become disabled with an explanation; remove present-tense hosted/team/billing claims.
- P0-09 Reconcile README, HANDOFF, package status, changelog, security docs, and evidence labels.
- P0-10 Preserve/freeze the coherent current worktree as an implementation checkpoint before larger architecture changes.

Likely files:

- src/schemas/types.ts
- src/core/inventory.ts
- src/core/status.ts
- src/core/route.ts
- src/core/dashboard-snapshot.ts
- src/commands/eval.ts
- src/commands/export.ts
- src/commands/hook.ts
- test/core.mjs
- apps/web/components/ui/number.tsx
- apps/web/components/skillmap/landing-page.tsx
- apps/web/components/skillmap/dashboard-client.tsx
- apps/web/lib/dashboard-data.ts
- README.md, HANDOFF.md, CHANGELOG.md, docs

Exit evidence:

- current self-labeling suite cannot produce release confidence
- current unresolved duplicates cannot produce ready status
- safe-export canary values never appear
- one-byte payload tamper fails unless the producer generates a new valid payloadDigest
- reduced-motion production routes have no hydration error
- every current CTA either performs its real action, performs a deterministic labeled demo, or is disabled with an explanation; no clickable no-op remains
- no page says hosted/team capability is currently operational

### Phase 1 — Contracts, Revisions, And Trustworthy Routing

Goal: give every runtime surface one validated source of truth.

Tasks:

- P1-01 Add canonical runtime schemas for workspace revision, skill identity, route result, dashboard, job, event, eval suite/run, and sync envelope.
- P1-02 Replace duplicate CLI/web dashboard contracts with one canonical schema plus adapters.
- P1-03 Implement WorkspaceStateStore with fencing lock, fsynced immutable revision directory, one atomic current-pointer swap, revision manifest, current/last-known-good, state-version marker, legacy divergence detection, corruption quarantine, migration, and rollback.
- P1-04 Make CLI commands call shared use cases rather than own ad hoc file state.
- P1-05 Remove silent unapproved route fallback; stale/missing approved state must abstain or use explicitly recorded last-known-good state.
- P1-06 Add canonical duplicate selection and hash-bound decisions.
- P1-07 Add credible eval v2:
  - at least 100 implicit natural prompts
  - at least 25 multi-skill cases
  - at least 25 negative/near-miss cases
  - avoid labels for every safety-sensitive case
  - held-out evidence and dataset/effective-revision digest
- P1-08 Keep top-1 at least 0.80, top-3 at least 0.92, and zero avoid hits, but apply them only to credible release-counted cases.
- P1-09 Add a real redacted route-event and feedback model.
- P1-10 Harden source fetches with timeout, byte cap, immutable refs, ETag/cache, retry/backoff, authenticated option, and full skill-tree manifest.
- P1-11 Give MCP concrete schemas, pagination, response limits, redacted views, and revision receipts.
- P1-12 Make hook output depend on one approved revision and remain deterministic/offline.

Eval v2 anti-cheat rules:

- Every case has exactly one primaryCaseType: explicit, implicit-natural, multi-skill, or negative-near-miss. Quotas are disjoint.
- Explicit cases are useful regression tests but are excluded from release top-1/top-3 scoring.
- Implicit-natural prompts may not contain an exact expected display name or registered exact alias and may not copy the source description.
- Multi-skill cases have at least two expected skills.
- Negative cases have no expected skill and at least one prohibited/avoid target when safety-relevant; near-miss cases explicitly label expected and avoid sets.
- The release-counted set is at least 150 cases: 100 implicit-natural, 25 multi-skill, and 25 negative-near-miss.
- At least 20 percent of release-counted cases, and never fewer than 30, are frozen holdout cases not used for policy/ranker tuning.
- Dataset provenance records label author, source class, created/reviewed time, deduplication result, train/holdout membership, and dataset digest.
- Release requires the fixed thresholds, zero avoid hits, no worse top-1/top-3 than the declared baseline, and improvement in at least one of top-1, top-3, calibrated abstention, or advisory size. If the baseline is already perfect, context/advisory size must improve without a safety regression.

Schema-layout decision:

- Preserve the root CLI package initially.
- Prefer canonical JSON Schemas under contracts/ with generated/adapted TypeScript validators for root and web.
- Do not make the publishable root CLI depend on an unpublished workspace package.
- Revisit a packages/contracts workspace only when packaging/release design proves it can be installed cleanly.

Exit evidence:

- CLI, route, hook, MCP, snapshot, and web report the same revision/digest
- concurrent mutations cannot lose state
- interrupted writes cannot expose a partial current revision
- corrupt current state yields blocked diagnostics and preserves last-known-good routing
- duplicate root variants require an explicit canonical choice
- natural held-out eval and safety gates pass
- same prompt/revision produces equivalent CLI, hook, MCP, and domain route output

### Phase 2 — Live Local Backend And Primary UI Workflow

Goal: replace the snapshot prototype with a working local application.

Tasks:

- P2-01 Add skillmap dashboard.
- P2-01A Add minimal bootstrap routes for workspace create/select/recover and approved-root validation/adoption; full curation/eval onboarding remains Phase 3.
- P2-02 Add loopback server security, capability bootstrap, same-origin API, limits, and graceful shutdown.
- P2-03 Implement the minimum read endpoints.
- P2-04 Implement POST /routes/preview with no prompt retention.
- P2-05 Add revision polling with ETags; add SSE only for job/revision events after polling is stable.
- P2-05A Add debounced root watching plus periodic manifest verification that marks filesystemDirty without automatic maintenance.
- P2-06 Add allowlisted maintenance jobs with idempotency and receipts.
- P2-07 Wire Route Lab to live route execution.
- P2-08 Add redacted route feedback and trace history.
- P2-09 Add live/offline/stale/version-mismatch/permission/error UI.
- P2-10 Keep fixture/snapshot modes behind explicit Demo/Test selection.
- P2-11 Implement the preselected topology: versioned static local-app assets embedded/installed with the connector, plus a separate public/hosted Next.js build target; never share a mutable .next runtime.

Exit evidence:

- two materially different prompts produce different real recommendations
- route response revision matches skillmap status
- browser network capture shows prompts never leave loopback
- warm connector loss produces an honest in-app disconnected state; cold connector startup failure produces an actionable CLI/browser launch diagnostic
- changing a skill makes state stale/dirty without silently rerunning curation
- stale running servers cannot reuse a newly rebuilt .next directory
- an already initialized operator reaches a real route without manually editing artifacts
- an uninitialized operator can create/select a workspace and approve roots, then receives an exact resumable handoff into the full Phase 3 onboarding flow

### Phase 3 — Complete Personal Product UI

Goal: finish all high-value operator workflows on the live local backend.

Tasks:

- P3-01 Move dashboard tabs into the route model defined above.
- P3-02 Build guided onboarding with exact stop/review/rollback steps.
- P3-03 Build skill search/detail/variant comparison/canonicalization.
- P3-04 Build policy review/diff/dry-run/decision receipts.
- P3-05 Build eval suite/import/label/run/holdout review.
- P3-06 Build source coverage/diff/review/hold workflows.
- P3-07 Build connector/MCP/hook integration checks.
- P3-08 Build activity/jobs/audit and privacy/settings.
- P3-09 Split the dashboard monolith into feature modules.
- P3-10 Complete loading/empty/error/mobile/keyboard/screen-reader states.
- P3-11 Complete truthful landing, getting-started, security, privacy, footer, support, and release-status links.
- P3-12 Add observed-vs-eval-vs-estimate metric labels and methodology.
- P3-13 Complete the resumable onboarding flow from approved roots through curation, credible eval, first live route, and optional integration.
- P3-14 Add cross-browser visual regression and provisional UI performance budgets to CI.

Exit evidence:

- literal first-run workflow succeeds from a clean checkout
- every route has deep-link/back/forward behavior
- all prominent actions execute or are explicitly unavailable
- every state in the UI acceptance matrix is browser verified
- no serious/critical automated accessibility findings
- manual keyboard, focus, screen-reader, contrast, and reduced-motion review passes

### Phase 4 — Public Developer Beta

Goal: make the local product installable and supportable by users outside this checkout.

Tasks:

- P4-01 Harden the Phase 2 package/web topology and decide beta version/tag.
- P4-02 Add Node 20 and 22 plus Linux, macOS, and Windows CI.
- P4-03 Add CLI, web, browser, privacy, migration, failure, and clean-consumer install jobs.
- P4-04 Add package provenance/signing strategy and release approval gates.
- P4-05 Add install, update, uninstall, rollback, diagnostics, support, privacy, and security docs.
- P4-06 Add opt-in, redacted product telemetry or keep telemetry off and use explicit feedback exports.
- P4-07 Run at least five external onboarding pilots.
- P4-08 Triage all P1 issues and pilot-blocking P2 issues.
- P4-09 Publish/tag/release only after explicit user approval.

Recommended pilot gate:

- at least four of five new operators reach a trusted route within 15 minutes
- no P1 defect
- no silent root/global-hook mutation
- natural held-out eval and privacy gates pass

Exit evidence:

- clean tarball install on every supported platform
- package includes intended CLI/local UI assets only
- first-run pilot receipts
- browser and privacy CI artifacts
- upgrade and rollback proof
- publication state reported separately from local validation

### Phase 5 — Optional Team Cloud Beta

Goal: add team governance without moving local routing or sensitive content into the cloud.

Blocking owner decisions before this phase:

- identity provider
- database/hosting region
- tenant/RBAC model
- connector pairing protocol
- sync data classification
- retention/export/delete policy
- support and incident ownership

Tasks:

- P5-01 Implement auth, organizations, memberships, invitations, and roles.
- P5-02 Implement tenant-safe database migrations and server-side authorization.
- P5-03 Implement outbound connector pairing, rotation, revocation, compatibility, and heartbeat.
- P5-04 Implement allowlisted redacted revision sync and idempotency.
- P5-05 Implement shared policy proposals, approval, rollout, diff, and rollback.
- P5-06 Implement team eval suites and comparison.
- P5-07 Implement source freshness scheduling and review.
- P5-08 Implement audit events, retention, export, and deletion.
- P5-09 Implement Next.js BFF Route Handlers over the separate control-plane service.
- P5-10 Add tenant-isolation, replay, revocation, and cloud-outage tests.

Exit evidence:

- two isolated organizations cannot access each other by UI, API, job, connector, or object reference
- connector sync is outbound-only and survives retries/replay
- cloud outage does not interrupt local routing
- remote policy remains a proposal until locally approved
- no default sync payload contains raw prompts, bodies, paths, or secrets
- backup and restore of tenant metadata is proven

### Phase 6 — Production And Team Workflow Hardening

Goal: operate the optional hosted product safely and reliably.

Tasks:

- P6-01 Structured redacted logs and distributed request/job/revision IDs.
- P6-02 Metrics and alerts for route latency, job failures, connector health, stale age, contract failures, and auth anomalies.
- P6-03 SLOs, error budgets, deploy/rollback, migration, auth-outage, connector-outage, and incident runbooks.
- P6-04 Dependency, secret, SAST, abuse/rate-limit, and authorization scanning.
- P6-05 Backup/restore drills and documented RPO/RTO.
- P6-06 Load, failure-injection, and failover testing.
- P6-07 Team member lifecycle and approval workflows.
- P6-08 Usage accounting and billing only after beta usage validates the need.
- P6-09 Enterprise SSO/compliance only when there is a real customer requirement.
- P6-10 Keep marketplace as a separate roadmap and threat model.

Provisional targets to approve before production:

- local routing p95 below 50 ms at 500 skills
- product API p95 below 500 ms for normal reads
- connector revision visible within 30 seconds
- 99.9 percent hosted control-plane availability
- zero cross-tenant authorization failures
- tested restore within approved RPO/RTO

## Task Backlog

### UI backlog

| ID | Task | Depends on | Primary surfaces | Acceptance |
| --- | --- | --- | --- | --- |
| UI-01 | Fix reduced-motion hydration | none | number.tsx, motion primitives | zero hydration errors in production reduced-motion runs |
| UI-02 | Remove no-op and future claims | none | landing, command palette, dashboard actions | every CTA works, runs a deterministic labeled demo, or is disabled with explanation |
| UI-03 | Fix mobile overflow and controls | none | Connector, source banner, snapshot switcher, skills | zero document overflow at all required widths |
| UI-04 | Add URL-owned product shell | contracts | app routes/layout/navigation | refresh/back/deep links preserve state |
| UI-05 | Build onboarding | local API | onboarding routes | clean operator reaches first route |
| UI-06 | Build real Route Lab | route API | route and trace routes | changed prompt changes real result |
| UI-07 | Build skills/variants | qualified identity | skills routes | compare/select canonical variant with receipt |
| UI-08 | Build policy/eval/source workflows | jobs and contracts | policies/evals/sources | review operations persist revisioned receipts |
| UI-09 | Build integrations/activity/settings | connector and ledger | integrations/activity/settings | health, rollback, audit, privacy settings work |
| UI-10 | Decompose dashboard client | route shell | feature modules | no single client module owns all feature state |
| UI-11 | Build accessibility into every slice and run final audit | each UI slice | all | WCAG 2.2 AA automated/manual, zoom, forced-colors, touch, and screen-reader evidence |
| UI-12 | Complete public trust/docs surface | truthful product state | public routes | claims link to methodology/status/security/privacy |
| UI-13 | Add cross-browser visual regression | stable route fixtures | critical flows | Chromium/Firefox/WebKit and visual diff evidence |
| UI-14 | Enforce UI performance budgets | measured baseline | public and product routes | Core Web Vitals, startup, transition, filtering, and bundle gates |

### Backend backlog

| ID | Task | Depends on | Primary files/modules | Acceptance |
| --- | --- | --- | --- | --- |
| BE-01 | Qualified skill identity | none | schemas, inventory, policy, route | duplicate variant choice is explicit |
| BE-02 | Eval v2 evidence | BE-01 | eval, status, tests | self-labeling suite cannot be release |
| BE-03 | Safe export allowlist | none | export, privacy tests | canary scan contains no sensitive fields |
| BE-04 | Canonical snapshot digest | contracts | snapshot producer/loader | tamper is rejected |
| BE-05 | Source coverage model | BE-01 | sources, status | zero records is not clean coverage |
| BE-06 | Runtime-validated contracts | BE-01 | contracts and adapters | CLI/web contract parity tests pass |
| BE-07 | WorkspaceStateStore | BE-06 | state-store, fs, migrations | atomic revision and rollback proof |
| BE-08 | Shared use cases | BE-07 | commands/core/service | CLI/API call the same domain behavior |
| BE-09 | Local connector security | BE-08 | dashboard command/server/auth | loopback/origin/CSRF/capability tests pass |
| BE-10 | Local API | BE-09 | server/routes | live status, skills, route, jobs, events |
| BE-11 | Job/event ledger | BE-07 | jobs/events | idempotency, restart, cancellation proof |
| BE-12 | Redacted route ledger | BE-10 | routes/feedback | no raw prompt persistence |
| BE-13 | Source fetch hardening | BE-07 | sources/network | timeout/rate-limit/offline/immutable-ref proof |
| BE-14 | Hook/MCP revision hardening | BE-07 | hook, mcp | same approved revision and schemas |
| BE-15 | Hosted control plane | local beta gate | service/db/queue/BFF | tenant-safe redacted sync |
| BE-16 | Observability/operations | BE-10 or BE-15 | diagnostics/logging/metrics | redacted failure and recovery evidence |

### Product/release backlog

| ID | Task | Depends on | Outcome |
| --- | --- | --- | --- |
| PR-01 | Define product state taxonomy | none | Demo, local validated, public beta, hosted beta, production are never conflated |
| PR-02 | Reconcile product/release copy | PR-01 | README, handoff, package, site, changelog agree |
| PR-03 | Define north-star and metric methodology | route ledger | observed, eval, estimate, and hosted usage are separate |
| PR-04 | Package local UI/backend | local connector | one supported install/start/update/uninstall path |
| PR-05 | Expand CI/release gates | packaging | supported Node/OS, browser, privacy, migration, clean install |
| PR-06 | Complete docs/support/security | stable workflows | a new user can self-serve and recover |
| PR-07 | Run external pilots | public beta candidate | time-to-trusted-route and blockers recorded |
| PR-08 | Define hosted data/privacy decision | local beta gate | approved sync classification and retention |
| PR-09 | Establish deploy/incident/restore operations | hosted beta | live service can be operated and recovered |
| PR-10 | Defer billing/marketplace | usage evidence | monetization follows validated repeated use |

## Acceptance Criteria

### Personal V1 ready

- current worktree is intentionally reconciled
- current templated eval is labeled demo
- credible natural/negative/multi-skill holdout passes
- unresolved duplicate variants block readiness
- source coverage is honest
- safe export and snapshot integrity pass
- one approved workspace revision powers CLI, hook, MCP, API, and UI
- Route Lab executes a real route
- onboarding, skill, policy, eval, source, and integration workflows work
- no raw prompt is retained by default
- local connector security tests pass
- UI accessibility/responsive/state matrix passes
- package clean-install and rollback pass

### Public developer beta ready

- Personal V1 criteria pass
- Node 20/22 and supported OS CI pass
- CLI, web, browser, privacy, migration, failure, and consumer-install CI pass
- no P1 findings
- pilot onboarding gate passes
- support, privacy, security, update, rollback, and uninstall docs exist
- package name/version/release approval is explicit
- published/deployed state is verified separately

### Hosted team beta ready

- local routing works while cloud is unavailable
- auth and membership lifecycle work
- invalid/expired invites, session expiry, access denied, reauthentication, organization/workspace switching, and connector-pairing recovery work
- connector device pairing/rotation/revocation work
- every tenant API and job enforces ownership
- redacted sync schema and retention are approved
- signed policy proposal/approval/rollback works
- tenant-isolation and replay tests pass
- audit, backup, restore, and deletion evidence pass

### Production ready

- hosted beta criteria pass
- approved SLOs and alerts exist
- migration/deploy/rollback/incident runbooks are exercised
- backup restore meets approved RPO/RTO
- security/privacy review has no open P0/P1
- load/failure/failover evidence passes
- support ownership is assigned
- billing exists only if required and has independent payment/security acceptance

### UI acceptance matrix

Maintain an explicit route-by-state matrix. Each route/state cell must be verified or marked N/A with a reason; do not force meaningless states onto every route.

State catalog:

- live local
- explicit demo
- loading
- empty
- stale
- offline
- blocked
- unauthorized
- permission denied
- malformed/corrupt
- version mismatch
- server error

Verify at:

- 320x740
- 390x844
- 768x1024
- 1024x768
- 1440x1000

Verify:

- light and dark
- reduced motion
- keyboard only and touch-only
- automated accessibility
- manual focus, screen-reader, contrast, 200/400 percent zoom/reflow, and forced-colors/high-contrast
- Chromium, Firefox, and WebKit for critical onboarding, route, policy, connector, and recovery paths
- deterministic visual-regression baselines
- no unexpected or unhandled console, hydration, page, or network errors; expected offline/server-error requests are asserted
- approved LCP, INP, CLS, startup, transition, 500-skill filtering, and bundle budgets

## Validation Plan

### Existing commands to retain

~~~bash
npm ci
npm run typecheck
npm test
npm pack --dry-run

cd apps/web
npm ci
npm run test:fixtures
npm run typecheck
npm run lint
npm run build
SKILLMAP_WEB_BASE_URL=http://127.0.0.1:<port> npm run test:browser
SKILLMAP_WEB_BASE_URL=http://127.0.0.1:<port> npm run screenshots
~~~

### Scripts to add

~~~bash
npm run test:contracts
npm run test:integration
npm run test:privacy
npm run test:migrations
npm run test:failure
npm run test:connector
npm run test:e2e
npm run test:a11y
npm run test:visual
npm run test:perf
npm run test:consumer-install
npm run check:all
~~~

### Routing evidence

- dataset composition/provenance/leakage report
- train/holdout separation
- natural implicit prompts
- multi-skill cases
- negative/near-miss cases
- explicit-only and high-risk cases
- baseline comparison
- top-1/top-3/avoid plus abstention and override measures
- route equivalence across CLI/hook/MCP/API

### Privacy evidence

- canary prompt/body/path/secret scan across export, snapshots, logs, events, CI artifacts, and sync envelopes
- fuzz nested fields and unexpected keys
- prove route prompt is memory-only by default
- use HMAC or local-only identifiers where prompt hashes could enable guessing
- prove connector traffic stays loopback for local mode
- prove cloud sync contains only allowlisted fields

### State and migration evidence

- concurrent mutation test
- process interruption mid-commit
- disk full
- permission denial
- corrupt JSON and unsupported schema
- clock skew
- v1-to-v2 dual-read comparison
- last-known-good recovery
- last-known-good allowed for derived corruption with unchanged canonical intent
- last-known-good invalidated by root removal, policy block, canonical-variant change, source-security decision, privacy change, or incompatible schema
- rollback to prior revision

### Connector and integration evidence

- bootstrap token expiry/reuse
- Host/Origin/CSRF rejection
- traversal, symlink-escape, unapproved-root, arbitrary-import/export-destination, and content-revision race rejection
- request size/time/concurrency limits
- connector stop/restart/offline/version mismatch
- response-envelope, cursor/limit, compatibility, retryable-error, and 409 revision-conflict behavior
- job restart and idempotency
- hook coexistence and rollback
- hook stdin drain regression
- MCP schema, pagination, response limits, and redaction

### Hosted evidence

- role matrix
- object-level authorization
- cross-tenant isolation
- connector replay and revocation
- migration deploy/rollback
- backup/restore
- cloud outage with continuing local route
- rate limit and abuse controls
- retention/export/delete

## Risks And Dependencies

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Dirty worktree contains multiple completed slices | accidental overwrite or unclear checkpoint | freeze user changes, inventory them, and implement in small commits only when authorized |
| Current ready evidence is persuasive but tautological | product ships with false confidence | make composition/provenance/leakage part of readiness |
| Name-keyed policy is already embedded in artifacts | migration complexity | dual-read v1/v2 and explicit canonical decisions |
| Generic export has privacy leakage | unsafe sharing/hosted ingestion | block hosted work until allowlist export passes |
| Local UI packaging with Next is heavy | broken install or stale build process | implement the settled embedded static local bundle plus separate hosted Next build; never share a mutable .next between running processes |
| Loopback browser service expands attack surface | local data or mutation exposure | one-time fragment bootstrap, origin-scoped session capability headers, strict Host/Origin, CSRF header, no CORS, no arbitrary commands |
| Browser/private-network constraints complicate hosted-to-local calls | unreliable connector | hosted connector initiates outbound TLS; do not rely on public browser direct loopback |
| Real eval labeling is labor intensive | slow confidence gate | mine real prompts, label bounded samples, maintain holdout and feedback loop |
| GitHub source checks rate-limit or change | degraded provenance | immutable refs, cache, backoff, explicit degraded status |
| Hosted scope can dominate local value | delayed useful product | enforce local/public beta gates before cloud |
| Auth/database vendor is undecided | hosted architecture cannot finalize | defer only hosted phase; keep interfaces vendor-neutral until decision |

## Decisions

### Settled for implementation

- Personal-first, not hosted-first.
- Local deterministic routing is the critical path.
- Raw prompts and skill bodies stay local by default.
- Cloud is an optional control plane, not route-time dependency.
- Fixture and snapshot modes are demo/evidence modes, not the live product.
- Billing and marketplace are not on the current critical path.
- First implementation slice is the bounded False-Green Readiness Gate; qualified identity/safe share and UI truth repairs follow as separate acceptance cycles.

### Block hosted implementation

- identity provider and session model
- database and hosting region
- organization/RBAC model
- connector pairing and credential lifecycle
- sync field classification
- retention, deletion, and training policy
- billing model if ever required

### Can resolve during local implementation

- exact runtime schema library
- lightweight HTTP implementation
- optional SQLite event/job index
- exact static-asset build mechanism within the settled embedded-local/separate-hosted topology
- polling interval and whether SSE is needed
- exact diagnostics artifact format

## Implementation Orchestrator Handoff

### Implementation program: three bounded slices

Do not execute all Phase 0 work as one patch. Run three goals and acceptance cycles in this order.

#### Slice A — False-Green Readiness Gate

This is the exact first implementation slice.

Objective:

Make SkillMap incapable of reporting release/ready or authorizing hook install from a self-labeling eval, unresolved duplicate-name group, or vacuous source registry.

Source-of-truth contract:

- Intent: repair acceptance truth before identity migration, export redesign, UI repair, or connector work.
- Truth owner: eval v2 composition/provenance summary, duplicate inventory summary, source coverage state, status readiness, and hook preflight.
- Boundary: root CLI/core/tests and the minimum matching docs only.
- Displaced path:
  - count-only release confidence
  - duplicate detection only when a policy name exists
  - zero source records interpreted as clean coverage
- Cutover:
  - the current workspace becomes attention-required or blocked
  - a credible eval composition, explicit duplicate decisions, and honest source classification can later restore ready
- Acceptance evidence:
  - current suite classified demo/smoke
  - duplicate-name fixture blocks readiness even without a name-keyed policy entry
  - zero source records reports not-configured or not-applicable, never covered
  - hook preflight refuses the corrected non-ready state
- Kill criteria:
  - the current 150 cases still produce release
  - omitting duplicate names from policy still bypasses readiness
  - zero source records still contributes a green source gate
- Forbidden moves:
  - no identity migration, export redesign, digest migration, UI change, connector, publication, deployment, or global hook
  - no threshold weakening to recover green

Exact tasks:

1. Extend eval suite/report metadata with primary case type, provenance, dataset digest, effective-revision digest, holdout membership, leakage result, and composition counts.
2. Reclassify the current generated suite as demo/smoke because it fails release composition and leakage rules.
3. Implement the disjoint eval anti-cheat rules already defined in Phase 1.
4. Make any unresolved duplicate-name group block readiness regardless of whether policy contains that display name.
5. Add source coverage states not-configured, not-applicable, partial, and covered.
6. Gate hook install on corrected readiness.
7. Add focused regressions and reconcile only the eval/status/hook/source documentation and evidence labels.

Likely files:

- src/schemas/types.ts
- src/commands/eval.ts
- src/core/status.ts
- src/commands/status.ts
- src/commands/hook.ts
- src/commands/sources.ts
- test/core.mjs
- test/fixtures
- README.md
- docs/commands.md
- docs/dogfood.md
- docs/hooks.md
- docs/release-checklist.md

#### Slice B — Qualified Identity And Safe Share

Objective:

Migrate name-keyed policy to the defined policy v2/qualified identity model and make shareable exports and snapshot integrity verifiable.

Tasks:

1. Add persisted opaque rootId, stable skillId, complete-tree contentRevision, collision handling, and canonical variant decisions.
2. Implement the policy v2 shape, precedence, v1 unique-name mapping, duplicate unresolved path, noncanonical routing behavior, migration receipt, and rollback defined above.
3. Make safe export allowlist-based with explicit local-only sensitive opt-in.
4. Implement canonical payloadDigest verification and optional transportDigest.
5. Add v1 dual-read/migration/rollback and privacy/tamper regressions.

Likely files:

- src/schemas/types.ts
- src/core/inventory.ts
- src/core/policy.ts
- src/core/route.ts
- src/core/status.ts
- src/core/dashboard-snapshot.ts
- src/commands/export.ts
- test/core.mjs
- test/fixtures
- apps/web/lib/contracts/skillmap-dashboard.ts
- apps/web/lib/dashboard-data.ts
- docs/security.md
- docs/threat-model.md

#### Slice C — UI Truth And Accessibility Repairs

Objective:

Remove false affordances and current production accessibility/responsive defects without yet building the live connector.

Tasks:

1. Fix AnimatedNumber reduced-motion hydration.
2. Make no-op controls run a deterministic labeled demo or disable them with explanation.
3. Replace present-tense hosted/team/billing metrics and copy with truthful product-state language.
4. Fix mobile Connector overflow and expose a discoverable mobile source/workspace switcher.
5. Add reduced-motion, mobile overflow, cross-browser critical-flow, and primitive accessibility regressions.

Likely files:

- apps/web/components/ui/number.tsx
- apps/web/components/ui/tabs.tsx
- apps/web/components/ui/drawer.tsx
- apps/web/components/ui/command-palette.tsx
- apps/web/components/skillmap/landing-page.tsx
- apps/web/components/skillmap/dashboard-client.tsx
- apps/web/scripts
- apps/web/data/fixtures
- apps/web/README.md
- README.md
- HANDOFF.md

### Allowed changes across the three-slice program

- versioned schema additions and v1 adapters
- new review/evidence fields
- readiness gates that turn current false green into attention/blocked
- focused UI truth/accessibility repairs
- privacy, tamper, and duplicate regressions
- documentation reconciliation

### Disallowed changes

- hosted auth/database/billing/marketplace
- automatic source update
- runtime model calls
- global hook install
- public release actions
- unrelated design redesign

### Required skills/tools

- implementation-orchestrator for execution
- checkpoint-quality-loop after each slice
- engineering-acceptance-review before accepting the slice
- frontend-design for UI repairs
- security/privacy review for export/snapshot/connector boundaries
- Context7 for version-specific Next.js/runtime decisions
- browser/Playwright for target-perspective UI evidence

### Required validation per slice

Slice A:

~~~bash
npm ci
npm run typecheck
npm test
npm pack --dry-run
~~~

Slice B adds contract/privacy consumer checks:

~~~bash
npm ci
npm run typecheck
npm test
npm pack --dry-run

cd apps/web
npm run test:fixtures
npm run typecheck
~~~

Slice C adds the complete current web ladder:

~~~bash
cd apps/web
npm ci
npm run test:fixtures
npm run typecheck
npm run lint
npm run build
npm run test:browser
~~~

Slice A proofs:

- jq or test evidence that the current eval is self-labeling and classified demo
- status/hook evidence that it cannot authorize release
- duplicate-name fixture blocks readiness with no policy entry
- source zero-record state is not called clean/covered

Slice B proofs:

- qualified identity/policy-v2 migration and rollback fixture
- safe-export sensitive canaries absent
- canonical payload tamper rejected

Slice C proofs:

- reduced-motion production browser has no hydration errors
- Connector has no mobile overflow
- no clickable no-op remains
- Chromium, Firefox, and WebKit critical smoke passes

### Open questions

Block Slice A:

- none; this plan makes the necessary product decisions

Can resolve during the applicable slice:

- whether corrected current status becomes blocked or attention-required while credible evals are missing
- exact schema validator in Slice B
- exact local-only flag name for sensitive export in Slice B

Block later hosted work:

- all hosted owner decisions listed above

### Stop conditions

- stop Slice A if readiness can be restored only by weakening evidence gates
- stop Slice B if identity migration would overwrite/delete user artifacts or a safe v1 read/rollback adapter cannot be provided
- stop and expand Slice B if privacy testing finds sensitive data in another shareable surface
- stop Slice C if the build under test cannot be tied to the current source revision

### Do not claim Slice A complete until

- the old evidence is visibly not release-ready
- unresolved duplicate names block readiness even when absent from policy
- zero source records are classified honestly
- hook preflight follows corrected readiness
- root validation passes
- no publication, deployment, or global hook claim is implied

The implementation orchestrator should create one goal for Slice A, close it only against Slice A evidence, then repeat for Slice B and Slice C. Proceed to the revision-store and live local connector phases only after all three acceptance cycles pass.

Implementation must not report verified unless target-perspective evidence is captured from the real route, payload, record, artifact, trace, rendered UI, or operator-visible output.

## Orchestration Closeout

- Workers actually used: 3
- Worker scopes:
  - UI/product surface
  - backend/data/connector architecture
  - product/release/evidence quality
- Worker results accepted:
  - visual foundation is strong but functionally incomplete
  - current routing evidence is self-labeling and not release proof
  - duplicate identities bypass current readiness
  - safe export and unverified snapshot payloadDigest have material trust gaps
  - local loopback service is the correct next backend
  - hosted control plane must remain optional and later
  - UI needs real routes/workflows, accessibility hardening, and full state coverage
- Worker results rejected or adapted:
  - a separate publishable shared contracts package was adapted to canonical repository schemas first because the root CLI package is currently publishable and an unpublished workspace dependency would complicate clean install
  - numerical production SLOs are provisional targets, not current commitments
- Worker results unverified:
  - exact hosted vendor/provider behavior because no provider was selected
  - production deployment/auth/database state because none exists
- Parent verification:
  - read the requested planning skill and required supporting skills
  - inspected repo, branch, dirty state, docs, source, plans, evidence, and screenshots
  - ran current root typecheck/tests
  - ran web fixture/typecheck/lint checks
  - ran fresh HTTP/browser smoke against the current local snapshot build
  - directly confirmed eval composition, duplicate groups, route selection behavior, export prompt inclusion, and that the loader does not recompute the producer's canonical snapshot payloadDigest
  - inspected reduced-motion implementation and current false affordances
- Gaps that would benefit from more workers:
  - hosted auth/database/provider selection at Phase 5
  - focused threat model before connector or hosted sync implementation
  - external pilot analysis before public beta
- Visible thread considered: yes; rejected because the user asked for one comprehensive parent-owned plan
