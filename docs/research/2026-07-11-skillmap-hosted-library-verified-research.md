# SkillMap Hosted Library Verified Research Dossier

## Research Contract

- Research mode: deep research audit feeding planning and implementation.
- Frozen on: 2026-07-11 UTC.
- Target repository: `/home/codex/projects/skillmap`.
- Target revision inspected: `a468324` on `main`, synchronized with `origin/main` before edits.
- Decision supported: whether and how to build SkillMap now as a hosted, free-to-users skill library with Supabase user management, public catalog and trust data, auditing, updates, grading, and a deterministic router.
- Approved product constraints:
  - Supabase owns launch authentication and hosted application data.
  - The public launch is free to users.
  - Stripe is a named future option only; launch contains no billing implementation.
  - The end state is an online product, not only a local CLI or fixture website.
  - Local prompt routing and progressive loading remain deterministic and private by default.
- Time-sensitive surfaces: Supabase platform behavior and limits, Next.js 16 integration, Node support, Vercel plans, Codex skill/plugin distribution, and current supply-chain standards.
- Primary source classes: repository truth (T0), official specifications/docs/changelogs/repos (T1), and read-only runtime/account checks (T2).
- Exclusions: no third-party skill bodies were ingested; no production service, Supabase project, deployment, OAuth app, or billing resource was created.
- Stop conditions: unresolved identity domains, unsafe RLS assumptions, fabricated grades, unclear redistribution rights, synchronous heavy work in a web request, or any requirement to expose secrets or raw prompts.

## Executive Findings

1. Implementing the hosted product now is rational, but the original phase order is not. The first implementation slice should establish a real Supabase-backed catalog and account spine instead of another file-only/local-only prototype.
2. Supabase is a strong launch fit for Auth, Postgres, RLS, Storage, Queues, and Cron. It is not a complete heavy-worker runtime: current Edge Function CPU, memory, and duration limits rule out substantial repository scanning, browser evaluation, or grading.
3. “Free for everyone” is a product/pricing decision, not an infrastructure guarantee. Supabase Free is suitable for local development and private alpha, but pausing, limited retention, and absent managed backups conflict with the plan's public reliability gates. Vercel Hobby is officially personal/non-commercial. Public launch needs a separate infrastructure-cost approval even though Stripe is absent.
4. Supabase SSR for the current Next.js stack requires `@supabase/ssr`, request-scoped clients, `proxy.ts`, verified `getClaims()`/fresh `getUser()` checks, forwarded auth cookies, and anti-cache headers. `getSession()` is not an authorization proof.
5. New Supabase projects no longer expose newly created tables to the Data API automatically. Every migration must make API exposure, grants, RLS, policies, and indexes explicit. Public catalog reads and private account/publisher writes must be proved with database-level tests.
6. The root CLI's local `sk_...` identity and hosted `skl_...`/`skv_...` identities are different domains. Reusing or migrating local IDs in the first hosted slice would create ambiguity and is forbidden.
7. Agent Skills is an authoring/package convention, not a registry, trust, versioning, audit, grading, or distribution specification. SkillMap must preserve the portable `SKILL.md` source while adding its own versioned registry/import profile.
8. The plan's OpenAI skills-catalog reference is stale. `openai/skills` is deprecated; current Codex examples and distribution use OpenAI plugins. SkillMap should ultimately ship one lightweight plugin with a stable search/route/load surface, never one plugin or MCP tool per catalog skill.
9. No authoritative census of every skill exists. “All skills” must mean all discovered records within a declared source universe, with published adapter coverage, crawl freshness, failures, and eligibility counts. A 150-300 item corpus is an initial fully evidenced launch milestone, not a permanent ceiling.
10. Public source visibility is not redistribution permission. License evidence and mirroring eligibility must be resolved per skill version and file. Unclear rights permit metadata and a source link, not body mirroring.
11. Trust signals must remain separate: identity verification, source control, provenance, security audit, compatibility evidence, and grade currency do not imply one another and none certifies safety.
12. Package/update integrity should reuse established models: non-reusable immutable version identities, SLSA/in-toto-shaped attestations, TUF-style rollback/freeze/key-rotation protections, OSV-inspired advisories, and version-scoped relationship evidence.
13. Grades must be version-, host-profile-, rubric-, suite-, and evidence-bound. Effectiveness should be measured against a no-skill or previous-version baseline with held-out cases, repeated trials, variance, cost deltas, and explicit stale/invalidation rules.
14. The repository already contains valuable deterministic routing, bounded skill-tree hashing, exact-commit GitHub reads, local source state, evaluation infrastructure, and strong web QA. Those are reusable foundations, but they are not hosted publication, per-skill grading, authenticated registry APIs, or online catalog proof.

## Claim Ledger

The ledger below is frozen for planning. Only `confirmed` claims and explicit owner decisions may be treated as implementation facts. `likely`, `disputed`, `stale`, and `unverifiable` entries are not implementation authority.

### R1 - Supabase is a rational hosted application spine

- Claim: Supabase can own launch Auth, Postgres catalog metadata, RLS, Storage, queue coordination, and scheduled orchestration.
- Why it matters: selects the primary hosted data and user-management platform.
- Source tier: T1 official docs, corroborated by T2 authenticated project/account access and installed CLI inspection.
- Sources: Supabase Auth, Database/RLS, Storage, Queues, Cron, and pricing documentation.
- Freshness/date: accessed 2026-07-11; CLI observed at 2.109.0.
- Version/platform/context: hosted Supabase, Next.js 16 web app.
- Verification method: official docs plus read-only organization/project listing; no SkillMap project exists.
- Status: confirmed.
- Confidence: high.
- Contradictions: none material.
- Implication: name Supabase as truth owner; create migrations and RLS tests before UI claims.
- Actionability: immediate.
- Planning handoff: move data/auth foundation into the first phase and first slice.
- Implementation risk: high because auth, data exposure, and migration correctness are involved.

### R2 - Current Next.js SSR auth needs request-scoped Supabase clients and Proxy refresh

- Claim: browser and server clients use `@supabase/ssr`; Server Components cannot write refresh cookies, so root `proxy.ts` refreshes claims and forwards request/response cookies and cache-control headers.
- Why it matters: defines the safe authentication boundary.
- Source tier: T1 official Supabase SSR docs and official Next.js 16 docs.
- Sources: Supabase SSR client guide; Context7 snapshots of `/supabase/ssr` and `/vercel/next.js/v16.2.9`.
- Freshness/date: accessed 2026-07-11.
- Version/platform/context: Next.js 16.2.x App Router.
- Verification method: cross-checked current official examples and local repo version 16.2.10.
- Status: confirmed.
- Confidence: high.
- Contradictions: older examples use `middleware.ts`; Next.js 16 current convention is `proxy.ts`.
- Implication: implement `client.ts`, `server.ts`, `proxy.ts`, and session refresh together.
- Actionability: immediate.
- Planning handoff: make cookie/header behavior and non-caching acceptance criteria explicit.
- Implementation risk: high; incorrect cookie propagation causes random logout or cross-user caching risk.

### R3 - `getSession()` is not authorization proof

- Claim: server authorization must use verified `getClaims()` or a fresh `getUser()` result, not the cookie-loaded user from `getSession()`.
- Why it matters: prevents spoofed-session authorization.
- Source tier: T1 official Supabase Auth docs.
- Sources: Supabase SSR client guide and `@supabase/ssr` official repository docs.
- Freshness/date: accessed 2026-07-11.
- Version/platform/context: cookie-based SSR.
- Verification method: official documentation comparison.
- Status: confirmed.
- Confidence: high.
- Contradictions: older snippets use `getSession()` only for refresh mechanics; they do not make it a safe authorization check.
- Implication: protect account/publisher routes with claims/user verification and retain RLS as final enforcement.
- Actionability: immediate.
- Planning handoff: add auth-negative tests.
- Implementation risk: account takeover/data leakage if ignored.

### R4 - Data API exposure, SQL grants, and RLS are separate controls

- Claim: new Supabase projects do not automatically expose new tables; exposed tables still require explicit grants, enabled RLS, policies, and indexed policy predicates.
- Why it matters: public catalog availability and privacy cannot be inferred from table creation.
- Source tier: T1 Supabase changelog and RLS/API hardening docs.
- Sources: 2026-04-28 Data/GraphQL API exposure change; RLS guide; API hardening guide.
- Freshness/date: current on 2026-07-11.
- Version/platform/context: new hosted projects and local CLI migrations.
- Verification method: official changelog/docs.
- Status: confirmed.
- Confidence: high.
- Contradictions: older tutorials assume automatic exposure.
- Implication: every migration bundles exposure/grants/RLS/policies; no dashboard-only schema edits.
- Actionability: immediate.
- Planning handoff: include pgTAP/RLS and direct REST tests.
- Implementation risk: high.

### R5 - Publishable and secret keys have different trust boundaries

- Claim: the publishable key may be used by the browser only with correct grants/RLS; secret/service keys bypass RLS and must never enter browser bundles, screenshots, logs, or public CI artifacts.
- Why it matters: establishes the client/server secret boundary.
- Source tier: T1 Supabase key and Storage docs.
- Sources: Supabase API keys and Storage access-control documentation.
- Freshness/date: accessed 2026-07-11; current key naming uses `sb_publishable_...` and `sb_secret_...`.
- Version/platform/context: web client plus trusted workers.
- Verification method: official docs.
- Status: confirmed.
- Confidence: high.
- Contradictions: legacy `anon`/`service_role` examples remain valid but are no longer preferred naming.
- Implication: only public URL/publishable key are `NEXT_PUBLIC_`; trusted components get separately scoped secrets.
- Actionability: immediate.
- Planning handoff: add bundle/secret canaries.
- Implementation risk: critical if violated.

### R6 - GitHub OAuth through Supabase is suitable for the launch audience

- Claim: GitHub OAuth can be the primary launch sign-in with an exact callback/redirect allowlist and PKCE code exchange.
- Why it matters: gives free-user accounts a low-friction path without building password management.
- Source tier: T1 Supabase GitHub Auth documentation.
- Sources: Supabase GitHub social-login and redirect URL guides.
- Freshness/date: accessed 2026-07-11.
- Version/platform/context: developer-focused public catalog.
- Verification method: official docs; OAuth app not created in this run.
- Status: confirmed.
- Confidence: high for platform capability; live configuration remains unverified.
- Contradictions: none.
- Implication: launch GitHub-first; enable email only after custom SMTP and abuse controls exist.
- Actionability: code now, live configuration later.
- Planning handoff: add manual callback/provider gate.
- Implementation risk: redirect/open-redirect and misconfiguration risk.

### R7 - Node 20 is no longer a valid Supabase SDK target

- Claim: Supabase ended Node 20 support on 2026-06-30; the web/deploy/hosted lanes should require Node 22 or newer.
- Why it matters: the repo currently tests the web app on Node 20 and 22.
- Source tier: T1 Supabase changelog.
- Sources: Supabase Node 20 support deprecation notice.
- Freshness/date: effective before this dossier date.
- Version/platform/context: Supabase JavaScript clients; local Node is 24.18.0.
- Verification method: official changelog and local package/CI inspection.
- Status: confirmed.
- Confidence: high.
- Contradictions: the root local CLI may still support Node 20 if it does not depend on Supabase.
- Implication: keep CLI compatibility separate; move `apps/web` and hosted CI to Node >=22.
- Actionability: first slice.
- Planning handoff: add CI/runtime correction.
- Implementation risk: build/runtime drift if ignored.

### R8 - Supabase Free is an alpha tier, not the public reliability proof

- Claim: Free currently includes 50,000 MAU, 500 MB database, 1 GB Storage, limited egress and Edge capacity, but projects can pause after a week of low activity and lack managed daily backups.
- Why it matters: the plan targets availability, restore, and public trust.
- Source tier: T1 official pricing, billing, pausing, and backup docs.
- Sources: Supabase pricing and platform usage documentation.
- Freshness/date: accessed 2026-07-11; prices/limits are time-sensitive.
- Version/platform/context: Free vs Pro hosted plan.
- Verification method: official pages.
- Status: confirmed.
- Confidence: high.
- Contradictions: “start free” does not mean production SLOs are free.
- Implication: use Free for dev/private alpha; require explicit infrastructure-plan approval before public launch.
- Actionability: plan gate; no spend authorized now.
- Planning handoff: separate free-to-users from infrastructure budget.
- Implementation risk: downtime/data-loss claims if conflated.

### R9 - Supabase Storage is not an intrinsic WORM artifact store

- Claim: Storage can be protected by RLS and server-only writes, but privileged keys can mutate objects and database backups do not include Storage objects.
- Why it matters: the plan calls artifacts immutable and recoverable.
- Source tier: T1 Storage and backup docs.
- Sources: Storage buckets/access-control docs and platform backup docs.
- Freshness/date: accessed 2026-07-11.
- Version/platform/context: public artifacts and private evidence buckets.
- Verification method: official docs.
- Status: confirmed.
- Confidence: high.
- Contradictions: “content-addressed” is an application invariant, not a provider WORM guarantee.
- Implication: digest path, `upsert:false`, no client writes/deletes, integrity sweeps, and independent Storage export/backup.
- Actionability: artifact phase.
- Planning handoff: correct “immutable object storage” wording.
- Implementation risk: artifact replacement or unrecoverable loss.

### R10 - Queue effects must be idempotent despite vendor exactly-once wording

- Claim: Supabase Queues documents exactly-once delivery within a visibility window, while failed/unacknowledged work can reappear; application effects must therefore be designed as at-least-once and idempotent.
- Why it matters: ingestion, regrading, and revocation cannot duplicate consequences.
- Source tier: T1 official Queues docs interpreted conservatively.
- Sources: Supabase Queues overview and quickstart.
- Freshness/date: accessed 2026-07-11.
- Version/platform/context: `pgmq` queues.
- Verification method: contract/visibility semantics review; no live queue was created.
- Status: disputed.
- Confidence: medium.
- Contradictions: marketing phrase “exactly once” versus retry visibility behavior.
- Implication: use idempotency keys, transactional receipts, bounded retries, and DLQ regardless of vendor wording.
- Actionability: queue phase.
- Planning handoff: never rely on single delivery.
- Implementation risk: duplicate publication/audit/notification effects.

### R11 - Edge Functions are orchestration, not heavy grading workers

- Claim: current hosted limits (256 MB, 2 seconds CPU/request, 150 seconds wall clock on Free) fit webhook validation/enqueue and short I/O work, not cloning/scanning repositories or behavioral grading.
- Why it matters: prevents an architecture that fails under normal jobs.
- Source tier: T1 Edge Function limits docs.
- Sources: Supabase Edge Function limits and background-task docs.
- Freshness/date: accessed 2026-07-11.
- Version/platform/context: Free launch infrastructure.
- Verification method: official limits.
- Status: confirmed.
- Confidence: high.
- Contradictions: background tasks can outlive a response but not the worker's resource limits.
- Implication: separate containerized Node worker consumes job IDs; web and Edge never perform heavy jobs synchronously.
- Actionability: architecture now, provider decision before worker deployment.
- Planning handoff: preserve the queue/worker boundary.
- Implementation risk: timeouts, unsafe resource use, incomplete jobs.

### R12 - Launch contains no billing implementation

- Claim: the product remains free to every user at launch; Stripe is deferred and no billing package, schema, webhook, entitlement, checkout, price, or billing UI belongs in launch work.
- Why it matters: prevents speculative scope and accidental monetization gates.
- Source tier: owner decision (authoritative product constraint).
- Sources: user instruction on 2026-07-11.
- Freshness/date: current.
- Version/platform/context: launch scope.
- Verification method: direct owner statement.
- Status: confirmed.
- Confidence: high.
- Contradictions: the old plan's future paid phase is not launch authorization.
- Implication: remove billing from launch dependencies and tests; keep only a future ADR boundary.
- Actionability: immediate.
- Planning handoff: Stripe remains named but entirely deferred.
- Implementation risk: scope creep if ignored.

### R13 - Agent Skills is a source format, not a registry contract

- Claim: the specification defines `SKILL.md` plus optional files and metadata, but not global IDs, immutable publication, dependencies, audit receipts, grades, or registry lifecycle.
- Why it matters: avoids treating compatibility validation as product trust.
- Source tier: T1 Agent Skills specification.
- Sources: Agent Skills specification and client implementation guide.
- Freshness/date: accessed 2026-07-11.
- Version/platform/context: portable skill authoring.
- Verification method: specification review.
- Status: confirmed.
- Confidence: high.
- Contradictions: none.
- Implication: preserve upstream bytes and version the SkillMap import/profile separately.
- Actionability: contracts phase.
- Planning handoff: record specification snapshot/importer version.
- Implementation risk: destructive normalization or false compatibility claims.

### R14 - The OpenAI skills-catalog reference is stale

- Claim: `openai/skills` is deprecated and directs users to `openai/plugins` and current plugin documentation.
- Why it matters: changes Codex connection and distribution planning.
- Source tier: T1 official OpenAI GitHub repositories and official docs.
- Sources: `https://github.com/openai/skills`, `https://github.com/openai/plugins`, OpenAI build/submit plugin guides.
- Freshness/date: verified 2026-07-11.
- Version/platform/context: current Codex plugin distribution.
- Verification method: direct official repository/docs inspection.
- Status: stale (the old plan reference), with replacement confirmed.
- Confidence: high.
- Contradictions: the deprecated repository remains online but is not the current authority.
- Implication: plan one SkillMap plugin with a stable connector surface; do not bundle the catalog.
- Actionability: plan correction now; plugin implementation later.
- Planning handoff: replace source reference and connection deliverable.
- Implementation risk: building for a superseded distribution path.

### R15 - Literal “all skills” is not verifiable

- Claim: there is no authoritative global skill census or single distribution channel.
- Why it matters: prevents an unprovable completeness claim.
- Source tier: T1 specs/repos plus absence of an authoritative global registry.
- Sources: Agent Skills specification, OpenAI plugins, multi-skill repositories, skills.sh disclosure.
- Freshness/date: assessed 2026-07-11.
- Version/platform/context: public catalog coverage.
- Verification method: source ecosystem review.
- Status: unverifiable.
- Confidence: high that no cited authority provides a global census.
- Contradictions: directories can count their own indexed universe, not the whole internet.
- Implication: define source adapters and publish coverage/failure/freshness counts.
- Actionability: immediate terminology correction.
- Planning handoff: 150-300 is launch evidence milestone; declared-universe coverage is the ongoing goal.
- Implementation risk: misleading marketing and impossible acceptance gate.

### R16 - Repository visibility is not redistribution permission

- Claim: absent a license, default copyright prevents reproduction/distribution; repositories and bundles may contain mixed per-skill licenses.
- Why it matters: controls whether SkillMap may mirror bodies/artifacts.
- Source tier: T1 GitHub licensing docs and official source repositories.
- Sources: GitHub licensing documentation; Anthropic/OpenAI repository license notices.
- Freshness/date: accessed 2026-07-11.
- Version/platform/context: public source ingestion.
- Verification method: official docs/repo inspection.
- Status: confirmed.
- Confidence: high for the operational rule; legal counsel remains final authority.
- Contradictions: public readability is not a grant to redistribute.
- Implication: declared/detected/concluded SPDX evidence per version/file; metadata-only fallback.
- Actionability: contracts and ingestion.
- Planning handoff: no blind mirroring.
- Implementation risk: copyright/takedown exposure.

### R17 - Published identities and versions must never be reused

- Claim: mature registries reserve used coordinates and prefer deprecation/yanking over identity reuse; mutable tags are aliases, not integrity authority.
- Why it matters: keeps pins, audits, advisories, and provenance reproducible.
- Source tier: T1 npm, VS Code, GitHub immutable-release docs.
- Sources: npm unpublish policy; VS Code publishing; GitHub immutable releases.
- Freshness/date: accessed 2026-07-11.
- Version/platform/context: hosted skill lifecycle.
- Verification method: official policy review.
- Status: confirmed.
- Confidence: high.
- Contradictions: none.
- Implication: immutable public IDs/digests, tombstones, reserved aliases, redirects, and transfer history.
- Actionability: data model.
- Planning handoff: distinguish human aliases from machine identity.
- Implementation risk: identity resurrection and supply-chain substitution.

### R18 - Provenance, audit, and grades should be separate digest-bound attestations

- Claim: SLSA and in-toto bind statements to immutable subject digests and typed predicates; provenance explains production but does not certify safety or quality.
- Why it matters: prevents conflated trust badges and unverifiable receipts.
- Source tier: T1 SLSA and in-toto specifications.
- Sources: SLSA v1.2 and in-toto Statement v1.
- Freshness/date: accessed 2026-07-11.
- Version/platform/context: artifact, audit, and grade receipts.
- Verification method: specification review.
- Status: confirmed.
- Confidence: high.
- Contradictions: none.
- Implication: separate signed predicates for provenance, audit results, compatibility, and grade evidence.
- Actionability: contract phase.
- Planning handoff: receipt subjects use exact version/artifact digests.
- Implementation risk: claiming evidence for the wrong bytes.

### R19 - A verified publisher is not a safe publisher

- Claim: identity/source verification does not prove code safety, audit completion, compatibility, or grade quality.
- Why it matters: protects users from badge overclaiming.
- Source tier: T1 GitHub marketplace badge guidance plus supply-chain standards.
- Sources: GitHub marketplace badge docs; SLSA/Sigstore threat models.
- Freshness/date: accessed 2026-07-11.
- Version/platform/context: public skill detail UI.
- Verification method: official documentation.
- Status: false (the conflated assumption).
- Confidence: high.
- Contradictions: none.
- Implication: independent, narrowly worded evidence states and timestamps.
- Actionability: UI/data vocabulary.
- Planning handoff: never show one broad “verified/safe” badge.
- Implementation risk: dangerous user trust inference.

### R20 - Popularity is not quality

- Claim: install/star counts measure activity or telemetry, not security, compatibility, or effectiveness.
- Why it matters: controls grading and router ranking.
- Source tier: T1 skills.sh disclosure and registry policy sources.
- Sources: skills.sh documentation and GitHub/npm signal definitions.
- Freshness/date: accessed 2026-07-11.
- Version/platform/context: search ranking and grades.
- Verification method: direct disclosure review.
- Status: false (the popularity-equals-quality assumption).
- Confidence: high.
- Contradictions: popularity may be displayed as a separately labeled signal later.
- Implication: exclude popularity from grade and deterministic route score.
- Actionability: ranking contract.
- Planning handoff: add gaming controls before display.
- Implementation risk: misleading recommendations.

### R21 - TUF-equivalent update protections are required

- Claim: signed metadata alone is insufficient; rollback, freeze, mix-and-match, expiry, threshold root rotation, and recovery are established update-system threats.
- Why it matters: clients will trust compact indexes, artifacts, and revocation overlays.
- Source tier: T1 TUF specification.
- Sources: The Update Framework specification.
- Freshness/date: accessed 2026-07-11.
- Version/platform/context: public registry update metadata.
- Verification method: specification review.
- Status: confirmed.
- Confidence: high.
- Contradictions: a custom equivalent is possible but requires an ADR proving parity.
- Implication: specify a SkillMap TUF profile instead of an underspecified bespoke signature scheme.
- Actionability: package/index phase.
- Planning handoff: add root/targets/snapshot/timestamp deliverable and client freeze behavior.
- Implementation risk: rollback or stale revocation acceptance.

### R22 - Per-skill grades need baseline and held-out evidence

- Claim: meaningful effectiveness grading compares with-skill results to no-skill/previous-version baselines in clean contexts, with repeated trials, held-out evaluation, evidence-backed assertions, and cost capture.
- Why it matters: makes grades reproducible and resistant to overfitting.
- Source tier: T1 Agent Skills evaluation guidance plus T0 existing SkillMap eval discipline.
- Sources: Agent Skills evaluation guide; current `eval-suite/v3` and `eval-run/v3` contracts.
- Freshness/date: inspected 2026-07-11.
- Version/platform/context: Codex host profile launch.
- Verification method: official guide and repo contract comparison.
- Status: confirmed.
- Confidence: high.
- Contradictions: current SkillMap eval grades a registry/router, not individual skill versions.
- Implication: build a distinct per-skill rubric/receipt system; do not relabel current eval output.
- Actionability: grading phase.
- Planning handoff: seed first slice as `ungraded`, never with fabricated letter grades.
- Implementation risk: false authority and irreproducible scores.

### R23 - Host portability is structural, not behavioral proof

- Claim: skills can share an authoring format while activation budgets, tool syntax, plugin containers, discovery paths, and runtime behavior differ by host.
- Why it matters: controls compatibility labels.
- Source tier: T1 Agent Skills and current host documentation.
- Sources: Agent Skills spec; OpenAI skill/plugin docs; host repositories.
- Freshness/date: accessed 2026-07-11.
- Version/platform/context: Codex-first launch, other hosts later.
- Verification method: cross-document comparison.
- Status: disputed as a broad portability claim; structural portability is confirmed, behavioral equivalence is not.
- Confidence: high.
- Contradictions: “write once” messaging versus host-specific behavior and containers.
- Implication: launch one frozen Codex profile and evidence level; do not infer compatibility from frontmatter alone.
- Actionability: compatibility contract.
- Planning handoff: other hosts remain separate profiles.
- Implementation risk: false compatibility claims.

### R24 - Webhooks need idempotency and reconciliation

- Claim: GitHub does not automatically redeliver failed webhook deliveries; signatures and delivery GUIDs must be verified/deduplicated and polling reconciliation retained.
- Why it matters: update detection and regrading cannot rely on one delivery.
- Source tier: T1 GitHub webhook best-practice docs.
- Sources: GitHub webhook best practices.
- Freshness/date: accessed 2026-07-11.
- Version/platform/context: exact-commit source watchers.
- Verification method: official docs.
- Status: confirmed.
- Confidence: high.
- Contradictions: none.
- Implication: verify signatures, enqueue asynchronously, dedupe delivery IDs, and schedule exact-commit reconciliation.
- Actionability: ingestion phase.
- Planning handoff: webhook is a fast path, not truth owner.
- Implementation risk: missed or duplicated updates.

### R25 - A Supabase-backed catalog/account spine is the smallest useful online slice

- Claim: shared contracts, RLS schema, three clearly licensed first-party versions, anonymous `/skills` and detail routes, GitHub auth, user-owned saved skills, and public APIs prove more of the chosen product than a file-backed registry alone.
- Why it matters: selects the implementation starting point.
- Source tier: T0 repo gap analysis plus confirmed platform/product constraints.
- Sources: current repository, frozen claims R1-R24, and owner instruction.
- Freshness/date: 2026-07-11.
- Version/platform/context: current Next.js app and local Supabase CLI/Docker.
- Verification method: cross-surface architecture and acceptance analysis; not yet implemented at ledger freeze.
- Status: likely (implementation recommendation, not observed behavior).
- Confidence: high.
- Contradictions: package verification remains essential, but it no longer has to precede every online proof.
- Implication: make this Phase 1/first implementation slice; follow with package/TUF/loader and real ingestion/grading.
- Actionability: immediate after plan freeze.
- Planning handoff: HIGH evidence tier with pgTAP, API, browser, build, secret, and regression checks.
- Implementation risk: auth/data breadth; mitigate with local Supabase and strict slice boundaries.

## Source Notes

### T0 - Repository and runtime truth

- `README.md`, `HANDOFF.md`, root/app package files, CI, contracts, generator, routing, inventory, GitHub fetcher, source update commands, eval services, local connector, security boundary, and Next.js web routes/components.
- Repository state before planning edits: `main` at `a468324`; only the owner-created hosted plan was untracked.
- Local environment: Node 24.18.0, npm 11.18.0, Supabase CLI 2.109.0, Vercel CLI 54.20.1, working Docker daemon.
- No local Supabase config/migrations, live SkillMap Supabase project, Vercel SkillMap project, auth callback, hosted API route, or `/skills` route existed at research freeze.
- Authenticated read-only checks found a Supabase organization named `Production` with two unrelated projects and no SkillMap project. Vercel contained unrelated projects and no SkillMap project.

### T1 - Supabase and Next.js

- https://supabase.com/docs/guides/auth/server-side/creating-a-client
- https://supabase.com/docs/guides/auth/social-login/auth-github
- https://supabase.com/docs/guides/auth/redirect-urls
- https://supabase.com/docs/guides/getting-started/api-keys
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/api/securing-your-api
- https://supabase.com/docs/guides/storage/security/access-control
- https://supabase.com/docs/guides/platform/backups
- https://supabase.com/docs/guides/queues
- https://supabase.com/docs/guides/cron
- https://supabase.com/docs/guides/functions/limits
- https://supabase.com/pricing
- https://supabase.com/changelog.md
- Context7 current documentation for `/supabase/ssr`, `/supabase/supabase`, and `/vercel/next.js/v16.2.9`.

### T1 - Skill, distribution, supply-chain, and registry sources

- https://agentskills.io/specification
- https://agentskills.io/client-implementation/adding-skills-support
- https://agentskills.io/skill-creation/evaluating-skills
- https://github.com/openai/skills
- https://github.com/openai/plugins
- https://learn.chatgpt.com/docs/build-plugins
- https://learn.chatgpt.com/docs/submit-plugins
- https://github.com/anthropics/skills
- https://docs.npmjs.com/policies/unpublish/
- https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository
- https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases
- https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks
- https://slsa.dev/spec/v1.2/
- https://github.com/in-toto/attestation/blob/main/spec/v1/statement.md
- https://github.com/theupdateframework/specification/blob/master/tuf-spec.md
- https://docs.sigstore.dev/cosign/verifying/verify/
- https://ossf.github.io/osv-schema/
- https://www.debian.org/doc/debian-policy/ch-relationships.html
- https://www.skills.sh/docs
- https://genai.owasp.org/llmrisk/llm01-prompt-injection/

### T1 - Deployment and cost context

- https://vercel.com/pricing
- https://vercel.com/docs/plans/hobby
- https://vercel.com/docs/git/vercel-for-github
- https://vercel.com/docs/frameworks/full-stack/nextjs

Current price/limit facts are snapshots, not durable architecture guarantees. Recheck before any paid plan, public launch, or production SLO commitment.

## Contradictions And Uncertainty

1. Supabase Queues uses exactly-once wording, but visibility timeouts and redelivery after failed work require idempotent effects. The plan adopts conservative at-least-once semantics.
2. Agent Skills is structurally portable, but host behavior and packaging are not uniform. The plan permits no broad compatibility claim without a host-profile receipt.
3. Supabase Storage can support content-addressed objects but does not itself make privileged writes impossible. The plan calls this application-enforced immutability and requires integrity/backup controls.
4. Free hosting tiers can run an alpha but do not satisfy the plan's public reliability promises. The user-facing service can remain free while infrastructure later becomes paid.
5. No global skill census exists. Coverage must be reported against explicit source adapters and crawl runs.
6. OpenAI's old skills repository remains accessible, but its own README declares it deprecated. It is historical input, not the current integration target.

## Actionable Implications

### Architecture decisions to freeze

- Supabase Auth owns web sessions.
- Supabase Postgres owns hosted registry/account metadata.
- Expose only an explicit API schema; keep jobs, detailed evidence, audit internals, and authorization helpers private.
- Supabase Storage is the initial artifact/evidence store with server-only writes, digest paths, no upserts, integrity sweeps, and independent backup.
- Supabase Queues/Cron coordinate work; a separate constrained Node worker performs heavy ingestion, scanning, and grading.
- Vercel is the preferred Next.js delivery target, but plan/team/cost suitability must be confirmed before deployment. Do not assume Hobby is valid for a professional product.
- GitHub OAuth is the launch sign-in method. Email auth is deferred until custom SMTP and abuse controls exist.
- The public launch is free to users. Stripe is named only in a future decision record and no launch code or data model depends on it.

### First implementation slice

- Add hosted public contracts and explicit hosted ID domains.
- Add local Supabase config, migration, deterministic first-party seed, generated types, linting, and pgTAP/RLS tests.
- Add public catalog repository/API, server-rendered `/skills` and `/skills/[publisher]/[slug]` routes.
- Add GitHub OAuth SSR plumbing, account route, save/unsave action, and user-isolated saved-skills route.
- Keep grades truthful as `ungraded`/`provisional`; do not seed a letter grade without a real receipt.
- Keep `/dashboard` as the clearly distinct local fixture/snapshot product.
- Validate against a real local Supabase instance; use no silent fixture fallback for the hosted routes.
- Do not deploy until a SkillMap Supabase project, target organization/region, canonical domain, Vercel plan/team, OAuth app, redirects, and cost are explicitly approved/configured.

### Later mandatory slices

- Strict importer, source/bundle model, per-file license evidence, and exact source/raw/normalized digests.
- TUF profile, artifact signing/attestation, local cache, lockfile, `load_skill`, and `load_reference`.
- Queued ingestion, exact-commit reconciliation, audit/advisory/revocation state machines, and source coverage report.
- Codex host profile, baseline/held-out per-skill grading, relationship graph, deterministic portfolio/route-plan receipts, and stale/invalidation graph.
- Publisher/operator workflows and one lightweight SkillMap Codex plugin.
- Full declared-source corpus curation, security/license review, backup/restore, usability, accessibility, and production launch gates.

## What Not To Use

- Do not use the deprecated `openai/skills` repository as the current Codex distribution contract.
- Do not use a public GitHub repository as proof of redistribution rights.
- Do not use local `sk_...` IDs as hosted identity.
- Do not use `getSession()` as server authorization.
- Do not use `user_metadata` for authorization.
- Do not expose secret/service-role keys to the web client.
- Do not treat `TO authenticated` without ownership predicates as authorization.
- Do not run repository cloning, scanning, or grading in web requests or CPU-limited Edge Functions.
- Do not treat Storage paths or mutable Git refs as integrity authority.
- Do not rely on webhook delivery without reconciliation.
- Do not display seeded or estimated grades as current receipts.
- Do not combine popularity, publisher identity, provenance, audit, compatibility, and grade into one “verified/safe” state.
- Do not claim literal global catalog completeness.
- Do not add Stripe packages, tables, webhooks, entitlements, or UI in launch work.

## Planning Handoff

The implementation plan must be revised before code changes to:

1. Update its repository metadata, worker/goal state, research sources, and current OpenAI plugin reference.
2. Record the owner-approved Supabase/free-launch/Stripe-deferred decisions as controlling constraints.
3. Define “all skills” as declared-source coverage and add catalog-source/crawl/failure metrics.
4. Move Supabase Auth/data/RLS and online catalog proof into the first implementation phase.
5. Define local/hosted ID domains and human alias versus immutable machine identity.
6. Add Supabase schema boundaries, RLS rules, key/env boundaries, OAuth path, local/CI migration workflow, and Free-versus-public-release gates.
7. Correct Storage immutability and Edge/worker assumptions.
8. Add distribution bundles, raw/normalized digests, per-file license evidence, lifecycle behavior, TUF, in-toto-shaped receipts, OSV-inspired advisories, typed version-scoped relationships, and route receipts.
9. Replace the file-backed first slice with the Supabase catalog/account spine.
10. Keep deployment as a separately confirmed operational action, not something inferred from local validation.

## Verification Gaps

- No SkillMap Supabase project exists, so remote migrations, hosted RLS, backups, logs, and live Auth are not verified.
- No GitHub OAuth app/provider or callback URLs are configured for SkillMap.
- No SkillMap Vercel project, canonical domain, plan/team decision, or deployed route exists.
- Current Supabase/Vercel plan prices and limits must be rechecked at provisioning/public-launch time.
- Legal counsel has not approved a redistribution policy or any third-party corpus.
- The current OpenAI plugin submission workflow was documented but not exercised.
- TUF/signing keys, worker provider, and independent security reviewer remain later gated decisions.
- No external publisher or new-user usability test has run.

## Research Receipts

- Research anchor: current SkillMap repo, hosted free-to-users launch, Supabase, Codex-first profile, 2026-07-11 platform state.
- Source receipt: T0 repository/runtime, T1 official specs/docs/changelogs/repos, T2 read-only account/CLI checks. No weak source was used as implementation authority.
- Claim receipt: 18 confirmed, 1 likely, 2 disputed, 2 false assumptions, 1 stale plan reference, 1 unverifiable completeness claim.
- Verification receipt: repository and toolchain inspected; Supabase/Vercel account surfaces checked read-only; Context7 and current official documentation/changelog queried; no production mutation performed.
- Dossier: `docs/research/2026-07-11-skillmap-hosted-library-verified-research.md`.
- Next action: revise/freeze the implementation plan, then implement and locally validate the Supabase-backed first slice.
