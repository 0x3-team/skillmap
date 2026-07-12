# SkillMap Hosted Skill Library Launch Implementation Plan

## Planner Metadata

- Repository: `0x3-team/skillmap`
- Canonical remote: `https://github.com/0x3-team/skillmap.git`
- Branch anchored for research and planning: `main`
- Commit anchored: `a468324`, Stabilize route-detail visual diagnostics (#4)
- Date: 2026-07-11
- Controller skill: research-plan-implementation-loop
- Research skill: verified-research
- Planning skill: planning-orchestrator
- Implementation skill: implementation-orchestrator
- Acceptance skill: engineering-acceptance-review
- Planning mode: research-backed parent-owned comprehensive revision
- Plan artifact: `docs/plans/2026-07-11-skillmap-hosted-skill-library-launch-implementation-plan.md`
- Verified research dossier: `docs/research/2026-07-11-skillmap-hosted-library-verified-research.md`
- Implementation status: Phase 1 Supabase-backed online vertical slice implemented, reviewed, merged, and accepted locally at its final product anchor; production provisioning and deployment are not yet authorized
- Phase 1 hosted-foundation merge: PR #7, `295dffe031d3010bb241ade75e9f249c97cd6063`
- Phase 1 final accepted product anchor: PR #9, `f9ea0fa0d9711b5b0a61d24555ed9102fff20eb3`
- Worktree before revision: synchronized with `origin/main`; this owner-created plan was the only untracked file
- Worker count: 3 read-only research/planning workers
- Worker scopes: Supabase/current-platform research, registry/trust/supply-chain research, and repository gap/first-slice analysis
- Goal ledger: goal `019f5141-225c-74c1-9200-83fcc3a52579`; its append-only implementation ledger lives beside this plan and ends with the accepted, merged, explicitly undeployed Phase 1 product receipt
- Primary repository sources inspected:
  - README.md
  - package.json
  - docs/plans/2026-07-09-skillmap-product-application-implementation-plan.md
  - src/commands
  - src/contracts
  - src/core
  - src/schemas
  - src/server
  - src/services
  - apps/web/app
  - apps/web/components
  - apps/web/lib
- External standards and product references:
  - OpenAI, Build plugins: https://learn.chatgpt.com/docs/build-plugins
  - OpenAI, Submit plugins: https://learn.chatgpt.com/docs/submit-plugins
  - OpenAI current plugin examples: https://github.com/openai/plugins
  - OpenAI deprecated skills catalog, historical only: https://github.com/openai/skills
  - Agent Skills specification: https://agentskills.io/specification
  - Agent Skills evaluation guidance: https://agentskills.io/skill-creation/evaluating-skills
  - Anthropic public skills catalog: https://github.com/anthropics/skills
  - Vercel Labs skills installer: https://github.com/vercel-labs/skills
  - Skills directory and leaderboard: https://www.skills.sh/
  - Supabase SSR Auth, RLS, Storage, Queues, Cron, Edge limits, pricing, and changelog: https://supabase.com/docs and https://supabase.com/changelog.md
  - Next.js 16 documentation: https://nextjs.org/docs
  - SLSA v1.2, in-toto Statement v1, TUF, Sigstore, SPDX, and OSV specifications
- Revisit triggers:
  - implementation begins on a different branch or architecture
  - OpenAI or Anthropic changes its skill package contract
  - legal advice changes the redistribution model
  - launch corpus target or monetization boundary changes materially
  - a security review rejects remote package loading
  - Supabase, Vercel, OpenAI plugin, or Agent Skills contracts change materially
  - a public deployment requires paid infrastructure or creates a new recurring cost

## Plan Authority

This file is the source of truth for the hosted SkillMap library launch.

The earlier product-application plan remains authoritative for the completed local application foundation and useful historical decisions. Where the two plans differ, this plan controls the hosted library, public website, public skill pages, package loading, evidence-backed grading, publisher workflows, and future commercial control plane.

The owner has authorized implementation from this plan, beginning with the bounded Supabase-backed online catalog and account spine defined below. This authorization does not include production project creation, production migrations, deployment, paid infrastructure, billing activation, repository visibility changes, bulk ingestion of third-party bodies, or execution of untrusted skill scripts.

## Owner-Approved Launch Constraints

These decisions are closed for the launch plan:

1. Supabase Auth owns user sessions and Supabase Postgres owns hosted application data.
2. Supabase Storage is the initial artifact and evidence store, with application-enforced content immutability, independent integrity checks, and separate Storage backups.
3. Supabase Queues and Cron coordinate asynchronous work. CPU-heavy ingestion, security analysis, browser evaluation, and grading run in a separate constrained Node worker, never in a web request or as a long Edge Function.
4. GitHub OAuth through Supabase is the primary launch sign-in. Public catalog reading requires no account.
5. The service is free to every user at launch. There is no billing, checkout, subscription, entitlement, metering, price, or paywall implementation.
6. If billing is approved later, Stripe is the selected provider, but it belongs to a separate future plan and approval gate.
7. “All skills” means all discovered records in the explicitly declared source universe, with current adapter coverage, crawl failures, eligibility, metadata-only, quarantine, and freshness counts. It does not mean an unverifiable census of the internet.
8. A 150-to-300-version corpus is the first completely evidenced public-launch milestone, not the permanent catalog ceiling.
9. The current local CLI, loopback connector, dashboard, local `sk_...` identity, prompt privacy, and deterministic routing remain valid products and are not replaced by Supabase sessions.
10. Production remains a distinct gate. Free-tier infrastructure is acceptable for local development and private alpha only; it does not by itself satisfy the public SLO, backup, and non-pausing requirements in this plan.

## Executive Decision

Launch SkillMap as a trustworthy, searchable, hosted library of agent skills, not as a naked GitHub repository and not merely as another install-count directory.

The launch product has three connected parts:

1. An open-source local runtime that searches, routes, verifies, downloads, caches, pins, and progressively loads selected skills.
2. A public hosted registry and website that gives every skill a permanent, evidence-rich page with provenance, versions, compatibility, freshness, security information, and a reproducible grade.
3. A hosted trust and maintenance system that continually discovers changes, re-runs checks, invalidates stale grades, and lets publishers submit and maintain skills.

The online catalog is built first as a narrow, truthful spine, then expanded through package integrity, ingestion, grading, updates, routing, publisher operations, and declared-source coverage. No phase may label an unimplemented trust system as live.

The product edge is not secrecy around the client. The durable edge is the maintained corpus, capability relationships, host-specific behavioral evaluations, grading evidence, update graph, verified publishers, routing feedback, operational reliability, and a first-class connection workflow.

The open-source core should be genuinely useful. Future paid value should come from private libraries, organization policy, private grading, team controls, hosted evaluation capacity, alerts, compliance, and support rather than making public skill safety or basic use artificially difficult.

## Product Promise

For a user:

> Find the right skill, understand why it is trustworthy, connect SkillMap to an agent, and load only the instructions needed for the current task.

For a skill publisher:

> Publish once from a source-controlled skill, prove compatibility and quality, receive actionable grading evidence, and keep users informed when the skill changes.

For a team:

> Govern which skills agents may use, pin approved versions, keep prompts private by default, and audit what was selected without copying the entire skill universe into every model context.

## Source Of Truth Contract

### Intent

Make the hosted registry the discovery, trust, version, and update authority while keeping prompt routing and progressive loading local by default.

### Truth owners

- Skill source content: the exact publisher repository and commit recorded for a skill version.
- Published artifact bytes: digest-addressed Supabase Storage objects with server-only no-upsert writes, integrity sweeps, separate backup, and TUF/attestation verification. Immutability is an enforced application contract, not a provider WORM claim.
- Skill identity: SkillMap registry record plus immutable version ID and digest.
- Package format: the open SkillMap package and manifest specification in the repository.
- Capability metadata: publisher-declared data plus SkillMap-reviewed and evaluation-derived annotations.
- Grade: a signed grade receipt bound to one skill version, host profile, rubric version, evaluation suite digest, and documentation snapshot.
- Freshness: source watcher observations and the most recent completed validation run.
- Security state: scan findings, human dispositions, revocations, and signed advisories.
- Local policy: the user-owned SkillMap workspace and lockfile.
- Route decision: the local deterministic router operating on a verified compact index.
- Raw user prompt: local ephemeral input unless the user explicitly opts into a hosted playground or feedback submission.
- Public website: a projection of registry data, never an independent editing surface for immutable package facts.

### Pre-implementation baseline (historical)

This subsection records the repository state before the authorized Phase 1 slice. The Phase 1 implementation receipt near the end of this plan supersedes it for current local behavior; neither section is evidence of a remote deployment.

- SkillMap is a local-first CLI and local product with scan, doctor, policy, graph, route, eval, source, hook, MCP, and dashboard capabilities.
- Routing is deterministic and does not require an LLM.
- The existing MCP surface can route and inspect redacted metadata.
- The existing show_skill behavior does not deliver a verified skill body or reference file.
- The public Next.js surface was a polished product and fixture experience, not yet a hosted registry, publisher system, or searchable skill library.
- There was no hosted database, artifact store, ingestion worker, grading service, publisher account model, public skill URL, or package CDN in the repository at that baseline.
- Route currently ranks a prompt as one unit. It does not produce an ordered multi-segment execution plan for long prompts.

### Expected outcome

- Any number of skills can be available in the registry without all skill bodies entering model context.
- The local runtime receives a signed, compact metadata index.
- The router selects the smallest adequate portfolio of skills.
- The loader fetches and verifies only the selected SKILL.md and only the referenced supporting files needed at that moment.
- Every public skill page exposes its source, immutable versions, license, publisher, compatibility, grade evidence, freshness, permissions, and known risks.
- Long prompts can become an ordered route plan with source spans, dependencies, roles, and load timing while preserving the original prompt.
- Updates create new immutable versions; old versions remain addressable and pins remain reproducible.
- A grade becomes stale or invalid automatically when its skill, rubric, test suite, host profile, or relevant host documentation changes.
- The public website, CLI, MCP tools, and future SDK use the same versioned registry contracts.

### Displaced paths

- One MCP tool per skill is forbidden; a stable small tool surface must load arbitrary skills.
- Exposing every installed skill to an agent host is not the primary connection architecture.
- Popularity, stars, or install count cannot masquerade as quality.
- A single opaque score cannot replace dimension evidence.
- Skill names alone cannot identify packages or policy.
- Existing published versions cannot be overwritten in place.
- Unclear-license skill bodies cannot be mirrored merely because a GitHub repository is public.
- Raw prompts cannot be uploaded by default just to choose a skill.
- Scripts bundled in a skill cannot execute during install, scan, route, or load.
- UI labels such as verified, safe, compatible, current, and live must be backed by explicit evidence states.

### Cutover

Public launch occurs only when:

- the local loader and signed registry index work end to end
- the first curated corpus has known provenance and licenses
- every version exposed in public results has a reproducible current grade receipt; ungraded or unverifiable candidates are quarantined and excluded from public results
- public search, skill detail, compare, connect, trust, and documentation flows are production-ready
- publisher submission and update paths have operational owners
- revocation, takedown, rollback, backup, and incident procedures have been exercised
- a new Codex user can connect and load a selected skill in under five minutes

### Evidence lane

- Machine-readable contracts and fixtures in the repository
- CI artifacts for schema, package, API, route, loader, security, browser, and accessibility checks
- Signed registry manifests and grade receipts
- Public evidence summaries on skill pages
- Private detailed scan evidence for authorized reviewers
- Launch gate report under docs/releases or a dedicated release artifact directory

### Kill criteria

Stop launch if any of these remain true:

- a listed skill has unknown redistribution rights but its body is mirrored
- a skill page presents an unbound or stale grade as current
- package digest verification can be bypassed
- a revoked version can still be newly installed without a blocking warning
- a long prompt silently drops one requested workstream
- routing regularly picks redundant or wrong-platform skills
- local prompts are uploaded without explicit informed consent
- a skill package can traverse paths, expand without limits, or execute scripts during ingestion or loading
- the website says compatible based only on frontmatter rather than a defined compatibility evidence level
- public launch depends on an operator manually editing production rows
- the open-source repository cannot reproduce the package and grade contract used by the hosted service

### Forbidden moves

- No blind mirroring of every GitHub repository containing SKILL.md.
- No use of private user skills for public training, grading examples, or corpus seeding without explicit authorization.
- No hidden remote LLM call in the local routing path.
- No automatic execution of skill scripts.
- No mutable version tags as the sole installation identity.
- No paywall around license, security, provenance, or basic grade disclosures.
- No public claim that a grade certifies safety.
- No production secrets in repository fixtures, screenshots, logs, or grade evidence.
- No billing activation before a separately approved commercial launch gate.
- No Stripe SDK, schema, webhook, checkout, price, subscription, entitlement, metering, or billing UI in launch code.
- No server authorization from `getSession()` or user-editable `user_metadata`.
- No exposed Supabase table without explicit grants, enabled RLS, ownership predicates, indexes, and database-level policy tests.
- No secret/service-role key in browser code or a public build artifact.
- No silent fixture fallback on hosted catalog or account routes; missing Supabase configuration must fail visibly.
- No fabricated seeded letter grade, “verified,” “safe,” “compatible,” or “current” state without its bound evidence receipt.
- No CPU-heavy repository fetch, scan, or grading job inside the Next.js request path or a resource-limited Edge Function.

## Native Planning Superiority

A generic directory plan would likely stop at search, categories, GitHub import, accounts, and an install button. That would not solve the product's hardest problems:

- choosing among overlapping skills
- preserving chronological intent in long prompts
- keeping a large library out of the model context
- distinguishing evidence-backed quality from popularity
- invalidating grades when a host or source changes
- safely redistributing third-party content
- giving users reproducible, pinned packages

This plan treats identity, content addressing, progressive disclosure, host profiles, relationship-aware routing, grading receipts, licensing, and update operations as first-class product contracts. Its target superiority score is 5 out of 5: an implementation team should be able to execute without inventing the core system during coding.

## Orchestration Decision

- Mode: research-plan-implement controller with parent-owned plan integration
- Worker count: 3 read-only workers for the research/planning gate; implementation uses at least one independent auth/data or browser verifier because the selected slice is HIGH risk
- Reason: Supabase/auth/data, registry trust/supply chain, and repo-to-slice analysis were independent evidence surfaces; the parent froze and integrated the claim ledger and plan
- Planning surfaces synthesized:
  - public library and website
  - registry and package distribution
  - deterministic single- and multi-skill routing
  - progressive skill loading
  - grading and freshness
  - publisher trust, security, and legal operations
  - open-source packaging and explicitly deferred Stripe/private-team boundary
- Reconsider concurrency when:
  - implementation spans contracts, database/RLS, Auth, API, and UI
  - a threat model or external penetration test starts
  - the grading rubric needs independent reviewers
  - license review requires counsel
  - launch browser testing spans multiple devices and hosts

## Background Browser Lane

No persistent background-browser task was required to revise this plan. Current official documentation, authenticated read-only provider surfaces, and repository/runtime truth supplied the evidence. Browser-based catalog, responsive, accessibility, missing-config, account, and authenticated testing begins in Phase 1; external publisher, plugin, install, and launch browser testing expands in Phases 5 through 7.

## Research Findings That Control the Plan

### OpenAI skill behavior

The historical `openai/skills` catalog is deprecated. Current Codex examples and distribution use OpenAI plugins, which may contain skills, MCP apps, or both. SkillMap's launch connection target is therefore one lightweight plugin over the stable search/route/load surface, not one tool or plugin per catalog entry.

Current OpenAI guidance uses progressive disclosure:

- the agent initially receives skill name, description, and path
- full SKILL.md is read when the skill is selected
- supporting files should be loaded only when needed
- descriptions must state scope and triggering boundaries clearly
- a skill should be focused and testable

OpenAI also limits the initial displayed skill list when catalogs become large. Therefore SkillMap must not assume that adding a broad local skill directory always saves context. The meaningful saving appears only when SkillMap becomes the access layer: compact registry metadata first, exact selected content later.

### Agent Skills compatibility

The common package core is a directory containing SKILL.md, with optional scripts, references, and assets. Useful frontmatter includes name, description, license, compatibility, metadata, and allowed tools.

SkillMap should preserve this portable core. Host-specific policy belongs in additive profiles and evidence, not destructive rewrites of a publisher source.

### Existing directory gap

Existing public catalogs already provide search, install commands, topics, official labels, popularity, and public source browsing. SkillMap will not win merely by listing more repositories.

SkillMap differentiation must be:

- reproducible evidence-backed grading
- explicit host compatibility
- provenance and license status
- immutable packages and verified digests
- behavioral positive, negative, near-miss, and overlap evaluations
- alternative, complement, prerequisite, conflict, and supersession relationships
- minimal portfolio selection
- chronological route plans for multi-part prompts
- local prompt privacy
- continuous update and regrade operations

## Product Strategy

### Launch wedge

The launch wedge is the public, graded skill library with a trustworthy connect-and-use experience for Codex.

The sequence matters:

1. A developer discovers a skill through search or a direct skill page.
2. The page explains what it does, when it should and should not trigger, what it can access, whether it is current, and how it scored.
3. The developer connects the small SkillMap runtime to Codex.
4. SkillMap keeps a compact TUF-verified index locally.
5. For each prompt, SkillMap selects the minimal appropriate skill portfolio without an LLM.
6. Codex loads the chosen skill body and references progressively.
7. SkillMap can explain the choice and preserve a version pin.

### Defensible edge

The defendable asset is a maintained trust graph, not a hidden installer.

Compounding assets:

- curated and normalized skill corpus
- verified publisher identities
- immutable version history
- capability taxonomy
- skill relationship graph
- confusion and near-miss datasets
- host-version compatibility history
- reproducible grade receipts
- freshness and source monitoring
- anonymized, opt-in routing feedback
- team policy and private corpus controls
- operational trust from reliable revocation and takedown handling

### Open-source boundary

Open-source:

- package and manifest specification
- local index verifier
- deterministic router
- route-plan contract
- loader, cache, and lockfile
- CLI and MCP connector
- validation CLI
- core rubric schema and public grade verifier
- public API client
- local workspace and policy engine
- test fixtures and reference packages

Hosted:

- continuously maintained public registry
- large-scale source discovery and update monitoring
- grading and security worker fleet
- publisher verification
- hosted search and CDN
- evidence retention and transparency log
- private organization registries
- team policy, RBAC, SSO, audit, and compliance
- private grading and evaluation capacity
- alerts and support

The hosted service must never rely on an incompatible private package contract. Users should be able to verify artifacts and grade receipts with the open-source client.

### Future commercial boundary, outside this launch

Public library access, public safety information, basic grades, standard package loading, accounts, saved skills, and public publisher submissions remain free.

Candidate paid capabilities:

- private skill libraries
- private repository ingestion
- organization collections and approved stacks
- organization policy and version enforcement
- SSO, SCIM, RBAC, and audit export
- hosted private evaluations
- custom rubrics and host profiles
- freshness alerts and upgrade workflows
- advanced publisher analytics
- regional storage and retention controls
- higher API and evaluation capacity
- support, uptime commitments, and compliance packages

Do not build or stub billing in the launch critical path. Preserve clean domain seams around users, publishers, and future private organizations, but do not create entitlement, subscription, price, checkout, webhook, or metering tables until a separate Stripe plan is approved. The public catalog and local runtime must not depend on future billing state.

## Target Users and Jobs

### Primary launch user: agent-heavy developer

Needs to:

- find a skill for a concrete task
- distinguish near-duplicates
- know whether the skill works with Codex
- understand risks and permissions
- connect it without manually copying large instructions
- keep updates controlled and reproducible

Success:

- first verified skill load in less than five minutes
- correct skill or portfolio selected for a representative prompt
- no entire-catalog context dump

### Skill publisher

Needs to:

- claim or create a publisher profile
- submit a repository and exact path
- understand validation failures
- prove ownership
- publish immutable versions
- improve a grade from concrete evidence
- communicate deprecations and replacements

Success:

- accepted submission without operator database intervention
- grade receipt and public page produced predictably
- updates are detected and regraded

### Skill reviewer or registry operator

Needs to:

- triage license, security, quality, and duplication findings
- compare evidence
- approve, quarantine, revoke, or reject
- handle publisher claims and takedowns
- inspect job history

Success:

- every consequential action has an audit receipt
- queues, failures, and stale evidence are visible
- no direct production-row editing is necessary

### Team administrator, post-launch

Needs to:

- define allowed sources and grades
- approve versions
- create stacks
- set host and permission constraints
- monitor usage without collecting raw prompts

Success:

- local routing remains useful through cloud outages
- policies are signed, versioned, reviewable, and reversible

## Product Principles

1. Available is not the same as in context.
2. Local routing and prompt privacy are defaults.
3. Load the minimum adequate portfolio, not the largest top-N set.
4. Evidence is stronger than labels.
5. Grades are reproducible receipts, not opinions.
6. Versions are immutable.
7. Host compatibility is versioned and host-specific.
8. Popularity is a separate signal from quality.
9. Untrusted text and scripts are supply-chain inputs.
10. Every block, warning, stale state, and downgrade must be understandable.
11. The public website is a working product surface before it is a marketing surface.
12. Open-source contracts stay sufficient to verify the hosted service.

## Explicit Non-Goals for Initial Launch

- No general-purpose agent marketplace with payment to publishers.
- No arbitrary execution environment for bundled scripts.
- No automatic modification of an agent global skill directories.
- No guarantee that SkillMap grading proves a skill is safe in every environment.
- No Claude-first optimization; Claude receives a later host profile after Codex launch.
- No collection of raw private prompts for ranking.
- No opaque recommendation model in the critical routing path.
- No social feed, comments, or follower system.
- No unbounded attempt to mirror every skill on the internet before launch.
- No enterprise compliance certification in the public launch phase.
- No promise of a literal global census of every skill on the internet.
- No email/password launch flow until production SMTP, abuse controls, templates, and recovery are approved; GitHub OAuth is the initial account path.

## Launch Scope

### Must launch

- Public searchable directory
- Public declared-source coverage report with discovered, parsed, eligible, metadata-only, quarantined, failed, and stale counts
- Permanent public skill pages
- Skill versions and immutable package artifacts
- Public grade breakdown and evidence summaries
- Codex compatibility profile
- License and provenance state
- Publisher identity and source links
- Connect and install documentation
- Open-source local registry client
- Signed compact index
- Deterministic route and route plan
- Progressive load_skill and load_reference tools
- Local cache and lockfile
- Compare flow for overlapping skills
- Publisher submission and update flow
- Free GitHub-authenticated accounts, saved skills, and account-owned preferences
- Operator review console
- Source monitoring and automatic regrade invalidation
- Security scanning and revocation
- Trust, grading, security, privacy, and legal pages
- Comprehensive repository documentation and examples

### Should launch if phase gates stay green

- Curated collections or stacks
- Hosted prompt playground with clear privacy controls
- Saved skills for signed-in users
- Publisher analytics for page views and connects
- Public API keys with modest rate limits
- Embeddable grade badge backed by a versioned endpoint

### Defer

- All billing and Stripe integration
- Private organization registries
- SSO and SCIM
- Claude host profile
- Publisher revenue sharing
- Arbitrary custom grading models
- Large-scale semantic vector routing in the local critical path
- Public comments and ratings

## Launch Corpus Strategy

The north star is coverage of all portable skills discoverable through the declared source universe. Because no authoritative global census exists, SkillMap must publish exactly which source adapters ran, when each last succeeded, which sources failed, and how records moved through discovered, parsed, eligible, metadata-only, quarantined, and published states. The launch corpus must be curated, legally eligible, and completely evidenced.

Initial fully evidenced launch milestone:

- 150 to 300 public skill versions
- all first-party SkillMap skills that meet the same rubric
- representative official and high-value open-source skills
- broad enough coverage to exercise overlap, complement, prerequisite, and conflict handling
- 100 percent known source commit, digest, license state, host profile, and grade receipt

Corpus rules:

- Known redistributable license: artifact may be mirrored with attribution.
- Public source but unclear redistribution: metadata and source link only until permission is resolved.
- Private or local source: never published unless the owner explicitly submits it.
- Duplicate forks: retain provenance, but group them and avoid search-result spam.
- Abandoned or stale source: may remain visible with a clear stale state if its license permits and no critical security issue exists.
- Revoked malicious version: retain a transparency record but block new loads.

The operator must approve each declared source adapter and the first milestone before ingestion capacity planning. The 150-to-300 target is not a cap: after launch, “complete” means every record discovered in the declared source universe has a current disposition and coverage receipt. Quality, legal eligibility, and evidence completeness outrank a large headline count.

Every catalog crawl must publish:

- source adapter and version
- source universe boundary and immutable source locator where possible
- started, completed, and last-success timestamps
- discovered, parsed, duplicate, eligible, metadata-only, quarantined, published, and failed counts
- failure codes and retry state
- freshness target and current lag
- importer version and Agent Skills specification snapshot digest

The website may say “all indexed skills” only when the coverage report is linked. It may never claim literal global exhaustiveness.

The canonical receipt shape, reconciliation equations, crawl-record transitions, and public completeness gate are defined by `docs/specs/source-coverage-receipt-v1.md`. Aggregate UI counts must be computed from receipts that bind the same declared-universe digest, never from unrelated live table counts.

## Information Architecture

### Public navigation

- Explore
- Collections
- Compare
- Route playground
- Publishers
- Docs
- Trust
- GitHub
- Sign in
- Connect SkillMap

### Authenticated publisher navigation

- Publisher dashboard
- Skills
- Submissions
- Grades
- Updates
- Analytics
- Organization settings

### Registry operator navigation

- Review queues
- Ingestion jobs
- Security findings
- License and provenance
- Grade runs
- Source drift
- Publisher claims
- Takedowns
- Revocations
- System health
- Audit log

### URL model

- /
- /skills
- /skills/[publisher]/[slug]
- /skills/[publisher]/[slug]/versions/[version]
- /compare?skills=id1,id2
- /collections
- /collections/[slug]
- /publishers/[handle]
- /playground
- /connect/codex
- /docs
- /docs/cli
- /docs/mcp
- /docs/package-format
- /docs/api
- /trust
- /trust/grading
- /trust/security
- /trust/licenses
- /changelog
- /status
- /account
- /publisher
- /admin

Canonical skill URLs use stable publisher and slug handles, while every response also includes immutable skill and version IDs. Renames require redirects and audit history.

## UI Plan

### 1. Search-first landing page

Purpose: let a first-time visitor do useful work immediately.

Required:

- prominent library search accepting jobs, tools, frameworks, hosts, and skill names
- real indexed results, not a decorative search field
- concise product promise about graded skills and progressive loading
- visible Codex connection CTA
- trust summary explaining grades, versions, and source verification
- featured collections based on editorial value, not paid placement
- recent verified updates
- direct path to grading methodology and open-source repository
- truthful corpus count derived from published records

Avoid:

- a generic oversized hero
- fabricated activity statistics
- decorative card sprawl
- implying that popularity equals quality
- present-tense claims for deferred team features

### 2. Explore directory

Required search behaviors:

- keyword and capability search
- URL-addressable query and filters
- typo tolerance and synonyms
- deterministic sorting choices
- result grouping for duplicate and fork families
- keyboard navigation
- fast empty, loading, error, offline, and rate-limited states

Filters:

- host compatibility
- domain
- platform
- framework
- intent
- workflow phase
- grade
- grade confidence
- freshness
- publisher verification
- license
- script presence
- network and tool permissions
- first-party, official, community, or fork

Sort:

- relevance
- grade
- recently updated
- recently graded
- popularity, clearly labeled
- name

Each result shows:

- name, publisher, and one-sentence scope
- current grade and evidence status
- Codex compatibility
- last source update and last grade date
- license
- permissions or script warning
- primary capabilities
- relationship badge when grouped as an alternative or fork

### 3. Skill detail page

Above the fold:

- skill name and publisher
- concise job statement
- current version and digest prefix
- grade letter and confidence
- host compatibility
- license and source
- Connect or use CTA
- Add to comparison
- Save or add to collection

Grade section:

- dimension scores
- hard gate status
- evidence type and sample size
- positive, negative, near-miss, and overlap results
- rubric version
- host profile version
- evaluation suite digest
- last graded time
- reason for stale or provisional status
- link to machine-readable grade receipt

Use section:

- when it should trigger
- when it should not trigger
- positive prompt examples
- negative and near-miss examples
- expected inputs and outputs
- host-specific install or connect command
- direct load command for pinned version

Content section:

- rendered SKILL.md preview
- table of referenced files
- explicit progressive-disclosure boundary
- no automatic display or execution of arbitrary active content
- downloadable immutable package when redistribution is allowed

Trust section:

- publisher verification level
- source repository and exact commit
- license status and attribution
- package digest and signature
- permissions and allowed tools
- bundled scripts with language and scan state
- security findings and dispositions
- revocation and deprecation status

Relationship section:

- alternatives
- complements
- prerequisites
- conflicts
- supersedes and superseded-by
- forks and duplicates

History:

- versions
- source changes
- grade history
- compatibility history
- changelog
- deprecation and migration guidance

### 4. Skill comparison

Purpose: solve the fifteen-frontend-skills problem directly.

Required comparison rows:

- primary job and boundaries
- host, platform, and framework fit
- intended phase
- grade dimensions
- trigger precision and recall
- near-miss rejection
- permissions and scripts
- context size
- freshness
- license
- publisher trust
- alternatives, complements, and conflicts

The page must explain:

- which skill is the best primary choice for the supplied constraints
- which candidates are true alternatives
- which are useful supporting skills
- which are redundant or incompatible
- what information is missing if no safe choice can be made

Recommendations must cite structured constraints and evidence, not only a blended score.

### 5. Route playground

Modes:

- local mode: user follows a command and routing occurs on their machine
- hosted demonstration: explicit opt-in, clear retention policy, no authentication secrets

Output:

- preserved original prompt
- detected segments in original order
- selected primary, supporting, guardrail, prerequisite, and final-review skills
- skill versions
- selection reasons
- rejected close alternatives
- load order
- dependency graph
- estimated metadata and loaded-content context cost
- ambiguity or clarification warning

The playground must never imply that displayed skills have already executed.

### 6. Connect Codex flow

Goal: first verified connection in less than five minutes.

Steps:

1. Detect or ask for OS and Codex environment.
2. Show one copyable install command.
3. Initialize a local SkillMap workspace.
4. Add the stable SkillMap MCP connector or documented equivalent.
5. Verify connector health.
6. Download and verify the TUF-protected compact index.
7. Run a sample route.
8. Load a pinned sample skill.
9. Show success and how to inspect, update, or disconnect.

Requirements:

- exact commands and expected output
- copy buttons with accessible confirmation
- error-specific recovery
- no request to delete existing local skills
- optional migration that disables duplicate auto-discovery only after the loader works
- clear uninstall and rollback
- version compatibility check
- offline and last-known-good explanation

### 7. Collections and stacks

A collection is editorial grouping.

A stack is an ordered, compatible portfolio with roles and optional policy.

Required:

- curator identity
- component versions or version ranges
- intended workflow
- role for each skill
- compatibility and conflicts
- aggregate context cost
- install or pin action
- change history

Paid placement must never influence a grade. Sponsored discovery, if ever added, must be explicitly labeled and excluded from organic ranking.

### 8. Publisher page and submission UI

Publisher page:

- verification level
- source domains and repositories
- published skills
- average freshness, not an average quality score
- security or revocation history with fair context
- support and disclosure links

Submission workflow:

1. Sign in.
2. Create or claim publisher identity.
3. Prove repository or domain ownership.
4. Submit repository URL, exact skill path, and intended version.
5. Preview detected manifest and license.
6. Confirm redistribution authorization.
7. Run validation.
8. Review hard failures and improvement recommendations.
9. Submit for automated evaluation and, where needed, human review.
10. Publish or receive a reasoned rejection.

The form must preserve progress and make every finding actionable.

### 9. Operator console

This is an operational product, not an afterthought.

Required queues:

- new submissions
- automated validation failures
- ambiguous licenses
- suspected duplicates
- security findings
- low-confidence grade runs
- publisher claims
- stale sources
- host documentation changes
- takedowns
- appeals

Every action requires:

- actor
- reason code
- free-text rationale where consequential
- evidence links
- previous and resulting state
- timestamp
- reversible action where safe

### 10. Trust and methodology pages

Publish:

- what a grade means and does not mean
- rubric versions and change history
- hard gates
- host profiles
- security scanning limitations
- provenance and licensing policy
- publisher verification levels
- data retention and prompt privacy
- vulnerability disclosure
- takedown and appeal process
- service status and incident history

### 11. Repository presentation

The GitHub repository must support the product rather than substitute for it.

Required:

- concise README with the product workflow
- architecture diagram
- local quick start
- hosted registry connection
- progressive loading explanation
- security and privacy model
- package and grade receipt specifications
- screenshots or short verified demo
- examples
- CONTRIBUTING.md
- CODE_OF_CONDUCT.md
- SECURITY.md
- governance and maintainer expectations
- release and compatibility policy
- roadmap
- development setup and test commands
- issue and pull request templates

## UX Quality Requirements

### Evidence vocabulary

Use consistent labels:

- Published: registry entry is public.
- Verified publisher: ownership proof met the stated level.
- Compatible: named host profile tests passed for the named versions.
- Graded: a current grade receipt exists.
- Provisional: evidence is incomplete or sample size is small.
- Stale: a dependency changed after the grade.
- Deprecated: publisher recommends a replacement or no future updates.
- Revoked: new use is blocked because of a critical trust decision.
- Popular: based on disclosed usage signal, not quality.

### State completeness

Every major page must design and test:

- first load
- loading
- populated
- empty
- filtered empty
- validation error
- permission error
- rate limit
- stale data
- partial evidence
- backend unavailable
- offline local mode
- revoked or quarantined skill

### Accessibility and responsiveness

- WCAG 2.2 AA target
- keyboard-complete search, compare, dialogs, and navigation
- visible focus
- semantic headings and tables
- reduced motion
- contrast-safe status colors
- status never conveyed by color alone
- 320px mobile minimum without overlap or horizontal clipping
- desktop density optimized for comparison and evidence
- screen-reader labels for grade charts and relationship graphs

### Performance budgets

Provisional launch budgets, to be validated under real load:

- public cached page LCP under 2.5 seconds at p75
- search API p95 under 250 ms in the primary region
- skill detail API p95 under 300 ms
- cached artifact fetch p95 under 200 ms in the primary region
- local routing p95 under 50 ms with 5,000 compact metadata entries
- local index verification under 500 ms on supported baseline hardware
- search result interaction response under 100 ms after data arrives
- no more than 200 KB compressed JavaScript on search and detail critical routes without an approved exception

### SEO and shareability

- server-rendered public skill pages
- canonical URLs and redirects
- sitemap segmented by skills, publishers, collections, and docs
- structured metadata for software and source where standards allow
- Open Graph images based on real skill facts
- no indexation of private, quarantined, or unclear-license content
- stable public grade badge endpoint with cache rules

## Technical Architecture

### Chosen launch stack

- Web and BFF: the existing Next.js 16 application in `apps/web`, with Vercel as the preferred deploy target after team/plan/cost approval.
- Authentication: Supabase Auth, GitHub OAuth first, cookie-based SSR through `@supabase/ssr` and Next.js `proxy.ts`.
- Registry and account metadata: Supabase Postgres.
- API exposure: an explicit `api` schema only; new tables are not assumed to be exposed. Grants and RLS are reviewed together in migrations.
- Private data plane: a non-exposed `private` schema for job payloads, job attempts, detailed findings/evidence, operator roles, credentials references, outbox state, and internal audit records.
- Artifact/evidence storage: Supabase Storage with separate public-artifact and private-evidence buckets, server-only mutation, digest-addressed object names, no upsert, integrity sweeps, and independent export/backup.
- Queue and scheduler: Supabase Queues and Cron.
- Short orchestration: Supabase Edge Functions only for verified webhooks, enqueue, and bounded I/O tasks.
- Heavy work: a separately deployed Node 24 container/worker consuming job IDs and canonical private payloads. Provider selection is reversible and must be approved before Phase 3 deployment.
- Search: PostgreSQL generated `tsvector`/GIN plus trigram and structured indexes first.
- Billing: none. Stripe is absent from this architecture until a future plan.
- Runtime versions: root local CLI may retain Node 20 compatibility; `apps/web`, hosted services, workers, and hosted CI require Node 22 or newer and target Node 24.

~~~mermaid
flowchart LR
    U["User or Codex"] --> LR["Open-source local runtime"]
    LR --> RI["TUF-protected compact registry index"]
    LR --> DR["Deterministic router and route planner"]
    DR --> LC["Verified loader and local cache"]
    LC --> CDN["Digest-addressed artifact CDN"]
    LR --> LF["Local lockfile and policy"]

    P["Publisher repository"] --> IN["Ingestion pipeline"]
    IN --> VA["Schema, license, security, and provenance validation"]
    VA --> EV["Behavioral evaluation and host profiles"]
    EV --> GR["Grade receipt and relationship graph"]
    GR --> DB["Supabase Postgres"]
    VA --> OS["Supabase Storage with integrity controls"]
    OS --> CDN
    DB --> API["Registry API"]
    API --> WEB["Public website and publisher console"]
    DB --> RI

    SW["Source and host documentation watchers"] --> Q["Supabase Queues"]
    Q --> WK["Constrained Node worker"]
    WK --> IN
    WK --> EV
    WK --> GR

    WEB --> API
    ADM["Operator console"] --> API
~~~

### Deployment boundaries

1. Public web application
   - server-rendered public routes
   - authenticated publisher and operator routes
   - BFF behavior only where useful
   - no ownership of long-running grading jobs
   - Supabase publishable key only; never a secret/service key in browser code
   - request-scoped server client, verified claims, exact redirect allowlist, and auth responses marked private/no-store

2. Registry API, initially Next.js Route Handlers backed by the same repository contracts
   - authoritative read and write contracts
   - authentication, authorization, rate limiting, and idempotency
   - pagination and version negotiation

3. Supabase Postgres metadata store
   - normalized identity, version, evidence, relationship, account, and audit data
   - exposed `api` schema and non-exposed `private` schema
   - explicit grants and RLS on every exposed table or `security_invoker` view
   - fresh relational membership checks for consequential writes
   - user-editable metadata never authorizes access

4. Supabase Storage and CDN
   - application-immutable package blobs addressed by digest
   - manifests
   - public grade receipts
   - public evidence artifacts
   - TUF-protected compact indexes and revocation overlays
   - public reads separated from private evidence signed URLs
   - database backup is not treated as Storage backup

5. Supabase Queues, Cron, bounded Edge orchestration, and external workers
   - repository fetch
   - validation
   - security scans
   - behavioral evaluation
   - grade computation
   - source and host-profile refresh
   - search indexing
   - notification
   - all effects idempotent and replay-safe with attempt limits and DLQ
   - no heavy repository or evaluator workload in a web request or Edge Function

6. Search
   - begin with PostgreSQL full-text and trigram search plus structured filters
   - add a dedicated search service only after measured relevance or scale limits
   - embeddings may support offline classification or discovery, but cannot become the unexplained ranking authority

7. Open-source local runtime
   - deterministic metadata router
   - relationship-aware portfolio selector
   - chronological route planner
   - signature and digest verification
   - progressive file loader
   - bounded local cache
   - version lockfile
   - offline last-known-good behavior

### Suggested repository topology

Evolve deliberately toward:

~~~text
apps/
  web/                 public site, publisher, and operator UI
  registry-api/        extract only after Route Handlers have a second runtime consumer
  worker/              ingestion, grading, and monitoring worker container
packages/
  contracts/           schemas shared across CLI, API, web, and workers
  package-format/      manifest, hashing, signature, and archive rules
  router/              deterministic routing and portfolio selection
  grader/              rubric and grade receipt engine
  registry-client/     API and signed-index client
  ui/                  intentionally shared product UI primitives
src/                   current CLI and runtime, migrated incrementally
docs/
  specs/
  operations/
  plans/
supabase/
  config.toml
  migrations/
  tests/
  seed.sql
~~~

Do not perform a broad monorepo refactor before contracts are extracted. Add packages when two real consumers exist.

## Core Data Model

### Identity and publishing

- `auth.users`, owned by Supabase Auth and never directly exposed
- profiles, private to the owning user
- organizations
- memberships
- publishers
- publisher_members
- publisher_verifications
- domains
- catalog_sources
- catalog_crawl_runs
- source_repositories
- repository_connections
- source_locator_snapshots
- distribution_bundles
- bundle_versions
- bundle_members

### Skill records

- skills
  - immutable ID
  - publisher ID
  - current slug and display name
  - visibility and lifecycle state
- skill_aliases
- skill_identity_transfers
- skill_tombstones
- skill_versions
  - immutable version ID
  - semantic or publisher version
  - source commit
  - source path
  - exact upstream raw-byte/source-snapshot digest
  - normalized SkillMap artifact digest
  - importer version and Agent Skills specification snapshot digest
  - manifest digest
  - content digest
  - publication state
- skill_artifacts
- skill_files
- manifests
- license_evidence
  - publisher-declared license
  - detected license files and digests
  - reviewer-concluded SPDX expression or `NOASSERTION`
  - redistribution decision and evidence
  - metadata-only or body-mirror eligibility
- attributions
- saved_skills

### Capability and relationships

- capability_taxonomy
- capability_aliases
- skill_capabilities
  - domain
  - platform
  - framework
  - intent
  - workflow phase
  - role
  - confidence
  - evidence source
- skill_relationships
  - alternative
  - complement
  - prerequisite
  - conflict
  - duplicate
  - fork
  - supersedes
  - superseded_by
  - source and target version range or capability provider
  - direction, evidence origin, confidence, effective range, and reviewed timestamp
- collections
- collection_versions
- collection_members
- stacks
- stack_versions
- stack_members

### Host compatibility

- hosts
- host_profiles
- host_profile_versions
- host_documentation_snapshots
- skill_host_claims
- compatibility_runs
- compatibility_results

### Grading and evaluation

- rubrics
- rubric_versions
- rubric_rules
- evaluation_suites
- evaluation_suite_versions
- test_cases
- evaluation_runs
- evaluation_case_results
- grade_runs
- grade_dimensions
- grade_evidence
- grade_receipts
- grade_invalidations

### Trust and operations

- security_scans
- security_findings
- finding_dispositions
- source_snapshots
- source_update_checks
- revocations
- deprecations
- advisories
- advisory_aliases
- advisory_affected_versions
- takedown_requests
- appeals
- review_cases
- audit_events
- jobs
- job_attempts
- outbox_events

Only public catalog projections belong in the exposed API schema. Jobs, attempts, detailed findings/evidence, credentials, role helpers, and internal audit payloads belong in the private schema. Public views use `security_invoker = true`.

### Local and future team policy

- registry_index_versions
- package_pins
- policy_bundles
- policy_bundle_versions
- organization_approvals
- feedback_events
- usage_aggregates

Raw prompts do not belong in the default hosted schema. Feedback records should use explicit, minimal, redacted fields unless a user separately consents to attach prompt text.

## Package and Identity Contract

### Canonical identifier

Machine identity uses immutable public IDs:

~~~text
skillmap://publishers/pub_.../skills/skl_.../versions/skv_...#sha256:digest
~~~

The human-facing coordinate `@publisher-handle/skill-slug@1.2.0` is a resolvable alias, not installation authority. The digest is the final byte-integrity authority.

Identity domains are explicit:

- `sk_...`: existing local workspace/path-qualified skill variant. It remains local and is not migrated in the first hosted slice.
- `pub_...`: immutable hosted publisher identity.
- `skl_...`: immutable hosted logical skill identity.
- `skv_...`: immutable hosted published version identity.
- `sha256:...`: exact raw snapshot, manifest, normalized artifact, receipt, or payload integrity authority according to the named field.

Rules:

- IDs, previously used aliases, and semantic-version coordinates are never reused.
- Publisher handles, slugs, and `latest`-style channels are mutable signed pointers only.
- Renames and transfers create redirect/transfer receipts and reserve old aliases permanently.
- Removal creates a lifecycle transition or tombstone, never identity resurrection.
- Every API and UI payload identifies whether it carries a local ID, logical hosted ID, version ID, or digest.

### Manifest minimum

~~~yaml
schema_version: skillmap.package/v1
skill_id: skl_...
version_id: skv_...
publisher: publisher-handle
name: skill-name
display_name: Human Name
version: 1.2.0
source:
  repository: https://github.com/example/repo
  provider_repository_id: immutable-provider-id
  commit: full-commit-sha
  path: skills/example
  raw_snapshot_digest: sha256:...
  importer_version: skillmap-importer/...
  agent_skills_spec_digest: sha256:...
license:
  declared: MIT
  concluded: MIT
  files: [LICENSE]
  redistribution: mirrored
entrypoint: SKILL.md
files:
  - path: SKILL.md
    sha256: ...
host_claims:
  - host: codex
    range: supported-range
permissions:
  scripts: false
  network: []
  tools: []
relationships: []
created_at: RFC3339 timestamp
normalized_artifact_digest: sha256:...
attestations:
  - predicate_type: https://skillmap.dev/attestations/provenance/v1
    bundle_digest: sha256:...
~~~

Rules:

- normalized path separators
- no absolute paths
- no parent traversal
- no symlink escape
- deterministic file ordering
- normalized text encoding where applicable
- documented line-ending policy
- archive entry, expanded byte, file count, and nesting limits
- entrypoint required
- all included files hashed
- unknown executable formats rejected or quarantined
- exact upstream bytes and normalized artifact bytes have different named digests
- malformed-frontmatter recovery may support local diagnosis but can never authorize hosted publication
- provenance, audit, compatibility, and grade are separate in-toto-shaped statements bound to immutable subjects

### Version rules

- publication is immutable
- changed bytes require a new version ID and digest
- reused semantic version with changed bytes is rejected
- publisher may deprecate but not erase an already distributed version, subject to legal takedown policy
- yanked or revoked versions remain in transparency history
- lockfiles resolve to immutable version ID and digest

## TUF-Protected Compact Registry Index

The index is the bridge between a universal hosted library and a small local routing footprint.

Each routable entry should contain only:

- immutable skill ID
- current eligible version ID and digest
- concise name and description
- structured capabilities
- host compatibility state
- primary relationships
- grade band and evidence state
- freshness state
- permission risk flags
- estimated content token cost
- artifact locator

Exclude:

- full SKILL.md
- reference bodies
- scripts
- raw evaluation prompts
- private evidence

Requirements:

- a documented SkillMap TUF profile with root, targets, snapshot, and timestamp metadata
- threshold/offline root custody and recovery procedure
- artifacts, index shards, and revocation overlays published as TUF targets
- consistent snapshots and deterministic serialization
- chunked or delta updates
- monotonic version
- role-specific expiry, last-known-good window, and explicit client freeze behavior
- rollback, freeze, mix-and-match, and replay protection
- revocation overlay with a shorter refresh interval
- root and online key rotation procedure
- optional Sigstore bundle/transparency integration without making it the only trust root
- size budgets measured at 1,000, 5,000, 25,000, and 100,000 skills

If the compact index eventually becomes too large, use hierarchical discovery:

1. tiny global taxonomy and popular or local subset
2. deterministic local query against downloaded metadata shards
3. fetch one signed metadata shard
4. route
5. fetch only selected content

Do not solve scale by exposing full bodies.

## Stable Local Connector Surface

Maintain a small stable set of tools:

- route_prompt
- route_plan
- search_skills
- show_skill_metadata
- load_skill
- load_reference
- pin_skill
- list_pins
- update_registry_index
- submit_feedback, opt-in only

Critical behavior:

- load_skill accepts an immutable ID or a route result
- it verifies signature and digest before returning content
- it returns SKILL.md only
- load_reference accepts only a declared normalized path inside the verified artifact
- output size is bounded and supports chunks
- script files are returned as inert text only when explicitly requested and policy permits
- no tool executes a skill
- route results include reasons and evidence IDs
- connector works from local cache through a hosted outage

## Routing and Skill Selection

### Structured skill profile

Every routable skill needs:

- domains
- platforms
- frameworks
- intents
- workflow phases
- expected inputs
- expected outputs
- required tools
- permission needs
- supported hosts
- prerequisites
- complements
- conflicts
- alternatives
- negative triggers
- token and file cost

### Selection algorithm

Use a constrained deterministic pipeline:

1. Parse explicit constraints from the prompt.
2. Apply hard filters for host, platform, framework, permissions, policy, revocation, and prerequisites.
3. Retrieve candidates by lexical and structured capability match.
4. Classify candidate relationships.
5. Score task fit, trigger evidence, host evidence, freshness, grade confidence, and context cost.
6. Select one primary skill per segment where possible.
7. Add a supporting skill only if it adds uncovered capability.
8. Add a guardrail only when its scope applies globally or to a named segment.
9. Add prerequisites before dependents.
10. Reject redundant, conflicting, wrong-platform, stale-blocked, or policy-disallowed skills.
11. Abstain or request clarification when top choices differ on an unresolved hard constraint.

The optimization target is:

> Maximum requested-task coverage with minimum skill count, minimum context cost, no hard constraint violation, and explainable evidence.

### Roles

- primary: performs the core segment job
- supporting: adds a distinct missing capability
- prerequisite: must run before another selected skill
- guardrail: constrains one or more segments
- final-review: checks the combined result after execution

### Overlap example

For a UI task:

- an Apple-native frontend skill should be removed unless the target is an Apple platform
- a general frontend design skill may be the primary skill
- a React performance skill may be supporting only if React and performance work are requested
- a duplicate visual-design skill should not be loaded merely because it ranks highly
- an accessibility review skill may be a final-review or global guardrail if accessibility is requested or policy requires it

The interface must show these role decisions and the rejected close alternatives.

## Long-Prompt Route Plan

### Required contract

Introduce skillmap.route-plan/v1.

~~~json
{
  "schemaVersion": "skillmap.route-plan/v1",
  "originalPrompt": "...",
  "promptDigest": "sha256:...",
  "segments": [
    {
      "id": "seg-1",
      "order": 1,
      "sourceSpan": {"start": 0, "end": 120},
      "summary": "Design the UI and interaction flow",
      "constraints": {"platform": "web"},
      "dependsOn": [],
      "selections": [
        {
          "skillVersionId": "skv_...",
          "role": "primary",
          "loadScope": "step-only",
          "reasonCodes": ["intent-match", "platform-match"]
        }
      ]
    }
  ],
  "globalSelections": [],
  "finalReviewSelections": [],
  "unresolvedAmbiguities": [],
  "estimatedContext": {
    "metadataTokens": 0,
    "selectedSkillTokens": 0
  }
}
~~~

### Segmentation rules

Fast deterministic path:

- headings
- numbered steps
- bullet groups
- paragraph boundaries
- explicit sequencing words such as first, then, after, before, and finally
- named workstreams such as frontend, backend, and security

Preserve:

- original prompt byte-for-byte
- source span offsets
- original chronological order unless a dependency requires an earlier prerequisite
- dependency distinction from author order

Escalation:

- if a segment mixes incompatible platforms
- if pronouns or shared constraints cannot be resolved safely
- if required ordering conflicts with explicit user sequence
- if no candidate meets a hard requirement

Escalation should first produce a concise clarification, not silently make a broad selection. A later optional semantic planner can be offered outside the deterministic default, with clear disclosure and consent.

### Load scopes

- step-only: load just before the relevant segment
- global-guardrail: load once and keep active across relevant segments
- prerequisite: load and apply before dependents
- final-review: load only after implementation segments finish

This gives chronological skill invocation without rewriting the user intent into one undifferentiated mega-prompt.

## Grading System

### Grade philosophy

Use hard gates plus a transparent scorecard. Never collapse every trust dimension into one unqualified number.

The first online slice uses only truthful states: `ungraded`, `provisional`, `current`, `stale`, `blocked`, or `revoked`. Seed data is `ungraded` unless a real receipt satisfying this section exists. Identity verification, provenance, audit completion, compatibility, and grade currency remain separate evidence states.

### Hard gates

A public graded version must pass:

- package structural validity
- immutable source and artifact digest
- known provenance
- acceptable redistribution status or metadata-only mode
- no unresolved critical security finding
- no path traversal or archive-limit violation
- required host-profile checks
- minimum evaluation evidence
- explicit script and permission declaration

Failure blocks the current grade or publication as appropriate.

### Score dimensions

Recommended initial weights are provisional and require calibration:

1. Trigger quality, 20 percent
   - positive recall
   - negative precision
   - near-miss rejection
   - boundary clarity

2. Instruction quality, 20 percent
   - explicit workflow
   - input and output clarity
   - internal consistency
   - progressive disclosure
   - failure and recovery guidance

3. Task effectiveness, 20 percent
   - improvement against no-skill and previous-version baselines
   - completion against representative held-out cases
   - adherence to requested constraints
   - usefulness of produced artifact

4. Host compatibility, 15 percent
   - Codex package validity
   - invocation behavior
   - tool assumptions
   - host-version compatibility

5. Safety and permissions, 10 percent
   - least privilege
   - risky instruction detection
   - script transparency
   - secret and exfiltration resistance

6. Maintainability and freshness, 10 percent
   - source health
   - versioning
   - referenced dependency freshness
   - documentation consistency

7. Provenance and licensing quality, 5 percent
   - source clarity
   - ownership
   - license precision
   - attribution completeness

Publish the dimensions, raw evidence, confidence, and hard gates beside any letter grade.

### Grade bands

- A: strong evidence, clear boundaries, high task effectiveness, no material unresolved finding
- B: reliable for intended use with minor limitations
- C: usable with meaningful limitations or lower confidence
- D: substantial quality or compatibility concerns
- F: fails required behavior or a blocking non-security quality gate
- Blocked: cannot be publicly graded because a hard trust gate failed
- Provisional: insufficient evidence for a stable band
- Stale: once-valid receipt invalidated by relevant change

### Grade receipt binding

Every receipt includes:

- skill ID
- skill version ID
- content digest
- artifact digest
- host profile and version
- host documentation snapshot digest
- rubric ID and version
- evaluation suite ID and digest
- evaluator and runtime versions
- evaluator source or container image digest
- resolved dependency and vulnerability/advisory snapshot digests
- model/runtime snapshot, parameters, seed where applicable, and network policy
- no-skill and previous-version baseline identifiers and results
- train/validation/held-out split digests
- repeated trial count, variance, confidence interval, and failure count
- token, latency, and monetary cost deltas where applicable
- test case counts by class
- dimension results
- hard gate results
- evidence references
- confidence
- graded timestamp
- expiry or invalidation policy
- in-toto Statement v1 subject and SkillMap grade predicate URI/version
- receipt signature or verification bundle

### Evaluation classes

At minimum:

- positive direct triggers
- positive paraphrases
- negative unrelated prompts
- near-miss prompts
- platform disambiguation
- framework disambiguation
- alternative selection
- complementary portfolio
- prerequisite ordering
- global guardrail
- ordered multi-intent prompt
- clarification and abstention
- redundancy and conflict
- adversarial prompt injection
- unavailable tool or permission
- stale reference behavior

OpenAI plugin submission guidance can serve as a floor for basic examples, but registry grading needs a larger and more varied suite than five positive and three negative cases.

Every behavioral trial starts from a clean context. Prefer mechanical validators and observable artifacts over model judges. Subjective comparisons are blind where practical. Train and held-out cases are frozen separately, and a grade cannot be current if its receipt omits the baseline, sample count, variance, and evidence digests required by its rubric version.

### Metrics

- primary skill accuracy
- task coverage
- wrong-platform rate
- wrong-framework rate
- trigger precision
- trigger recall
- near-miss rejection rate
- unnecessary skill count
- portfolio redundancy
- conflict rate
- segment coverage
- ordering accuracy
- dependency accuracy
- clarification accuracy
- context metadata cost
- selected content cost
- task outcome score

### Human review

Require human review for:

- ambiguous license
- publisher ownership dispute
- critical or high security finding
- suspected malicious instruction
- close duplicate identity
- grade appeal
- first publication from a high-risk category
- automated evidence disagreement above a threshold

Human reviewers do not hand-edit the score. They disposition evidence, correct metadata, or trigger a new versioned grade run.

## Freshness and Update System

### Watch inputs

- repository branch, tag, release, and commit changes
- source path changes
- package manifest changes
- dependency and referenced-document changes
- host documentation snapshots
- rubric changes
- evaluator changes
- vulnerability intelligence relevant to bundled code
- publisher deprecation or revocation

### Invalidation rules

Invalidate or mark stale when:

- skill bytes change
- source commit no longer resolves
- host profile changes materially
- rubric changes a scored rule
- evaluation suite changes materially
- a referenced tool or framework leaves the supported range
- a new security finding affects the version
- license status changes

Do not overwrite the old receipt. Record an invalidation event and produce a new run.

### Update UX

For users with a pin:

- show current pinned version
- show latest eligible version
- summarize source and manifest diff
- show grade and permission changes
- identify new files or scripts
- require confirmation for material permission expansion
- preserve rollback

For publishers:

- signed webhook validation and delivery-GUID deduplication for fast updates where available
- scheduled exact-commit polling and failed-delivery reconciliation as the authoritative recovery path
- idempotent exact-commit ingestion
- visible job state and failure details

## Ingestion Pipeline

~~~text
submission or discovery
to catalog source and crawl receipt
to distribution bundle and individual-skill separation
to exact source resolution
to repository ownership and provenance check
to license classification
to bounded tree and archive extraction
to Agent Skills and SkillMap schema validation
to secret, malware, prompt-injection, script, and permission scans
to exact raw source snapshot digest and normalized package digest
to capability classification
to duplicate and relationship analysis
to host compatibility evaluation
to behavioral evaluation
to grade receipt
to automated or human publication decision
to search projection and TUF targets, snapshot, timestamp, and compact index update
to source watcher enrollment
~~~

### Pipeline requirements

- every stage idempotent
- application effects treated as at-least-once regardless of queue delivery wording
- job correlation ID
- queue message contains only the job ID and bounded routing metadata; canonical payload remains in the private database
- immutable input commit
- bounded retry policy
- dead-letter queue
- stage receipts
- worker version recorded
- no network access during risky analysis unless explicitly sandboxed and allowlisted
- no build or script execution for basic package validation
- no heavy repository, archive, browser, security, or grading work in a Next.js request or Supabase Edge Function
- publisher-visible error codes
- operator replay from a chosen safe stage
- outbox pattern for publication, search, and index events
- webhook signature verification, delivery-GUID deduplication, and scheduled reconciliation
- catalog-source coverage and crawl-failure receipt
- lifecycle transition and audit receipt committed with every consequential state change

### Capability classification

Use three sources:

1. publisher declarations
2. deterministic extraction from frontmatter and content
3. reviewed or evaluated annotations

Store provenance and confidence per annotation. A later model-assisted classifier may propose metadata offline, but it cannot silently become canonical.

## Security and Supply-Chain Plan

### Threats

- prompt injection embedded in skill instructions
- malicious scripts or binaries
- credential exfiltration instructions
- path traversal and symlink escape
- archive bombs
- dependency confusion
- publisher account takeover
- source repository compromise
- package substitution
- replay or rollback to a revoked index
- grade receipt forgery
- poisoned evaluation cases
- SSRF from repository import
- cross-tenant access in future private registries
- XSS through rendered Markdown

### Controls

- strict URL and repository validation rules
- network egress controls for workers
- bounded clone, fetch, and archive limits
- no implicit submodule execution
- inert Markdown rendering with a sanitized allowlist
- package and index signatures
- content-addressed artifacts
- transparency log for publication, revocation, and key changes
- isolated worker identities
- least-privilege object-store and database roles
- secret scanning
- script and binary inventory
- prompt-injection heuristics plus human review where high risk
- CSP, CSRF, secure cookies, and standard web controls
- rate limits and abuse detection
- MFA for registry operators
- two-person approval for critical revocation reversal and signing-key changes
- backup and restore tests
- key rotation and compromise runbook

### Permission model

Normalize:

- filesystem read and write scopes
- network domains
- shell execution
- browser control
- external apps and connectors
- secret access
- destructive operations

Publish declared permissions and observed instruction requests separately. A mismatch is a finding.

### Revocation

- critical advisory can publish independently of a full index rebuild
- local runtime refreshes the signed revocation overlay frequently
- pinned users receive a blocking or explicit override state based on severity
- offline runtime retains last-known revocations
- override, if allowed, creates a local receipt

## Legal, Licensing, and Governance

Before mirroring third-party bodies:

- classify SPDX or custom license
- verify redistribution and modification rights
- preserve required notices
- record exact source and commit
- offer metadata-only listing where rights are unclear
- provide publisher claim, correction, takedown, and appeal paths

Required public policies:

- Terms of Service
- Privacy Policy
- Acceptable Use Policy
- copyright and takedown policy
- publisher agreement
- grading and appeal policy
- security disclosure policy
- data retention policy

Counsel decision gates:

- whether submitted packages are licensed to SkillMap for hosting and analysis
- treatment of repository licenses versus individual skill directories
- use of trademarks and official labels
- public retention of yanked or legally removed metadata
- publisher analytics and privacy
- future commercial use of community-submitted evaluation feedback

Governance:

- versioned public rubric
- documented conflict-of-interest policy
- no paid grade improvement
- disclosed sponsored placement
- appeal reviewed separately from the original consequential decision where practical
- public changelog for material methodology changes

## API Contract

Version all public endpoints under /api/v1 and use shared runtime validation.

### Public read endpoints

- GET /api/v1/skills
- GET /api/v1/skills/{skillId}
- GET /api/v1/skills/{skillId}/versions
- GET /api/v1/skill-versions/{versionId}
- GET /api/v1/skill-versions/{versionId}/manifest
- GET /api/v1/skill-versions/{versionId}/grade
- GET /api/v1/skill-versions/{versionId}/relationships
- GET /api/v1/publishers/{publisherId}
- GET /api/v1/collections
- GET /api/v1/stacks
- GET /api/v1/registry/index
- GET /api/v1/registry/index/{version}
- GET /api/v1/registry/revocations
- GET /api/v1/rubrics/{version}
- GET /api/v1/host-profiles/{host}/{version}

### Authenticated publisher endpoints

- GET /api/v1/account/saved-skills
- PUT /api/v1/account/saved-skills/{skillId}
- DELETE /api/v1/account/saved-skills/{skillId}
- POST /api/v1/publishers
- POST /api/v1/publishers/{publisherId}/claims
- POST /api/v1/submissions
- GET /api/v1/submissions/{submissionId}
- POST /api/v1/submissions/{submissionId}/publish
- POST /api/v1/skills/{skillId}/versions
- POST /api/v1/skill-versions/{versionId}/deprecate
- POST /api/v1/grade-runs
- POST /api/v1/appeals

### Operator endpoints

- GET /api/v1/admin/review-cases
- POST /api/v1/admin/review-cases/{id}/dispositions
- POST /api/v1/admin/skill-versions/{id}/quarantine
- POST /api/v1/admin/skill-versions/{id}/revoke
- POST /api/v1/admin/jobs/{id}/retry
- GET /api/v1/admin/audit-events

### API conventions

- cursor pagination
- stable machine error codes
- request and correlation IDs
- idempotency keys on mutations
- ETags and cache controls
- explicit evidence state
- no ambiguous null for unknown versus not-applicable
- RFC3339 timestamps
- immutable IDs in payloads
- audit receipt on consequential writes
- OpenAPI specification generated and checked in CI

## Authentication and Authorization

Launch:

- public reads anonymous with rate limits
- Supabase Auth owns sessions
- GitHub OAuth through Supabase PKCE is the initial sign-in path for saving, submitting, and claiming
- exact `/auth/callback` redirect allowlists; broad wildcards are local/preview-only
- request-scoped `@supabase/ssr` browser/server clients and Next.js `proxy.ts` refresh
- `getClaims()` verifies identity for protected pages; `getUser()` is used when a fresh Auth record is required; `getSession()` never authorizes
- auth-cookie responses propagate Supabase's private/no-store cache headers
- public publisher identity is separate from private account/profile data
- operator access is separate, checked against fresh relational roles, and MFA `aal2`-enforced for consequential writes
- publisher roles: owner, maintainer, and analyst
- user-owned saved skills provide the first concrete free-account workflow

Supabase data rules:

- expose an explicit `api` schema only
- grant only the exact verbs each `anon` or `authenticated` path needs
- enable RLS on every exposed table and test direct-table as well as view/API behavior
- `UPDATE` policies have `SELECT`, `USING`, and `WITH CHECK`
- every ownership and membership policy includes `auth.uid()` plus indexed relational predicates
- `TO authenticated` alone is never treated as authorization
- user-editable `raw_user_meta_data`/`user_metadata` never grants roles
- public views use `security_invoker = true`
- operator and publisher role changes take effect through relational checks; stale custom claims are only a coarse UI hint
- secret/service keys are limited to trusted server/worker components and never enter browser bundles
- use an idempotent `ensure_profile()` callback path rather than a signup-blocking profile trigger in the first slice

Future teams:

- organization owner, admin, policy maintainer, member, and auditor
- SSO and SCIM
- tenant-scoped service accounts
- explicit private and public visibility
- database and API tenant isolation tests

Never use source repository membership as the only runtime authorization check after a publisher identity has been established.

Email/password or magic-link login is deferred until custom SMTP, abuse controls, templates, rate limits, and recovery are production-ready. Stripe has no role in authentication or authorization.

## Observability and Operations

### Metrics

- search latency, error, and zero-result rate
- artifact fetch latency and verification failures
- index freshness and client adoption
- ingestion throughput and stage failure rate
- grade queue age and run duration
- source watcher lag
- stale public grade count
- security queue age
- revocation propagation time
- publisher submission time to decision
- connection funnel completion
- route accuracy from controlled evaluations
- opt-in feedback rate

### Logs and traces

- structured logs
- job and request correlation
- no raw prompt by default
- redact tokens, repository credentials, and private paths
- separate security audit log retention
- trace ingestion stages and publication events

### Initial service objectives

- public registry read availability: 99.9 percent monthly after beta
- artifact integrity verification: 100 percent mandatory
- critical revocation published within one hour of confirmed decision
- source watcher p95 detection within 24 hours, with webhook paths faster
- grade queue p95 under 24 hours in public beta
- restore point and restore time objectives chosen before production

These are launch targets, not current claims.

Supabase Free and Vercel Hobby do not prove these targets. Private alpha may use free infrastructure, but public release requires explicit plan/team/cost approval, non-pausing behavior, managed database backup or an approved equivalent, independent Storage export/restore, and sufficient log retention. Free-to-users remains independent from infrastructure spend.

### Runbooks

- signing-key compromise
- object-store corruption
- registry database restore
- search outage
- poisoned package
- critical revocation
- publisher account takeover
- webhook replay flood
- takedown
- data leak
- worker backlog
- host documentation breaking change

## Analytics and Privacy

Collect:

- anonymous page and funnel events
- search query only under a disclosed retention policy
- connect step completion
- artifact and index version fetch counts
- aggregate route outcome feedback when explicitly enabled

Do not collect by default:

- raw local prompts
- local skill bodies
- local absolute paths
- environment variables
- agent conversation transcripts
- private repository contents beyond an authorized submission job

Popularity:

- define the source of the signal
- resist easy gaming
- deduplicate obvious automation
- show a time window
- keep it separate from grade and organic relevance

## Implementation Phases

This sequence is controlling. It intentionally proves a real online data path before the full package, grader, router, and corpus systems. Each phase may expose only evidence states actually implemented at that point.

## Phase 0: Research, Contracts, and Supabase Architecture Gate

Goal: freeze the cross-system contracts and safe hosted boundary before application code depends on them.

Work:

- accept the verified research dossier and its frozen claim ledger
- freeze local versus hosted identity domains
- approve public catalog payload, list, grade-state, evidence-state, and error contracts
- define Supabase exposed `api` and non-exposed `private` schemas
- define public-read, account-owned, publisher-owned, worker-only, and operator-only RLS matrices
- define GitHub OAuth callback, redirect, claims, profile, logout, and cache-control behavior
- define local, preview, staging, and production environment mapping without secrets
- define package, TUF, attestation, route-plan, grade-receipt, lifecycle, coverage, advisory, and revocation contracts
- define metadata-only behavior for unclear redistribution rights
- define explicit crawl-record, package/version, grade, advisory, and revocation transition tables, including forbidden transitions and immutable-history rules
- perform hosted threat model and privacy review
- pin hosted runtime policy to Node 22 or newer, targeting Node 24
- record Vercel as preferred web host and Supabase as backend, with provisioning/cost approval still gated

Deliverables:

- verified research dossier
- shared hosted catalog contracts and fixtures
- `docs/specs/hosted-identity-v1.md`
- `docs/specs/package-format-v1.md`
- `docs/specs/registry-tuf-profile-v1.md`
- `docs/specs/route-plan-v1.md`
- `docs/specs/grade-receipt-v1.md`
- `docs/specs/evidence-states-v1.md`
- `docs/specs/host-profile-v1.md`
- `docs/specs/source-coverage-receipt-v1.md`
- `docs/specs/advisory-v1.md`
- `docs/architecture/hosted-registry.md`
- `docs/security/hosted-threat-model.md`
- `docs/decisions/2026-07-11-hosted-architecture.md`
- `docs/decisions/2026-07-11-hosted-legal-boundary.md`

Exit gate:

- hosted contract fixtures validate in root and web consumers
- local `sk_...`, hosted `skl_...`, hosted `skv_...`, and digest authority are unambiguous
- every exposed table/view has a planned grant and RLS owner
- no unresolved choice can force a published identity or digest migration
- no launch contract contains Stripe, billing, entitlement, or metering state
- deployment, corpus mirroring, and production mutation remain explicitly gated
- declared-source coverage mechanically reconciles every discovered record against one exact universe digest, and the “all indexed skills” claim fails closed on missing, partial, failed, stale, or unverifiable receipts
- source, package, and advisory transitions have exact machine vocabularies, allowed edges, receipt gates, and append-only history behavior

## Phase 1: Supabase-Backed Online Catalog and Account Spine

Goal: prove a real anonymous online catalog and free account workflow against Supabase without fabricating later trust capabilities.

This is the first authorized implementation slice.

Work:

- add pinned Supabase JS/SSR dependencies and move hosted web CI/runtime to Node 22 or newer
- add `supabase/config.toml`, migration workflow, deterministic seed, generated database types, database lint, and pgTAP tests
- create private profiles, public publishers, publisher memberships, source repositories, skills, immutable skill versions, truthful grade/evidence state, saved skills, and private audit events
- expose only the explicit API schema and public/security-invoker projections
- implement anonymous published/non-revoked reads and user-isolated saved-skill writes
- keep publisher, skill, version, grade, and audit mutation worker/operator-only in this slice
- seed three first-party, clearly licensed versions: two alternatives and one complement/guardrail
- bind each seed to source repository, exact commit/path, immutable IDs, and the checked-in `SKILL.md` entrypoint-content digest
- leave raw-snapshot, normalized-artifact, and manifest digests null on the Phase 1 metadata-only version identities; Phase 2 must mint new admitted `skv_...` identities for canonical package bytes, advance current-version pointers through a receipt-backed transition, and preserve the original metadata-only versions unchanged; never relabel the entrypoint-content digest as another digest authority
- seed explicit `unverified`, `ungraded`, `not-run`, and `not-tested` states rather than implying canonical provenance, grade, audit, or compatibility work that has not happened
- implement a server-only registry repository and bounded public read API
- implement server-rendered `/skills` search and `/skills/[publisher]/[slug]` detail routes
- implement Supabase SSR clients, root Proxy, GitHub sign-in, callback, sign-out, account, save/unsave, and saved-skills routes
- link the landing page to the real directory while preserving `/dashboard` as the separate local fixture/snapshot product
- make missing Supabase configuration a visible error; never silently substitute fixtures on hosted routes

Primary code areas:

- `contracts/` and generated root/web contract bundles
- `supabase/`
- `apps/web/lib/supabase/`
- `apps/web/lib/registry/`
- `apps/web/app/api/v1/`
- `apps/web/app/skills/`
- `apps/web/app/auth/`
- `apps/web/app/account/`
- focused catalog/account components and tests
- web CI/runtime configuration and environment documentation

Exit gate:

- local Supabase reset, lint, seed, and pgTAP/RLS tests pass
- anonymous API/UI reads return only public published/non-revoked rows
- draft, quarantined, revoked, legally unavailable, and private rows cannot leak through tables, views, APIs, list, or detail
- a verified user can save/unsave and read only their own saved skills
- anonymous/authenticated clients cannot mutate catalog, version, grade, or audit truth
- direct API and UI payloads validate against the same checked-in contracts
- no secret/service key appears in browser bundles, logs, fixtures, or screenshots
- no seeded letter grade or broad verified/safe claim exists
- `/dashboard`, CLI, MCP, local connector, local IDs, and root Node 20 compatibility remain unchanged
- targeted browser, accessibility, responsive, performance, build, lint, typecheck, contract, and regression checks pass
- status is reported as locally validated, not online/deployed, until a real project and deployment are separately verified

## Phase 2: Package, TUF Update Metadata, Loader, and Local Access

Goal: make the existing local runtime safely fetch and progressively load one selected hosted version.

Work:

- implement strict Agent Skills import profile and deterministic package normalization
- preserve exact upstream snapshot bytes separately from normalized package bytes
- mint new admitted package-version identities for canonical raw/normalized bytes instead of filling Phase 1 metadata-only versions in place; advance current pointers only through an append-only transition receipt while old versions and pins remain addressable
- implement artifact, manifest, and in-toto-shaped provenance contracts
- implement the SkillMap TUF root/targets/snapshot/timestamp profile
- implement threshold/root bootstrap, expiry, rollback/freeze protection, consistent snapshots, rotation, and recovery
- implement bounded artifact extraction and signature/digest verification
- implement local content-addressed cache, lockfile, pins, and last-known-good behavior
- implement `load_skill` and `load_reference`
- preserve current local roots as a separate source adapter
- add migration and rollback documentation

Exit gate:

- selected package loads only by immutable version ID and digest
- packaging a Phase 1 metadata-only source creates a new `skv_...`, leaves the original version byte-for-byte and field-for-field immutable, advances the public current pointer through a verifiable transition, and preserves old-version pin/rollback behavior
- tampered package, metadata, manifest, or TUF role fails closed
- rollback, freeze, mix-and-match, expired-metadata, path traversal, symlink escape, archive bomb, and oversized-output tests pass
- local route and load work offline from cache
- no skill script executes
- existing local SkillMap workflows remain compatible

## Phase 3: Ingestion, Audit, Advisory, and Update Foundation

Goal: turn declared sources and invited submissions into immutable, legally eligible, continuously monitored records.

Work:

- implement catalog sources, crawl runs, source locator snapshots, distribution bundles, bundle versions, and bundle members
- implement exact-commit GitHub ingestion with strict frontmatter and package validation
- resolve declared, detected, and reviewer-concluded license evidence per version/file
- implement metadata-only disposition for unclear redistribution rights
- add bounded secret, malware, prompt-injection, script, binary, permission, and provenance scans
- implement lifecycle transition, audit receipt, review case, quarantine, advisory, deprecation, yanking, revocation, legal unavailability, and tombstone state
- use Supabase Queues/Cron for coordination and a constrained external Node worker for heavy jobs
- validate webhook signatures, deduplicate delivery GUIDs, and retain scheduled exact-commit reconciliation
- implement idempotency receipts, bounded attempts, dead-letter queue, safe replay, and outbox publication
- store public artifacts and private evidence in separate buckets with independent backup
- publish the source-coverage report and first TUF-protected index

Exit gate:

- one first-party source travels from source adapter through crawl, validation, disposition, audit, artifact, and public index without manual row edits
- changing that source to a new exact commit creates a new immutable version, produces fresh audit/advisory evidence, advances the public pointer only after all gates pass, invalidates and requeues affected grade/compatibility evidence, updates the coverage receipt, preserves the prior pin, and proves rollback without rewriting either version
- replay and duplicate webhook delivery create no duplicate consequence
- old versions remain immutable and aliases cannot resurrect identity
- metadata-only records never expose bodies or artifacts
- private evidence and credentials cannot leak
- a missed webhook is recovered by reconciliation
- database and Storage restore are exercised in a non-production environment
- no untrusted script executes

## Phase 4: Grading, Compatibility, Relationships, and Freshness

Goal: make every routable public version evidence-rich and continuously maintainable.

Work:

- implement versioned rubrics and one frozen Codex host profile
- implement in-toto-shaped audit, compatibility, and grade receipt predicates
- create no-skill and previous-version baselines, clean contexts, repeated trials, and frozen train/held-out suites
- capture evaluator image/source digest, model/runtime, parameters, dependency/advisory snapshots, samples, variance, confidence, and cost deltas
- prefer mechanical validators and blind subjective comparisons where practical
- implement grade hard gates, dimension scores, current/provisional/stale/blocked/revoked states, and invalidation graph
- implement version-scoped typed alternative, complement, prerequisite, conflict, duplicate, provider, replacement, and supersession edges
- validate relationship direction, evidence, ranges, cycles, and contradictions
- implement source, dependency, advisory, rubric, evaluator, host-documentation, and host-profile freshness watchers
- build reviewer disposition and appeal flows

Exit gate:

- every routable launch-corpus version has a current bound receipt; otherwise it is not routable and is visibly ungraded/provisional/blocked/stale
- same deterministic inputs reproduce the deterministic receipt portion
- baseline, held-out split, samples, variance, confidence, and cost are disclosed
- a source, host, rubric, suite, evaluator, dependency, or advisory change invalidates affected receipts
- identity, provenance, audit, compatibility, and grade badges remain independent
- relationships support reviewed real overlap examples
- independent rubric and security review complete

## Phase 5: Portfolio Router, Chronological Plan, Loader Integration, and Codex Plugin

Goal: choose and load the smallest adequate verified skill portfolio for simple and long prompts without putting the catalog or raw prompts in hosted context.

Work:

- extend compact metadata and TUF-protected index contracts
- implement hard platform/tool/permission/host filters
- implement relationship-aware minimal portfolio optimization
- implement deterministic segmentation, source spans, dependencies, roles, and load scopes
- implement `skillmap.route-plan/v1`, clarification, and abstention
- record local route receipts with router version, index version, policy digest, stable tie-breakers, evidence/relationship IDs, selected and rejected candidates, and explanation codes
- add context-cost accounting and progressive `load_skill`/`load_reference`
- expose decisions through CLI and the stable MCP surface
- build one lightweight SkillMap Codex plugin that searches, routes, and loads dynamically; never bundle the catalog or create one tool/plugin per skill
- build confusion, overlap, negative, ordering, and stale-index suites

Exit gate:

- representative overlaps choose the correct primary and only useful complements
- redundant, incompatible, wrong-platform, revoked, and stale-ineligible versions are rejected
- multi-part prompts preserve requested chronology, dependencies, global guardrails, and final review
- the raw prompt and route receipt stay local by default
- cached routing/load survives a hosted outage within the documented last-known-good window
- plugin install, search, route, and verified load complete through a small stable surface
- local route performance and context budgets pass

## Phase 6: Complete Public Product, Publisher, and Operator Workflows

Goal: turn the proven spine and trust engine into the comprehensive online product.

Work:

- evolve the landing page into search-first online product navigation
- complete directory filters, permanent detail/version pages, compare, route playground, collections, stacks, publisher pages, connect, trust, methodology, SEO, sitemap, and grade badges
- implement invited publisher claim, submission, draft, remediation, update, deprecation, and appeal workflows
- implement operator review, replay, quarantine, advisory, revocation, takedown, restore, and appeal queues
- enforce owner/maintainer/analyst roles and fresh operator/MFA checks
- implement complete consequential audit receipts and basic publisher analytics
- complete empty, loading, error, stale, partial, blocked, revoked, unauthenticated, unauthorized, and offline states
- complete desktop, tablet, 390px, and 320px accessibility/responsive QA

Exit gate:

- every public surface reads the registry contracts and truthful evidence states
- an invited external publisher submits and updates a skill without database editing
- ambiguous license/security cases cannot bypass review
- an operator can reconstruct, replay, revoke, and restore from audit/job state without production row surgery
- role, RLS, MFA, privacy, accessibility, responsive, browser, SEO, and performance tests pass
- a new Codex user connects and loads a verified sample in under five minutes

## Phase 7: Declared-Source Corpus, Production Hardening, and Public Release

Goal: launch the free-to-users online library with complete declared-source coverage and exercised operations.

Work:

- curate and grade the initial 150-to-300 fully evidenced public-version milestone
- run every approved source adapter and publish coverage/failure/freshness receipts
- disposition every discovered record as published, metadata-only, duplicate, quarantined, legally unavailable, failed, or otherwise explicitly non-public
- perform duplicate/relationship review, security assessment, and license audit
- conduct external new-user and publisher usability pilots
- verify clean installs on supported OS and Codex combinations
- finish README, docs, examples, contribution, security, governance, coverage, and roadmap
- exercise backup/restore, Storage export/restore, webhook recovery, DLQ replay, revocation, takedown, root/signing key rotation, and incident response
- establish support/on-call, status, incident, privacy, and data-retention surfaces
- select and approve production Supabase/Vercel plans, team ownership, regions, domain, cost controls, secrets, redirects, and rollback
- deploy, migrate, seed only approved first-party data, and capture authenticated/anonymous live smoke evidence
- publish truthful launch metrics and known limitations

Exit gate:

- all launch acceptance criteria pass with no unresolved P0/P1 security finding
- every declared-source crawl has a current coverage receipt and every discovered record has a disposition
- 100 percent of routable versions have required provenance, license, compatibility, audit, grade, freshness, and lifecycle evidence
- at least four of five new users complete route and load within fifteen minutes
- backup/restore, Storage restore, revocation, key rotation, takedown, and incident runbooks are exercised and owned
- public website, API, TUF metadata, plugin, local runtime, and repository agree on current contracts and commands
- public SLOs are backed by approved infrastructure rather than assumed from a free tier
- local, live, pushed, deployed, and blocked evidence are reported separately

## Phase 8: Future Private Teams and Stripe Billing, Separate Approval Only

Goal: optionally monetize private organizational governance without weakening the free public product.

This phase is outside the launch scope and must receive a new plan, threat model, data model, pricing decision, Stripe approval, and implementation authorization.

Potential work:

- organizations and tenant isolation
- private sources, artifacts, indexes, grading, rubrics, and policies
- organization collections, approvals, version enforcement, and audit export
- SSO, SCIM, RBAC, service accounts, regional controls, retention, support, and SLAs
- usage metering and entitlements only after the product/pricing contract is approved
- Stripe products, prices, Checkout/Portal, signed webhooks, reconciliation, subscription state, tax/refund/support operations, and failure modes only in that future plan

Exit gate:

- a separate commercial plan and owner approval exist
- tenant isolation is independently tested
- Stripe reconciliation and entitlement failure modes are tested
- the public catalog, public trust evidence, and local runtime remain useful without a subscription and during a hosted outage

## Detailed Implementation Backlog

### Contracts and architecture

- ARC-001: Record open-source versus hosted boundary ADR.
- ARC-002: Record public web, API, worker, database, search, object store, and queue boundaries.
- ARC-003: Define environment model for local, test, preview, staging, and production.
- ARC-004: Define IDs, timestamps, pagination, errors, idempotency, and audit receipts.
- ARC-005: Define package publication state machine.
- ARC-006: Define grade state and invalidation state machine.
- ARC-007: Define revocation and deprecation state machine.
- ARC-008: Define source and host documentation snapshot model.
- ARC-009: Define data classification and retention matrix.
- ARC-010: Complete hosted threat model and abuse cases.
- ARC-011: Freeze Supabase `api` versus `private` schema, grants, RLS, role, key, and backup boundaries.
- ARC-012: Freeze local `sk_...`, hosted `pub_...`/`skl_...`/`skv_...`, aliases, transfers, and tombstones.
- ARC-013: Freeze declared-source coverage and crawl-receipt contract.
- ARC-014: Record free-to-users versus infrastructure-plan/cost gate; prohibit launch billing artifacts.
- ARC-015: Freeze advisory revision, affected-subject, exposure-state, and lifecycle-separation contract.

### Package and runtime

- PKG-001: Specify deterministic package normalization.
- PKG-002: Implement manifest schema and fixtures.
- PKG-003: Implement file-tree limits.
- PKG-004: Implement content and artifact digests.
- PKG-005: Implement signing and verification abstraction.
- PKG-006: Implement safe extraction.
- PKG-007: Implement content-addressed local cache.
- PKG-008: Implement lockfile.
- PKG-009: Implement pin, update, rollback, and uninstall.
- PKG-010: Add package conformance CLI.
- PKG-011: Add tamper and malicious archive corpus.
- PKG-012: Document key rotation and offline verification.
- PKG-013: Specify and implement TUF root, targets, snapshot, timestamp, expiry, rollback/freeze, rotation, and recovery behavior.
- PKG-014: Implement separate raw source snapshot and normalized artifact digests.
- PKG-015: Emit in-toto-shaped provenance statements and verification bundles.

### Registry and ingestion

- REG-001: Create initial database migrations.
- REG-001A: Add local Supabase config, deterministic seed, generated types, pgTAP/RLS tests, database lint, and CI gate.
- REG-001B: Expose only the `api` schema and keep jobs, findings, roles, evidence, and audit internals private.
- REG-002: Implement publisher, source, skill, and version repositories.
- REG-003: Implement object-store artifact adapter.
- REG-004: Implement exact-commit source fetcher.
- REG-005: Implement idempotent submission pipeline.
- REG-006: Implement license classifier and manual-review state.
- REG-007: Implement source and provenance receipts.
- REG-008: Implement publication transaction and outbox.
- REG-009: Implement TUF targets/snapshot/timestamp and compact-index builder.
- REG-010: Implement delta index and revocation overlay.
- REG-011: Implement source webhook validation.
- REG-012: Implement scheduled source polling.
- REG-013: Implement search projection and reconciliation.
- REG-014: Implement backup, restore, and migration runbooks.
- REG-015: Implement catalog sources, crawl runs, source locator snapshots, distribution bundles, and bundle membership.
- REG-016: Implement saved skills with user-isolated RLS.
- REG-017: Implement lifecycle, alias reservation, transfer, tombstone, advisory, and affected-version records.
- REG-018: Implement queue idempotency receipts, bounded attempts, DLQ, and exact-commit reconciliation.

### Loader and connector

- LDR-001: Add registry source adapter.
- LDR-002: Add index download and signature verification.
- LDR-003: Add update and last-known-good policy.
- LDR-004: Implement load_skill.
- LDR-005: Implement load_reference.
- LDR-006: Bound and paginate content responses.
- LDR-007: Implement package policy checks before load.
- LDR-008: Add pin and list_pins tools.
- LDR-009: Add offline cache behavior.
- LDR-010: Add connector compatibility negotiation.
- LDR-011: Add end-to-end Codex connection fixture.
- LDR-012: Document coexistence and migration from broad local auto-discovery.

### Grading and trust

- GRD-001: Publish rubric v1 draft.
- GRD-002: Implement rubric schema and validation.
- GRD-003: Implement hard gate evaluator.
- GRD-004: Implement grade dimension engine.
- GRD-005: Implement signed receipt.
- GRD-006: Implement receipt verifier in the open-source client.
- GRD-007: Create Codex host profile v1.
- GRD-008: Snapshot and digest governing host documentation.
- GRD-009: Create positive and paraphrase cases.
- GRD-010: Create negative and near-miss cases.
- GRD-011: Create platform and framework disambiguation cases.
- GRD-012: Create portfolio relationship cases.
- GRD-013: Create ordered multi-intent cases.
- GRD-014: Create adversarial and permission cases.
- GRD-015: Implement confidence and sample-size reporting.
- GRD-016: Implement invalidation graph.
- GRD-017: Implement reviewer evidence disposition.
- GRD-018: Run independent rubric calibration.
- GRD-019: Implement no-skill and previous-version baselines with clean contexts and held-out splits.
- GRD-020: Record evaluator/source image, model/runtime, dependency/advisory snapshots, samples, variance, confidence, and cost deltas.
- GRD-021: Emit separate in-toto-shaped provenance, audit, compatibility, and grade predicates.

### Routing and planning

- RTE-001: Extend compact capability profile.
- RTE-002: Implement hard-constraint extraction.
- RTE-003: Implement host, platform, and framework filters.
- RTE-004: Implement candidate retrieval.
- RTE-005: Implement alternative grouping.
- RTE-006: Implement complement coverage calculation.
- RTE-007: Implement prerequisite ordering.
- RTE-008: Implement conflict and redundancy rejection.
- RTE-009: Implement minimal portfolio selector.
- RTE-010: Implement deterministic segmenter.
- RTE-011: Implement source span preservation.
- RTE-012: Implement skillmap.route-plan/v1.
- RTE-013: Implement step, global, prerequisite, and final-review scopes.
- RTE-014: Implement clarification and abstention.
- RTE-015: Implement context cost estimates.
- RTE-016: Expose route_plan through CLI and MCP.
- RTE-017: Add explanation and rejected-alternative codes.
- RTE-018: Benchmark 1K, 5K, 25K, and 100K metadata strategies.
- RTE-019: Emit local route receipts with router/index/policy/evidence/relationship IDs and stable tie-breakers.
- RTE-020: Package one lightweight SkillMap Codex plugin over the stable search/route/load surface.

### Public UI

- WEB-001: Define public design tokens and evidence components.
- WEB-002: Implement global navigation and footer.
- WEB-003: Implement real search landing.
- WEB-004: Implement directory results and filters.
- WEB-005: Implement skill detail.
- WEB-006: Implement version and history views.
- WEB-007: Implement grade breakdown and evidence.
- WEB-008: Implement permissions and security disclosure.
- WEB-009: Implement relationships.
- WEB-010: Implement comparison.
- WEB-011: Implement route playground.
- WEB-012: Implement collections and stacks.
- WEB-013: Implement publisher page.
- WEB-014: Implement Codex connect flow.
- WEB-015: Implement trust and methodology pages.
- WEB-016: Implement docs navigation and search.
- WEB-017: Implement SEO and sitemap.
- WEB-018: Implement grade badge.
- WEB-019: Implement complete state matrix.
- WEB-020: Run responsive, overflow, keyboard, screen-reader, and reduced-motion QA.
- WEB-021: Implement Supabase-backed `/skills` list and permanent detail vertical slice without fixture fallback.
- WEB-022: Implement account, saved-skill, auth-error, and missing-configuration states.
- WEB-023: Publish source coverage, crawl failures, eligibility, and freshness UI.

### Publisher and administration

- PUB-001: Implement authentication.
- PUB-001A: Implement GitHub OAuth through Supabase SSR, exact callbacks, verified claims, sign-out, and private/no-store auth responses.
- PUB-002: Implement publisher and member roles.
- PUB-003: Implement repository and domain claim proof.
- PUB-004: Implement submission wizard.
- PUB-005: Implement live validation findings.
- PUB-006: Implement submission status timeline.
- PUB-007: Implement update and deprecation flow.
- PUB-008: Implement appeal flow.
- PUB-009: Implement publisher notifications.
- ADM-001: Implement review queue.
- ADM-002: Implement license and provenance case view.
- ADM-003: Implement security finding view.
- ADM-004: Implement duplicate and relationship review.
- ADM-005: Implement grade run inspection.
- ADM-006: Implement job replay.
- ADM-007: Implement quarantine and revocation.
- ADM-008: Implement takedown.
- ADM-009: Implement audit log.
- ADM-010: Enforce operator MFA and privileged-action policy.
- ADM-011: Use fresh relational operator roles and `aal2` for consequential writes; never authorize from user metadata.

### Security, privacy, and legal

- SEC-001: Implement Markdown sanitization.
- SEC-002: Implement SSRF-safe source fetching.
- SEC-003: Implement secret scanning.
- SEC-004: Implement script and binary inventory.
- SEC-005: Implement prompt-injection finding rules.
- SEC-006: Implement worker sandbox and egress policy.
- SEC-007: Implement signing-key management.
- SEC-008: Implement transparency and revocation log.
- SEC-009: Add abuse rate limiting.
- SEC-010: Complete dependency and container scanning.
- SEC-011: Complete external security review.
- SEC-012: Prove no secret/service key enters browser bundles, logs, screenshots, or public artifacts.
- SEC-013: Prove all exposed Supabase tables/views have explicit grants, RLS, indexed ownership predicates, and adversarial policy tests.
- LEG-001: Approve redistribution policy.
- LEG-002: Approve publisher submission agreement.
- LEG-003: Implement attribution generation.
- LEG-004: Implement metadata-only listing.
- LEG-005: Publish takedown and appeal process.
- PRV-001: Implement consent and retention controls.
- PRV-002: Verify raw prompts are absent from default telemetry.
- PRV-003: Implement data deletion and account export.

### Launch and operations

- OPS-001: Establish dashboards and alerts.
- OPS-002: Implement structured redacted logs and traces.
- OPS-003: Exercise backup and restore.
- OPS-004: Exercise signing-key rotation.
- OPS-005: Exercise critical revocation.
- OPS-006: Exercise takedown.
- OPS-007: Define on-call and escalation.
- OPS-008: Publish service status.
- OPS-009: Exercise independent Supabase Storage export and restore; database backups do not satisfy this gate.
- OPS-010: Approve Supabase/Vercel production plans, team ownership, regions, spend controls, secrets, domain, and OAuth redirects before deployment.
- DOC-001: Rewrite README around the end-to-end product.
- DOC-002: Publish architecture and data-flow diagrams.
- DOC-003: Publish package, index, route-plan, and grade specifications.
- DOC-004: Publish contribution and governance docs.
- DOC-005: Publish local connect, disconnect, update, and rollback docs.
- LCH-001: Curate founder corpus.
- LCH-002: Complete every required corpus evidence field.
- LCH-003: Run install and onboarding pilot.
- LCH-004: Run search relevance and overlap pilot.
- LCH-005: Run accessibility and performance audit.
- LCH-006: Produce launch gate evidence report.
- LCH-007: Verify public site and repository release independently.
- LCH-008: Publish declared-source adapter coverage and disposition every discovered record.

## Test and Validation Strategy

### Contract tests

- schema compatibility across CLI, API, web, worker, and fixtures
- explicit local/hosted ID-domain and alias/tombstone vectors
- direct public API and server-rendered UI payloads validate against the same hosted schemas
- golden serialization and digest vectors
- signature verification vectors
- backward and forward compatibility behavior
- OpenAPI conformance

### Package security tests

- path traversal
- absolute paths
- symlink escape
- duplicate normalized paths
- Unicode normalization collision
- archive bomb
- excessive file count
- oversized file and response
- binary and executable detection
- tampered manifest
- tampered body
- stale or revoked signature key
- TUF rollback, freeze, mix-and-match, expiry, threshold, rotation, and recovery cases
- raw source snapshot and normalized artifact digest confusion cases

### Router tests

- exact and paraphrased single intent
- wrong platform
- wrong framework
- alternative tie
- complementary coverage
- prerequisite
- conflict
- redundancy
- global guardrail
- final review
- ordered three-paragraph prompt
- ambiguous prompt
- no-match abstention
- revoked and policy-blocked candidate
- performance at index-size milestones

### Grade tests

- deterministic hard gates
- weight and band boundaries
- missing evidence
- confidence calculation
- receipt binding
- invalidation on each governing input
- stale status propagation
- appeal and rerun without history mutation
- no-skill and previous-version baseline binding
- held-out split, repeated-trial, variance, confidence, and cost evidence
- seeded/unreceipted data remains visibly ungraded

### API and data tests

- local Supabase `db reset`, `db lint`, generated type drift, and pgTAP database tests
- anonymous, authenticated owner, cross-user, publisher member, worker, and operator role matrix
- direct-table, security-invoker view, REST/API, and UI leak tests
- drafts, quarantine, revocation, legal unavailability, tombstones, and private evidence never leak
- user-owned profile and saved-skill isolation
- GitHub callback next-path validation, expired/spoofed session, verified-claims, and logout behavior
- update policies include select, using, and with-check behavior
- missing Supabase configuration fails visibly with no fixture substitution
- no secret/service key appears in browser bundles, logs, responses, fixtures, or screenshots
- idempotent mutation
- cursor pagination
- concurrent publication
- outbox delivery
- search reconciliation
- audit completeness
- backup restore
- future tenant isolation before private beta

### Browser tests

- public search and permanent detail against a real local Supabase seed
- GitHub sign-in/sign-out and saved-skill flow when provider credentials are available; otherwise code/RLS is locally validated and live auth remains explicitly blocked
- account isolation and unauthorized redirect states
- missing-configuration and backend-unavailable states
- public search to verified load flow after Phase 2
- direct skill URL
- compare
- grade evidence
- revoked skill
- publisher submission
- operator review
- connect Codex
- mobile 320 and 390
- tablet and desktop
- keyboard-only
- screen-reader sampling
- reduced motion
- slow network and API failure

### Operational tests

- object storage unavailable
- search unavailable
- worker queue backlog
- webhook replay
- source host rate limit
- database failover and restore
- independent Storage export and restore
- free-tier pause/recovery is not treated as an SLO proof
- duplicate/missed webhook reconciliation and DLQ replay
- signing-key rotation
- critical revocation propagation
- CDN serving stale artifact
- hosted outage while local cache routes and loads

## Launch Acceptance Criteria

### Corpus and trust

- 100 percent of public versions have source repository, exact commit, source path, digest, publisher, license state, permissions, host profile, and current grade receipt.
- Every approved source adapter has a current coverage receipt, every discovered record has a disposition, and the UI exposes crawl failures and freshness.
- “All skills” claims are scoped to the declared source universe and linked to its coverage report.
- No public version has an unresolved critical or high blocking security finding.
- No mirrored body has unclear redistribution authorization.
- Grade receipts verify with the open-source client.
- Stale, provisional, deprecated, blocked, and revoked states render correctly.
- Publisher identity, provenance, audit, compatibility, grade, advisory, and popularity remain separate evidence states.

### Routing and context

- Single-intent benchmark meets the approved primary-skill accuracy target.
- Multi-intent benchmark covers all requested segments and preserves order.
- Wrong-platform and wrong-framework rates meet approved limits.
- Redundant skill count and conflict rate meet approved limits.
- The loader returns only the selected SKILL.md and requested references.
- Measured context reporting proves that unselected bodies are absent.
- Local route and cached load operate during a registry outage.

Final numeric routing thresholds must be set from a frozen representative evaluation set during Phases 4 and 5 rather than invented after results are known.

### UI and UX

- Search, filters, skill page, compare, connect, trust, docs, and publisher paths work against live registry data.
- Public reads work without login; GitHub-authenticated users can save, submit, and maintain only authorized records.
- No prominent control is a false affordance.
- First Codex connection completes in under five minutes in moderated testing.
- At least four of five new users reach a routed and loaded skill within fifteen minutes without operator intervention.
- All required page states exist.
- No text overlap or horizontal clipping at 320px, 390px, tablet, or desktop.
- WCAG 2.2 AA checks pass.
- Search and public page performance budgets pass or have approved exceptions.

### Backend and operations

- Publication is immutable and idempotent.
- TUF metadata and artifact/attestation verification are mandatory.
- Database backup/restore and independent Storage export/restore are tested.
- Exposed Supabase grants, RLS, view security, ownership predicates, and role isolation pass database-level adversarial tests.
- No secret/service key is present in client code or public artifacts.
- Revocation reaches supported clients within the approved objective.
- Source update invalidates and requeues affected grades.
- Operator actions are audited.
- No routine workflow requires direct production database edits.
- Logs and telemetry pass privacy canary tests.
- P0 and P1 launch findings are zero.
- Public SLOs are backed by an approved non-pausing infrastructure plan and sufficient backup/log retention; free-tier availability is not used as evidence.
- No Stripe, billing, checkout, subscription, entitlement, metering, or paywall surface exists in the launch release.

### Repository and launch

- README, architecture, specifications, quick start, screenshots, examples, contributing, governance, security, support, and roadmap are current.
- Public commands were tested from a clean machine or container.
- Website and repository releases are verified as separate artifacts.
- Legal policies are published.
- Service status and support intake are operational.
- Launch metrics are derived from real production records and labeled accurately.

## Release Gates

### Gate A: Contract complete

- Phase 0 exit criteria pass.
- Owner-approved Supabase, free-to-users, Stripe-deferred, identity, source-coverage, and evidence boundaries are reflected in checked-in contracts.

### Gate B: Online catalog/account spine complete

- Phase 1 exit criteria pass.
- Real local Supabase data powers anonymous catalog and isolated account workflows with no fixture fallback.
- This gate is locally validated until project provisioning, OAuth, and deployment receive separate approval.

### Gate C: Safe package and loader complete

- Phase 2 exit criteria pass.
- TUF metadata, packages, cache, pins, route/load, and tamper cases pass.
- Broad local skill removal or disabling remains optional and reversible, never a prerequisite.

### Gate D: Registry operations alpha

- Phase 3 exit criteria pass.
- First-party sources crawl, ingest, audit, publish, update, reconcile, revoke, and restore through queue/worker state.
- Access is internal only.

### Gate E: Trust and router beta

- Phase 4 and Phase 5 exit criteria pass.
- Grade, compatibility, relationship, freshness, route-plan, loader, and Codex plugin systems operate on a bounded seed corpus.
- External claims remain limited.

### Gate F: Private product beta

- Phase 6 exit criteria pass; complete public/publisher/operator website flows run behind controlled access.
- Pilot publishers and users complete workflows.

### Gate G: Public launch

- Phase 7 acceptance and operational signoff pass.
- Approved infrastructure, declared-source coverage, website, registry, TUF/artifacts, plugin, documentation, and open-source release are synchronized and live-smoked.

### Gate H: Future commercial beta

- Separate Phase 8 plan, tenant security review, product/pricing approval, Stripe approval, reconciliation tests, and support readiness pass.

## Rollout and Cutover

1. Local Supabase online-spine acceptance
   - seed only SkillMap-owned, clearly licensed records
   - validate API, SSR UI, auth shell, account isolation, RLS, contracts, and failure states against the real local database
   - do not call this deployed or live

2. Private hosted alpha
   - obtain owner approval for Supabase organization/region/project cost and Vercel team/plan/project
   - configure GitHub OAuth, exact redirects, secrets, migrations, first-party seed, backup/export, and live smoke checks
   - expose only first-party records to invited testers

3. Curated invited publishers
   - small legally clear set
   - exercise claims, feedback, appeals, and updates

4. Read-only public preview
   - pages indexed selectively
   - connection offered to a waitlisted cohort

5. Public beta
   - full curated corpus
   - no paid tier
   - visible beta evidence and support expectations

6. General public release
   - service objectives and operational gates active
   - stable v1 contracts

7. Future paid private beta
   - isolated organizations and Stripe only after the separate Phase 8 plan and approval

Rollback:

- public website can display maintenance state without corrupting packages
- registry API read traffic can fall back to cached immutable objects
- clients retain a last-known-good TUF-verified index and cache within its documented freeze window
- publication can pause independently of public reads
- a bad version can be revoked without deleting unrelated skills
- a bad index can roll forward to a corrected monotonically newer index

## Risks and Mitigations

### Risk: universal catalog overwhelms local context

Mitigation:

- compact metadata only
- sharded index at scale
- progressive load
- explicit context measurements in acceptance

### Risk: grading appears arbitrary or pay-to-win

Mitigation:

- public rubric
- signed receipts
- dimension evidence
- independent calibration
- no paid grade changes
- formal appeal

### Risk: wrong skill among close alternatives

Mitigation:

- hard constraints
- relationship graph
- negative and near-miss evaluations
- minimal portfolio selection
- compare UI
- clarification

### Risk: long prompts lose chronology

Mitigation:

- source spans
- ordered segments
- explicit dependencies
- load scopes
- multi-intent evaluation

### Risk: third-party content creates legal exposure

Mitigation:

- license gate
- publisher authorization
- metadata-only mode
- attribution
- takedown
- counsel review

### Risk: malicious skill compromises users

Mitigation:

- inert package handling
- scripts never auto-run
- permissions
- scans and human review
- signatures
- revocation
- clear limitation language

### Risk: hosted service becomes a prompt-surveillance layer

Mitigation:

- local deterministic route
- raw prompts off-cloud by default
- redacted aggregate feedback only
- explicit hosted-playground consent
- privacy canary tests

### Risk: open source makes the business indefensible

Mitigation:

- monetize maintained data, operations, private governance, and service quality
- keep contracts open to build trust and adoption
- invest in corpus, relationships, evidence, freshness, and publisher network

### Risk: too much scope delays launch

Mitigation:

- strict must, should, and defer boundary
- curated corpus
- Codex-only host profile
- no billing
- phase gates
- data contracts before large UI expansion

### Risk: current app architecture is over-refactored

Mitigation:

- incremental extraction
- preserve existing local services
- add packages only for real shared consumers
- compatibility tests

### Risk: Supabase RLS or key misuse exposes account or unpublished data

Mitigation:

- explicit API/private schema boundary
- least-privilege grants and RLS on every exposed object
- fresh relational membership checks
- pgTAP plus direct-table, REST, API, and browser adversarial tests
- publishable key only in browser code
- secret/service keys isolated per trusted component with bundle/log canaries
- independent auth/data security review before public release

### Risk: free infrastructure is mistaken for production reliability

Mitigation:

- label Free as development/private-alpha only
- separate free-to-users policy from infrastructure budget
- approve non-pausing Supabase/Vercel plans before public release
- exercise database and independent Storage restore
- set spend controls and recheck current prices at provisioning
- never claim SLO, backup, or log-retention coverage from local/free checks

### Risk: “all skills” becomes an unprovable or legally unsafe promise

Mitigation:

- declared source universe and versioned adapters
- public crawl coverage, failure, disposition, and freshness receipts
- metadata-only mode for unclear redistribution rights
- initial 150-to-300 fully evidenced milestone without a permanent ceiling
- no literal global-exhaustiveness marketing claim

## Dependencies

External:

- source host APIs and webhook reliability
- Supabase Auth, Postgres, Storage, Queues, Cron, Edge orchestration, plan limits, and platform availability
- Vercel Next.js delivery after team/plan approval
- a constrained Node worker deployment target before heavy-job beta
- GitHub OAuth app, exact callbacks, webhook signatures, source APIs, and reconciliation
- signing-key management
- TUF root/online key custody and optional Sigstore integration
- legal review
- independent security review
- current Agent Skills and Codex plugin/connector behavior

Internal:

- existing deterministic routing core
- existing local connector and dashboard contracts
- package and schema extraction
- stable product design system
- curated first-party skill inventory
- shared hosted catalog and evidence contracts
- Supabase migration/RLS/backup discipline
- owner availability for corpus and business decisions

## Owner Decision Log

Closed decisions:

1. Launch corpus target
   - Decision: 150 to 300 completely evidenced versions is the first public milestone; ongoing scope is all records in the declared source universe with explicit dispositions.

2. Backend platform
   - Decision: Supabase Auth, Postgres, Storage, Queues, and Cron. Edge Functions are short orchestration only; heavy jobs use a separate worker.

3. Authentication
   - Decision: GitHub OAuth through Supabase is the primary launch login; public reads are anonymous; public identity is separate from private profile data.

4. Redistribution posture
   - Decision: mirror only clearly permitted or explicitly submitted bodies; otherwise publish metadata and source links only.

5. Grade presentation
   - Decision: letter band plus dimensions, baseline, confidence/variance, hard gates, and evidence; never a lone score or safety certificate.

6. Popularity signal
   - Decision: not part of launch grading or routing; display later only with gaming controls and a disclosed definition.

7. Hosted playground retention
   - Decision: no raw-prompt retention by default and explicit opt-in for feedback.

8. Billing
   - Decision: no launch billing. Stripe is the selected future provider only after a separate plan and approval. Public downloads and core trust evidence stay free.

Open production decisions:

9. Vercel team/plan and canonical web host
   - Preferred: Vercel for Next.js; do not assume Hobby is valid for a professional product.

10. Supabase organization, region, project name, and public-release plan
   - Use local Supabase for implementation. Project creation, cost, region, and remote migrations require explicit approval.

11. Heavy worker provider
   - Choose a Node 24 container target before Phase 3 deployment; keep the queue/job contract provider-neutral.

12. Domain and brand
   - Choose canonical web, API, artifact, status, and documentation hosts before public URL contracts harden.

13. Governance
   - Decide rubric maintainers, security response owner, license reviewer, appeal reviewer, TUF root custodians, and release operators before beta.

## Planning Receipt

- Route: `planning-orchestrator`, fed only by the frozen verified-research dossier and current repository truth.
- Plan status: frozen for implementation of Phase 1 on 2026-07-11.
- Selected slice: Supabase-backed online catalog and account spine.
- Evidence tier: HIGH because the slice touches authentication, authorization, RLS, migrations, public API contracts, account data, and user-facing behavior.
- Source-of-truth owners: checked-in contracts and migrations; local Supabase for implementation evidence; remote Supabase only after provisioning approval; existing root CLI/local connector remain owners of local behavior.
- Contract boundary: hosted `api`/`private` schemas, public catalog APIs/UI, Supabase SSR account session, and user-owned saved skills. No package loader, ingestion automation, grade engine, advanced router, operator console, third-party corpus, deployment, or billing claim is included.
- Displaced path: hosted routes may not read fixture data; `/dashboard` remains the explicit local fixture/snapshot path.
- Cutover: no public cutover in this slice. Remote project creation, OAuth, migrations, domain, and deploy remain separately gated.
- Acceptance evidence: contract tests, local Supabase reset/lint/pgTAP, direct RLS/API probes, server-rendered list/detail/account output, browser states, build/lint/typecheck, secret canaries, and regression checks.
- Validation blockers known before implementation: no SkillMap remote Supabase project, GitHub OAuth app, Vercel project, canonical domain, or approved infrastructure plan exists.
- Stop conditions: identity ambiguity, silent fixture fallback, unverifiable RLS, fabricated grades, unclear seed license, service-key exposure, or need for remote/cost-bearing mutation.

## Recommended First Implementation Slice

Do not start with the public homepage.

Start with the smallest real online product path:

1. Add shared hosted skill, list, grade/evidence-state, and API contracts with explicit local/hosted ID namespaces.
2. Pin Supabase JS/SSR dependencies, require Node 22 or newer for the web/hosted lanes, and add local Supabase configuration.
3. Add migrations, explicit API/private schemas, grants, RLS, indexes, deterministic seed, generated types, database lint, and pgTAP tests.
4. Model private profiles, public publishers, memberships, source repositories, skills, immutable versions, truthful grade state, saved skills, and private audit events.
5. Seed three first-party, clearly licensed versions:
   - two overlapping alternatives
   - one complementary or guardrail skill
   - exact commit/path and entrypoint-content digest, with raw-snapshot and normalized-artifact fields permanently null on these metadata-only identities; later packaging mints new admitted versions and receipts
   - explicit license state plus truthful `unverified`, `ungraded`, `not-run`, and `not-tested` evidence states
6. Implement a server-only Supabase catalog repository and bounded public list/detail APIs.
7. Render server-side `/skills` search and `/skills/[publisher]/[slug]` from the same contracts and real local database.
8. Implement Supabase SSR clients, Proxy refresh, GitHub login/callback/sign-out, `/account`, save/unsave, and `/account/saved`.
9. Point the landing page at the directory while preserving `/dashboard` as the separate local fixture/snapshot viewer.
10. Prove anonymous visibility, cross-user isolation, catalog write denial, lifecycle leak prevention, missing-config failure, and secret absence at database, API, and browser layers.

This slice proves that SkillMap has a real hosted-data product spine and that free accounts have a concrete purpose. It deliberately does not claim that package loading, automated ingestion, auditing, grading, updates, the advanced router, publisher submission, operator workflows, or full declared-source coverage are already complete.

## Implementation Orchestrator Handoff

### Starting instruction

Invoke implementation-orchestrator against:

docs/plans/2026-07-11-skillmap-hosted-skill-library-launch-implementation-plan.md

### First pass

- verify branch and worktree
- reread repository AGENTS.md, README.md, package scripts, current schemas, MCP connector, local server, and web contracts
- create an implementation ledger beside this plan
- ledger path: `docs/plans/2026-07-11-skillmap-hosted-skill-library-launch-implementation-plan-implementation-ledger.jsonl`
- consume the verified research dossier and freeze the Phase 1 implementation contract before editing
- implement on a `codex/` branch
- preserve all unrelated user work
- use local Supabase and a deterministic first-party seed
- do not create a remote project, migrate production, deploy, ingest third-party bodies, change repository visibility, or add billing without explicit approval

### Recommended batch order

1. Hosted public contracts, ID domains, fixtures, and contract tests
2. Supabase config, migration, API/private schema, grants, RLS, seed, generated types, lint, and pgTAP
3. Supabase SSR clients, Proxy, GitHub auth callback/sign-out, missing-config behavior, and auth-negative tests
4. Server-only catalog repository and bounded public APIs
5. Server-rendered catalog list/detail UI and truthful evidence states
6. Account, save/unsave, saved-skills UI/actions, and cross-user isolation
7. Landing navigation, README/environment/operations docs, and CI Node/runtime updates
8. Browser, accessibility, responsive, performance, secret-canary, adversarial RLS, regression, and cleanup acceptance

### Verification after every batch

- focused unit tests
- contract and golden tests
- typecheck
- lint where relevant
- build
- git diff --check
- privacy and secret canaries
- Supabase reset, lint, generated-type drift, and pgTAP/RLS tests
- direct-table, view, REST/API, and UI lifecycle-leak probes
- browser verification for UI batches
- explicit statement of validated locally, verified live, pushed, deployed, blocked, and next step

### Implementation stop conditions

Stop and request owner direction if:

- package identity must change after publication work begins
- a third-party body lacks clear redistribution rights
- implementation requires uploading raw prompts by default
- the proposed host integration cannot progressively load content
- a provider choice creates irreversible cost or lock-in beyond the approved architecture
- a remote Supabase/Vercel project, paid plan, domain, OAuth app, or production migration is required before local acceptance
- RLS cannot prove cross-user isolation or unpublished/lifecycle-state non-disclosure
- hosted routes require a silent fixture fallback
- any seed would need a fabricated grade or unclear license
- a security control requires executing untrusted code
- launch scope expands into billing, enterprise, or publisher payments

## Phase 0 Contract and Architecture Receipt — 2026-07-11

Status: accepted as the controlling contract baseline for the first hosted slice. Later phases must version these artifacts rather than silently widening Phase 1 truth.

Materialized deliverables:

- `docs/specs/hosted-identity-v1.md`
- `docs/specs/package-format-v1.md`
- `docs/specs/registry-tuf-profile-v1.md`
- `docs/specs/route-plan-v1.md`
- `docs/specs/grade-receipt-v1.md`
- `docs/specs/evidence-states-v1.md`
- `docs/specs/host-profile-v1.md`
- `docs/specs/source-coverage-receipt-v1.md`
- `docs/specs/advisory-v1.md`
- `docs/architecture/hosted-registry.md`
- `docs/security/hosted-threat-model.md`
- `docs/decisions/2026-07-11-hosted-architecture.md`
- `docs/decisions/2026-07-11-hosted-legal-boundary.md`

The checked-in hosted JSON Schemas, generated validators, Supabase migration/RLS matrix, research dossier, and these documents now jointly own Phase 0 truth. Package, TUF, route-plan, grade-receipt, compatibility-worker, publisher/operator, and remote-deployment behavior remains specified but unimplemented until its named phase exits.

## Phase 1 Merge and Local Acceptance Receipt — 2026-07-12

Status: implemented and independently accepted with documented risks against real local Supabase data. Hosted foundation PR #7 merged at `295dffe031d3010bb241ade75e9f249c97cd6063`; acceptance reconciliation PR #8 and the late-review accessibility follow-up PR #9 produced final accepted product anchor `f9ea0fa0d9711b5b0a61d24555ed9102fff20eb3`. Seed-anchor PR #5 is merged and the catalog remains bound to permanent squash commit `d1c23990af82d1c8c99997cb8d9a2c23707d91fa`. Gitea exact-feature run 18 and final-product-main run 19 passed both required jobs; canonical `main` on GitHub and Gitea contains the final product anchor, branch protection is restored, and temporary synchronization credentials are removed. GitHub Actions remains blocked before execution by the organization spending limit. Nothing in this receipt is a production, deployment, remote OAuth, or public-launch claim.

Implemented:

- distinct hosted skill, list, grade/evidence, and API response contracts with generated root/web consumers
- three checked-in first-party MIT skills permanently pinned to reviewed squash commit `d1c23990af82d1c8c99997cb8d9a2c23707d91fa` from seed-anchor PR #5, including the recomputed supply-chain entrypoint digest after review hardening
- explicit Supabase `api` and non-exposed `private` schemas, deterministic deployable first-party seed separated from non-discoverable test-only fixtures, immutable public/source coordinates, composite publisher/repository ownership, grants, forced RLS, security-invoker/barrier views, full-text search, indexes, and generated database types
- truthful Phase 1 trust limits: publisher/provenance remain `unverified`, audit `not-run`, compatibility `not-tested`, grade `ungraded`, package digest fields remain permanently null for these metadata-only version identities, and positive evidence promotions are database-blocked until receipt models exist; Phase 2 must mint new package-version identities rather than completing these rows in place
- anonymous no-store catalog repository, bounded cursor search, `/api/v1/skills` list/detail, generic hidden/nonexistent `404` parity, and explicit missing-config `503`
- server-rendered `/skills`, skill detail, GitHub OAuth integration points, root Proxy session refresh, same-origin callback/sign-out, free `/account`, save/unsave, and 50-row keyset-paged saved-skill projection with invalid/deep-page recovery
- landing navigation, Node 22+ web boundary, pinned Supabase JS/SSR dependencies, local operations docs, a required Gitea root/web plus database/RLS/type CI lane, and separate full-stack local API/auth acceptance gates

Final local and hosted-CI evidence:

- root regression suite: 328/328 tests passing
- contract and seed-integrity suite: 32/32 tests passing
- local and final-product Gitea hosted boundary suite: 14/14 tests passing, including the streaming-fallback landmark and announcement regression
- `supabase db reset --local`: passing
- `supabase db lint --local --level warning`: no schema errors
- pgTAP grants/RLS/identity/lifecycle/trust tests: 96/96 passing under full Supabase test discovery
- direct PostgREST: three published seeds and private schema HTTP `406`
- manually run local production-server hosted API smoke: list, stable cursor, search, malformed input, hidden/nonexistent parity, truthful detail state, and secret canary passing
- missing configuration: API `503`; UI explicit unavailable/no-fixture-fallback state
- manually run local authenticated production-server browser smoke: account route, save, saved projection, unsave, 52-row same-timestamp keyset pagination without gaps or duplicates, revocation filtering between pages, forged-session rejection, logout/cookie clearing, signed-out redirect, private/no-store cache policy, mobile accessible navigation name, 390px containment, and test-user/fixture cleanup passing; the local service-role key is confined to that test process and is not inherited by Next.js
- exact-tree targeted hosted-route QA: `/skills`, a skill detail, and `/sign-in` passed 9/9 route-by-viewport checks at 320px, 390px, and 1440px with one settled `main`/`h1`, named navigation and controls, visible first-Tab focus, no horizontal overflow, and no console diagnostics
- the root streaming fallback now uses a polite status container instead of a second `main` landmark and does not mark that live region busy, so assistive technology can announce it before unmount; a checked-in regression guards both semantics
- the existing performance harness passed 7/7 measured public/local routes (maximum LCP 168 ms, INP 56 ms, CLS 0, and route JavaScript 247,589 bytes); it does not include the hosted catalog routes, whose real-data Core Web Vitals remain explicitly gated below
- in-app Browser runtime was unavailable despite the installed plugin bundle, so the rendered pass used the repository-pinned Playwright runtime; live GitHub OAuth remains unverified until the remote provider exists
- independent engineering acceptance: accepted with risks after remediation of fabricated-grade authority, historical relationship contamination, search-copy mismatch, PostgREST and saved-list pagination truncation, repository credential-bearing URL admission, auth outage/session classification, same-origin callback normalization, production HTTPS configuration, deployable/test seed separation, mobile accessible naming, streaming-fallback landmark duplication, account outage behavior, privacy under-disclosure, and CI secret-scope findings
- CodeRabbit seed review: three untrusted-content and inert-review boundaries accepted, implemented, re-digested, and pushed to seed-anchor PR #5
- PR #7 review: CodeRabbit final success, all Codex findings resolved, and zero unresolved review threads at feature head `00e29a442b3ef03345f25970aa2abff4655d259d`
- PR #8/#9 closeout review: the late Codex loading-announcement P2 was accepted after PR #8 merged, fixed and independently re-accepted in PR #9, and closed with CodeRabbit success, Codex no-major-issue review, and zero unresolved current-head threads
- Gitea CI: exact-feature run 18 passed `1427e277e46315de5792a973deded1af4c274195`, and final-product-main run 19 passed `f9ea0fa0d9711b5b0a61d24555ed9102fff20eb3`; both commits have tree `be96e2a71f2b38ded52ac6e1077ebbcd1dc0bbc1` and passed `CLI contracts and web` plus `Hosted catalog migrations and RLS`. The workflow does not run `test:hosted-api` or `test:hosted-auth`, whose evidence above is from the explicit local acceptance run

Still gated:

- remote Supabase project/region/plan, GitHub OAuth app and exact callbacks, Vercel project/plan, canonical domain, remote migrations, deploy, and production checks
- professional Vercel ownership requires explicit approval of the current paid team charge; the isolated Supabase alpha organization/name and free-tier backup limitations must be accepted before remote creation
- real-data hosted catalog Core Web Vitals and full accessibility coverage remain a pre-remote-alpha gate; the checked-in Phase 1 browser smoke covers functional account, mobile navigation naming, and overflow
- revoked saved-skill tombstone/removal UX is required before Phase 3 enables public revocation workflows
- Phases 2 through 7: package/TUF loader, automated ingestion/update/audit/advisories, grading/compatibility, advanced router and Codex plugin, publisher/operator workflows, declared-source coverage, and production launch
- Stripe and all billing/entitlement work remain outside scope

## Definition of Done

SkillMap has come alive as the intended launch product when:

- the website is a real, searchable, comprehensive skill library
- the website and API expose every currently declared-source record with a truthful disposition and coverage receipt
- every public skill has a useful, trustworthy, permanent page
- users can compare overlapping skills and understand the recommendation
- Codex can connect through a small stable interface
- the library can be broad without the broad catalog entering every prompt
- single and multi-part prompts produce minimal, ordered skill plans
- only selected, verified skill content is loaded
- grades are reproducible, host-specific, version-bound, current, and explainable
- publishers can submit and update skills
- operators can review, revoke, restore, and audit without database surgery
- the launch corpus is legally eligible and fully evidenced
- the open-source repository can verify the hosted service core artifacts
- production, security, privacy, accessibility, operational, and new-user launch gates all pass
- future paid team capabilities can be added without weakening the public or local product
- every launch account and public feature remains free, with no Stripe or billing dependency
