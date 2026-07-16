# SkillMap Private Production Rehearsal Implementation Plan

## Planner Metadata

- Repository workspace: /home/codex/projects/skillmap
- Planning source of truth: origin/main at 0eb57ac7c3aeda0c907435210a748a5ffb3a259e
- Source tree: 2ca58122c830e81dcfe492f583e48c9cd06f2d3c
- Clean inspection worktree: /tmp/skillmap-product-receipt
- Plan artifact checkout: codex/hosted-library-foundation at 98c0e6775e52c9a6cf4c1c59c812c1569419104c
- Date: 2026-07-15
- Planning mode: full planning-orchestrator run
- Architecture amendment: Vercel Hobby private rehearsal and latency-first MCP hot path, accepted 2026-07-15
- Worker scopes:
  - Vercel and Cloudflare topology, provider constraints, latency, rollback, and observability
  - Supabase invite-only authentication, RLS, account isolation, and MCP authorization
  - Product efficacy, protocol, recovery, private-pilot, and public-promotion acceptance
- Implementation status: not started
- Provider mutation status: no accounts, projects, DNS records, deployments, secrets, or billing state changed

### References inspected

Repository:

- README.md
- package.json and apps/web/package.json
- apps/web/proxy.ts
- apps/web/app/sign-in
- apps/web/app/auth/callback/route.ts
- apps/web/lib/supabase
- apps/web/lib/registry/repository.server.ts
- apps/web/lib/security
- apps/web/scripts
- src/commands/mcp.ts
- supabase/config.toml
- supabase/migrations and supabase/tests
- docs/decisions/2026-07-11-hosted-architecture.md
- docs/security/hosted-threat-model.md
- docs/operations/hosted-alpha-deploy.md
- docs/operations/free-public-alpha-runbook.md
- docs/launch/hosted-alpha-pilot-runbook.md
- docs/launch/initial-corpus-operations.md
- docs/dogfood.md
- current aggregate .skillmap evaluation report, without exposing raw prompts

Current official platform sources:

- https://vercel.com/pricing
- https://vercel.com/docs/plans/hobby
- https://vercel.com/docs/git
- https://vercel.com/docs/deployments
- https://vercel.com/docs/deployment-protection
- https://vercel.com/docs/environment-variables
- https://vercel.com/docs/functions/configuring-functions/region
- https://vercel.com/docs/functions/runtimes/node-js/node-js-versions
- https://vercel.com/docs/domains/set-up-custom-domain
- https://vercel.com/docs/cli/rollback
- https://supabase.com/docs/guides/auth/general-configuration
- https://supabase.com/docs/guides/auth/auth-hooks
- https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook
- https://supabase.com/docs/guides/auth/auth-identity-linking
- https://supabase.com/docs/guides/auth/row-level-security
- https://supabase.com/docs/guides/api/securing-your-api
- https://supabase.com/docs/guides/auth/oauth-server
- https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication
- https://supabase.com/docs/guides/database/connecting-to-postgres
- https://supabase.com/docs/guides/platform/performance
- https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/
- https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/
- https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/
- https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
- https://developers.cloudflare.com/workers/wrangler/environments/
- https://developers.cloudflare.com/workers/configuration/secrets/
- https://developers.cloudflare.com/workers/versions-and-deployments/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/workers/configuration/placement/
- https://developers.cloudflare.com/workers/static-assets/binding/
- https://developers.cloudflare.com/r2/examples/cache-api/
- https://developers.cloudflare.com/cloudflare-one/access-controls/authenticate-agents/

### Assumptions

- The private rehearsal is explicitly a personal, non-commercial hobby project and therefore uses Vercel Hobby at zero Vercel subscription cost.
- The canonical GitHub repository is private and organization-owned, which Vercel Hobby cannot connect to directly. Vercel deployment therefore uses an unlinked Hobby project and an exact-candidate owner-controlled CLI deployment; the repository is not made public or mirrored merely to satisfy Git integration.
- Vercel upgrades to Pro before any public-read, public-signup, public-indexing, collaboration, or commercial promotion step.
- Supabase Pro is approved and existing credit may be used, subject to an explicit spend ceiling.
- Cloudflare Workers, DNS, KV/R2, Access, and their exact paid/free plan remain subject to measured usage and an owner-approved ceiling.
- The private cohort is five named testers.
- The product remains free to users. Billing, checkout, entitlement, metering, subscriptions, and Stripe remain absent.
- The intended production domains will be used during rehearsal so callbacks, cookies, CSP, DNS, and MCP client behavior are representative.
- Third-party skill bodies are not mirrored or returned unless redistribution and publisher authority are explicitly proven.

## Executive Goal

Deploy SkillMap as a real, production-shaped but invite-only product:

- Next.js web application on Vercel Hobby during the private rehearsal, upgraded to Pro before public promotion;
- Supabase Pro for Auth, Postgres, API, RLS, account data, submissions, audits, and grades;
- a stateless Streamable HTTP MCP server on Cloudflare Workers;
- compact immutable edge metadata in KV/cache and authorized digest-bound skill content in R2;
- real domains, TLS, OAuth, logging, rollback, backup, and operational workflows;
- public account creation, anonymous product access, and indexing disabled;
- five approved testers exercising the exact product and MCP workflows;
- efficacy, audit, grade, latency, security, recovery, and usability measured before public promotion.

The private environment is a release rehearsal, not a public launch. Public promotion requires a separate receipt after every frozen gate passes.

## Source Of Truth Contract

- Intent: create a production-like invite-only SkillMap environment that can prove the real product before public signup and indexing.
- Current behavior: the hosted web candidate has public catalog projections and GitHub OAuth account features; only account routes are proxy-protected. Current MCP is local stdio JSON-RPC with six read-only metadata/routing tools. Hosted Streamable HTTP and load_skill do not exist.
- Expected outcome: an invited tester can sign in, browse/search, save, submit, review evidence, connect an MCP client, receive recommendations, choose a skill, open its web evidence, and load an exact authorized digest-bound skill. An anonymous or revoked actor cannot use any private-rehearsal product surface.
- Truth owner: the exact origin/main commit and tree, linked Supabase migration/type receipt, immutable Vercel deployment ID, Cloudflare Worker version, edge index/content digests, live route evidence, and independent acceptance receipt.
- Contract boundary:
  - Vercel owns the Next.js web/BFF request surface.
  - Supabase owns human identity, pilot membership, relational truth, RLS, account state, submissions, audit and grade records.
  - Cloudflare owns the remote MCP ingress, protocol handler, global rate control, edge index, immutable content delivery, and MCP observability.
  - The existing operator worker owns service-role-only ingestion, audit, grade, review, publication, edge export, and recovery. It is never in the interactive request path.
  - The local CLI remains the authority for prompt-private local inventory and deterministic local routing.
- Displaced path:
  - The private rehearsal displaces anonymous catalog access with an authenticated invite-only policy.
  - The hosted MCP adds a new remote transport; it does not replace or silently alter the existing local stdio connector.
  - The public cutover later restores anonymous public catalog reads and read-only MCP tools through an explicit tested mode transition.
- Cutover:
  1. closed mode while code and infrastructure are incomplete;
  2. invite-only mode with noindex and five testers;
  3. public-read mode with new signup still disabled;
  4. public signup;
  5. public indexing last.
- Acceptance evidence: route responses, API payloads, RLS rows, OAuth outcomes, MCP protocol traces, exact skill digests, rendered browser workflows, provider deployment/version IDs, backup/restore checksums, latency distributions, and redacted pilot receipts.
- Evidence lane: local deterministic gates, exact-candidate Gitea/GitHub CI, private live acceptance, five-seat pilot, independent promotion review.
- Kill criteria:
  - any unauthorized account creation or private product access;
  - any cross-account read/write or private-schema exposure;
  - any prompt, skill body, credential, token, email, or full-IP leak;
  - any accepted digest/signature mismatch or stale/revoked content delivery;
  - any skill script execution;
  - inability to roll back web, MCP, index, or database;
  - uncontrolled spend or quota growth;
  - unresolved P0/P1, trust, privacy, restore, or integrity finding.
- Forbidden moves:
  - no direct Vercel Hobby Git integration to the private organization repository and no public deployment mirror;
  - no public promotion while the Vercel project remains on Hobby;
  - no service-role key in Vercel, browser code, MCP request code, logs, screenshots, or CI artifacts;
  - no production Supabase credentials in preview deployments;
  - no hosted use of supabase/seed.sql;
  - no open signup window without an exact restricted enrollment boundary and cleanup receipt;
  - no hand-created publication rows or bypass of review/dual control;
  - no unversioned KV/R2 content pointer;
  - no mirrored third-party body without authority;
  - no public indexing or public announcement during rehearsal;
  - no claim that local or private evidence proves public launch.

## Native Planning Superiority

- Codex Native baseline: a generic outline would create Vercel, Supabase, and Cloudflare projects, disable signup, add a login, deploy, and test.
- What this plan does better:
  - anchors to the exact accepted source tree while preserving the divergent user checkout;
  - distinguishes account creation, website/API access, direct Data API access, and MCP access;
  - catches that disabling Supabase signup alone leaves the current anonymous catalog readable;
  - catches that Vercel Hobby cannot connect directly to this private organization repository and replaces that unsupported path with exact-candidate CLI deployment;
  - keeps Vercel off the MCP recommendation hot path and requires a precompiled edge index rather than a per-request catalog scan;
  - keeps the remote MCP and immutable loader as real product dependencies rather than infrastructure assumptions;
  - separates edge delivery from the service-role operator plane;
  - freezes measurable efficacy and recovery gates before results are known;
  - makes private-to-public cutover an explicitly rehearsed state machine.
- User-specific context used: free-to-user product, paid Supabase credit is acceptable, minimal latency is important, local deterministic routing must remain private/offline, and operational completion needs live evidence rather than setup claims.
- Superiority score target: 5/5.
- Proof artifacts: this plan, worker receipts, exact source anchor, current official provider documentation, task dependencies, kill criteria, and implementation-orchestrator handoff.

## Orchestration Decision

- Mode: full worker run.
- Worker count: three.
- Decision reason: independent provider, auth/data, MCP, efficacy, security, recovery, and promotion surfaces materially change the dependency order.
- Independent surfaces:
  - provider topology and plan limits;
  - invite-only identity/RLS/access;
  - protocol, efficacy, recovery, pilot, and promotion acceptance.
- Workers used:
  - plan_platform_topology;
  - plan_auth_access;
  - plan_validation_promotion.
- Workers skipped: UI redesign and marketing research, because the current task is deployment/access/validation planning rather than visual redesign or public acquisition.
- Thread decision: no visible threads; one parent-owned plan is the source of truth.
- Token/context rationale: three non-overlapping evidence lanes reduced duplicated repo inspection and allowed independent challenge of the signup and MCP assumptions.
- Reconsider trigger: add a focused planning lane only if the exact domain, provider account limits, target MCP client, or authorization model materially changes.

## Background Browser Lane

- Needed: no, not during planning.
- Target/surface: provider dashboards during implementation only.
- Safety boundary: read current state before any mutation; never display or retain secrets.
- Required receipt: project/plan/region/domain IDs and redacted configuration values, never credentials.
- Stop condition: missing auth, ambiguous account ownership, unexpected existing production resource, or any provider upgrade outside the approved ceiling.

## Research And Architecture Findings

### Vercel

Adopt:

- Hobby for the explicitly personal, non-commercial, invite-only rehearsal.
- An unlinked Vercel project deployed from the exact accepted candidate through Vercel CLI; the canonical private organization repository remains private and authoritative.
- Root Directory apps/web, Node 24.x, and the single Hobby function region selected closest to Supabase and the initial testers.
- Immutable deployment IDs, runtime logs, rollback target, quota monitoring, and app-level access receipts.

Adapt:

- Hobby-generated and custom-domain URLs remain internet-reachable. Use SkillMap’s application/API/RLS invite-only gate as the security boundary and test every direct URL.
- Vercel Hobby cannot import a private repository owned by a GitHub organization. Use owner-controlled CLI deployment with no Git integration; Vercel documents that CLI deployment works whether or not a project is connected to Git.
- Hobby permits one function region. Co-locate that region with Supabase for authenticated web/BFF traffic, while keeping MCP clients on the separate Cloudflare edge path.
- Keep Vercel Preview variables unset until a separate preview Supabase project exists.
- Upgrade to Vercel Pro before the first public-read, signup, indexing, collaboration, or commercial promotion step.

Avoid:

- Making the canonical repository public, or creating an unaudited deployment mirror, to work around Hobby Git restrictions.
- Treating Vercel plan level as an MCP latency control; MCP clients do not traverse Vercel.
- Cloudflare proxy/CDN in front of the Vercel web CNAME until a separate compatibility test proves it. Start DNS-only.

### Supabase

Adopt:

- Isolated Pro project, approved region, API schema only, GitHub OAuth, exact Site URL and callback.
- Active pilot membership independent of JWT age so revocation takes effect on the next protected request.
- Private operator provisioning/revocation RPCs and idempotent redacted CLI receipts.
- Before User Created hook as a supported fallback for an invite allowlist; Supabase documents this hook for invite-only beta policies.

Adapt:

- The current product has GitHub OAuth only. A normal email invitation flow has no matching UI.
- Preferred steady-state:
  1. pre-create the exact tester Auth identities;
  2. activate pilot membership;
  3. prove GitHub verified-email identity linking with global signup disabled;
  4. allow normal GitHub sign-in only for those users.
- If that live probe fails, use a fail-closed Before User Created allowlist hook for exact approved identities. Do not open unrestricted enrollment.
- Add access modes closed, invite-only, and public. Missing or inconsistent state behaves as closed.

Avoid:

- Treating the global signup toggle as the website, API, RLS, or MCP gate.
- Trusting a valid JWT alone for immediate revocation.
- Email, GitHub handle, raw OAuth metadata, or access tokens in pilot-membership tables or tracked receipts.

### Cloudflare

Adopt:

- Separate apps/mcp package and Streamable HTTP /mcp endpoint.
- Stateless createMcpHandler with a fresh server/transport per request; no Durable Object for read-only recommend/load tools.
- Worker Custom Domain such as mcp.<approved-domain>.
- Disable or protect workers.dev and preview routes so they cannot bypass the canonical gate.
- A build-time compiled routing artifact containing normalized terms, phrase keys, tier/policy flags, and an inverted term-to-skill index. Recommendation selects a bounded candidate set and never scans every skill body or catalog row.
- Bundle the compact routing index with the Worker while the measured compressed bundle/startup budgets pass; use one version-bound KV/cache read only after the catalog outgrows that budget. For the small private corpus, benchmark digest-named Workers Static Assets behind mandatory run_worker_first authentication against R2 plus Cache API; select the faster safe content mode and retain R2 as the scale/update fallback.
- Verify MCP credentials locally at the edge from cached signing material and a versioned revocation overlay. Do not call Supabase to authorize or recommend on a warm tool request.
- Emit telemetry and route events after the response with waitUntil or a bounded asynchronous sink; observability is not awaited on the recommendation hot path.
- Versioned Worker deploys, explicit index pointer rollback, rate limiting, redacted logs, and spend/quota alerts.

Adapt:

- For the five-seat rehearsal, Cloudflare Access OAuth or another MCP-client-compatible OAuth gate may restrict the remote endpoint.
- The preferred simple pilot boundary is Cloudflare Access if all intended clients complete its OAuth/PKCE flow. If a target client cannot, use a reviewed per-seat revocable token or Supabase OAuth 2.1; never insert an interactive HTML redirect that breaks the MCP protocol.
- Cloudflare Workers Free is acceptable only while the exact production bundle remains below 3 MB compressed, each request remains below the 10 ms CPU allowance with margin, and daily traffic remains below 100,000 requests. These are measured gates, not assumptions. Moving to Workers Paid removes the CPU/request ceiling risk but is not expected to reduce network latency by itself.
- Use Smart Placement only for a Worker path that genuinely must call a regional origin. The primary recommend/search path stays globally edge-local and therefore does not need placement near Supabase.
- Public promotion later makes only read-only recommend/search/load tools anonymous; account-write tools remain OAuth-protected.

Avoid:

- Supabase service-role in the Worker.
- Querying one Supabase region on every warm recommendation/load request.
- Parsing or normalizing the complete skill corpus, computing embeddings, or calling an LLM on each recommendation request.
- Global MCP server/transport reuse across requests.
- Logging task prompts or returned skill content.

## Current State

- Remote origin/main and Gitea main resolve to 0eb57ac7c3aeda0c907435210a748a5ffb3a259e with tree 2ca58122c830e81dcfe492f583e48c9cd06f2d3c.
- The user checkout is on an older, heavily divergent branch with user-owned dirty files. Implementation must start in a new clean worktree from origin/main.
- Existing source quality evidence is strong but historical: the accepted checkpoint recorded 448 root tests, 35 hosted-boundary tests, 47 release-path tests, 621 pgTAP assertions, three-browser auth, accessibility, visual, performance, security, package, and recovery gates.
- Current private-alpha environment values already fail closed for indexing, copy, robots, and X-Robots-Tag. They do not enforce access.
- apps/web/proxy.ts currently protects only /account.
- Public catalog repository reads deliberately use an anonymous Supabase client.
- Current Supabase policies allow anonymous reads of published catalog projections.
- Current OAuth callback creates a profile after any successful GitHub OAuth exchange and before pilot-membership validation.
- Local Supabase config is local-only and currently allows signup; it must not be pushed to hosted Supabase.
- Current MCP is stdio-style JSON-RPC and exposes route_prompt, search_skills, show_skill, show_skillgraph, doctor_summary, and source_status.
- Current rankRoutePrompt performs an O(number of skills times indexed text) scan. An indicative Node 24 benchmark on this host measured p95 2.510 ms for the current 150-skill catalog, 17.124 ms for 1,000 synthetic skills, and 115.862 ms for 5,000. This is local routing evidence, not Cloudflare-runtime proof, but it shows that the current scan does not fit the Workers Free 10 ms CPU budget at growth scale.
- Hosted recommend_skills, Streamable HTTP, immutable edge index, R2 content, and load_skill are not implemented.
- Current local eval evidence is demo-only: 150 untyped cases, zero release-counted cases, zero holdout, and leakage flags. It cannot authorize a pilot efficacy claim.
- The initial 20 external corpus candidates remain pending publisher authority and cannot be treated as an authorized body-loading corpus.
- The existing deployment runbook’s zero-cost-only provider language conflicts with paid Supabase, while its deployment assumptions must be updated for Vercel Hobby CLI deployment without organization Git integration.

## Future State

    Browser
      |
      v
    Final web origin --> Vercel Hobby / Next.js 16 / Node 24
      |                         |
      | Supabase browser JWT   | server-side public configuration only
      v                         v
    Supabase Pro Auth --> pilot membership --> API schema + RLS

    MCP client
      |
      | OAuth or approved per-seat pilot credential
      v
    mcp.<domain>/mcp --> stateless Cloudflare Worker
                            |              |
                            v              v
                       KV/index        R2/digest content

    Operator worker
      | service-role only
      +--> Supabase queue/audit/grade/publication
      +--> versioned edge export

The Vercel web and Cloudflare MCP share identifiers, evidence URLs, and immutable version/digest contracts. They do not share browser cookies, service credentials, or mutable request state.

### Environment Matrix

| Environment | Web | Database | MCP | Access | Purpose |
|---|---|---|---|---|---|
| Local | optimized next start | disposable local Supabase | Wrangler local bindings | test identities | deterministic preflight |
| Staging | app-gated Vercel Hobby generated URL | separate project only, otherwise absent | separate Worker/KV/R2 | operator only | deployment smoke |
| Private production | app-gated Vercel Hobby custom domain | isolated Supabase Pro | final MCP custom domain | five invited seats | real rehearsal |
| Public production | Vercel Pro after explicit upgrade gate | promoted public policies | read-only tools public | public read, OAuth write | later cutover |

## Non-Goals

- Public signup, public anonymous use, public indexing, acquisition, or marketing.
- Billing, subscriptions, usage metering, paid placement, or entitlements.
- Replacing the local CLI, local stdio MCP, passive hook, or local policy authority.
- Mirroring or loading a third-party body without redistribution and publisher authority.
- Running submitted scripts.
- Autonomous continuous operator mutation before the one-shot/manual workflow is accepted.
- Treating provisional numeric grades as current letter grades.
- Building team/enterprise features, SSO, or marketplace economics.

## Phase Plan

### Phase 0 — Freeze the rehearsal contract

| ID | Task | Depends on | Deliverable and pass condition |
|---|---|---|---|
| RHR-001 | Create a clean worktree and implementation branch from exact origin/main. Preserve the current checkout unchanged. | none | Branch and tree receipt match 0eb57ac and 2ca58122. |
| RHR-002 | Amend the hosted ADR, deployment runbook, threat model, and cost gate for Supabase Pro, Vercel Hobby through private rehearsal, Vercel Pro before public promotion, and Cloudflare. | RHR-001 | Reviewed provider decision; unsupported organization Git integration and obsolete zero-cost-only Supabase claims removed. |
| RHR-003 | Record Vercel, Supabase, and Cloudflare plan ceilings, owners, alerts, and shutdown authority. | RHR-002 | No uncapped or ownerless provider spend. |
| RHR-004 | Verify domain ownership and select final web/MCP origins, Supabase region, and the single Hobby function region after measured RTT. | RHR-002 | Exact origins/callbacks recorded; no wildcard callback; Vercel-to-Supabase p95 RTT target at most 75 ms; MCP clients route directly to Cloudflare. |
| RHR-005 | Freeze access modes, public exceptions, private routes, API error behavior, health behavior, and promotion sequence. | RHR-002 | Versioned route/access contract accepted. |
| RHR-006 | Freeze every efficacy, performance, privacy, recovery, pilot, and kill metric before measurement. | RHR-002 | Versioned metric contract and benchmark manifest. |
| RHR-007 | Freeze secret custody and environment matrix. | RHR-002 | Variable allowlist by provider/environment; no secret values in the artifact. |

Stop condition: plan/cost/domain/account ownership is ambiguous, the Hobby project is connected directly to the private organization repository, or public promotion is proposed before the Vercel Pro upgrade gate.

### Phase 1 — Implement invite-only identity and data access

| ID | Task | Depends on | Deliverable and pass condition |
|---|---|---|---|
| AUTH-001 | Add database access mode closed, invite-only, public with fail-closed default and mismatch health signal. | RHR-005 | Missing/invalid/mismatched mode denies access. |
| AUTH-002 | Add private pilot_membership keyed by auth user ID with active/revoked status and timestamps, no PII. | AUTH-001 | Table has forced RLS and no browser/direct grants. |
| AUTH-003 | Add bounded membership-check, provision, list, activate, and revoke RPCs. | AUTH-002 | Service-only mutations; authenticated membership read; idempotent receipts. |
| AUTH-004 | Add active-membership predicates to account RLS and private-mode catalog projections. | AUTH-002 | Anonymous, inactive, revoked, and cross-account calls are denied in invite-only mode. |
| AUTH-005 | Add pgTAP for anonymous, active, inactive, revoked, deleted, two-account, service-role, outage, and mode drift. | AUTH-003, AUTH-004 | Zero unauthorized row read/write and no private-schema exposure. |
| AUTH-006 | Build an operator-only tester provision/list/revoke CLI. Accept sensitive identity input through stdin and emit redacted receipts. | AUTH-003 | No email, provider metadata, or token in output/logs; compensation deletes a newly created Auth user if membership activation fails. |
| AUTH-007 | Add a Before User Created allowlist hook as a tested fallback for GitHub linking failure. | AUTH-003 | Exact allowlisted identity succeeds; all others fail before user creation. |
| AUTH-008 | Prove locally and then live that a pre-created confirmed tester can link GitHub OAuth while global signup is disabled. | AUTH-006 | One redacted linking receipt and no extra Auth user. |
| AUTH-009 | Configure steady-state hosted Auth: global new signup off, anonymous/email/phone/magic-link signup off, GitHub on, exact callbacks, manual linking off. | AUTH-008 | Existing invited tester signs in; unknown GitHub account creates no user. |

Stop condition: the only proposed enrollment path requires unrestricted signup, or revocation depends only on JWT expiry.

### Phase 2 — Enforce the private web and API gate

| ID | Task | Depends on | Deliverable and pass condition |
|---|---|---|---|
| WEB-001 | Extend apps/web/proxy.ts from /account to all hosted product routes in invite-only mode. | AUTH-003, RHR-005 | Only sign-in, callback, required OAuth discovery/consent, static assets, robots, and bounded health remain public. |
| WEB-002 | Separate HTML and API behavior: redirect signed-out HTML; return JSON 401/403/503 for APIs. | WEB-001 | No API returns an HTML login page; auth outage fails closed. |
| WEB-003 | Move pilot-membership validation ahead of profile insertion in the GitHub callback. | AUTH-003, WEB-001 | Unauthorized callback creates no profile and clears the session. |
| WEB-004 | Switch private-mode catalog reads to an authenticated membership-bound client; retain anonymous client only for public mode. | AUTH-004 | Direct anonymous PostgREST and Next API reads return no private-rehearsal catalog rows. |
| WEB-005 | Add invitation-only, access-denied, revoked, closed, and dependency-unavailable UI states; remove public signup copy. | WEB-003 | No false success, open-signup, or fixture fallback copy. |
| WEB-006 | Keep sitemap empty and robots/X-Robots noindex in closed/invite-only mode. | WEB-001 | Signed-out live response and direct files prove noindex. |
| WEB-007 | Add exact-host/callback validation and preserve CSP, no-store, CSRF, cookie, and security headers on redirects/errors. | WEB-001 | Host injection and callback manipulation tests fail closed. |
| WEB-008 | Extend browser and API gates for anonymous, invited, inactive, revoked, two-account, callback replay, and outage states. | WEB-001 through WEB-007 | Chromium, Firefox, WebKit, API, accessibility, and responsive tests pass. |

Stop condition: a Vercel generated URL, custom domain, direct API, or direct Supabase query bypasses the gate.

### Phase 3 — Implement hosted MCP and immutable loading

| ID | Task | Depends on | Deliverable and pass condition |
|---|---|---|---|
| MCP-001 | Create separate apps/mcp TypeScript/Workers package with pinned MCP SDK, Wrangler, contracts, and tests. | RHR-001 | No Next.js or service-role coupling. |
| MCP-002 | Freeze remote tool surface: recommend_skills, search_skills, show_skill_metadata, and digest-bound load_skill. | RHR-006, MCP-001 | Bounded JSON schemas, immutable IDs, reasons, evidence IDs, webUrl, pagination, and size limits. |
| MCP-003 | Implement stateless Streamable HTTP /mcp using fresh per-request server/transport instances. | MCP-002 | SDK client initializes/lists/calls; no cross-client leakage; no Durable Object. |
| MCP-004 | Build a deterministic publication-time routing compiler: normalized searchable fields, phrase keys, inverted token-to-skill postings, bounded candidate selection, index digest, revocation overlay, and last-known-good pointer. | MCP-002 | Same source produces the same bytes/digest; optimized recommendations are byte-equivalent to the reference scanner across the full eval and adversarial fuzz corpus. |
| MCP-005 | Bundle the compact routing index while compressed-size/startup budgets pass; add version-bound KV/cache fallback for larger indexes; benchmark authenticated digest-named Workers Static Assets against R2 plus Cache API for immutable authorized content. | MCP-004 | Warm recommend uses zero network/storage reads in bundled mode and at most one index read in KV mode; selected content mode has a measured cold/warm receipt; no Supabase request on recommend/load. |
| MCP-006 | Implement load_skill to return only the selected authorized SKILL.md bound to version/content digest through the accepted content mode. | MCP-005 | Static-asset requests always run auth first when that mode is selected; direct asset, tampered, missing, revoked, stale, oversized, or unauthorized loads fail closed; no script executes. |
| MCP-007 | Implement private-pilot MCP authorization using the selected client-compatible OAuth/token path, locally verified signing material, and a versioned edge revocation overlay. | AUTH-003, MCP-003 | Unknown/revoked seat denied; authorized seat allowed; no browser cookie, service role, or per-request Supabase authorization call. |
| MCP-008 | Protect/disable workers.dev and preview routes; attach final Worker Custom Domain. | MCP-007, RHR-004 | Canonical MCP host is the only accepted route. |
| MCP-009 | Add method/tool/user/client/network rate limits, input/output/time bounds, origin/host checks, and protocol-safe 401/403/429/503 responses. | MCP-003, MCP-007 | Abuse, malformed, oversize, timeout, and cancellation tests pass. |
| MCP-010 | Add redacted structured telemetry: request ID, method/tool, status, duration/CPU, version, index digest, cache outcome, pseudonymous subject; enqueue it after response with waitUntil or a bounded sink. | MCP-003 | No prompt, skill body, token, email, cookie, or full IP logged; telemetry failure does not delay or fail a successful recommendation. |
| MCP-011 | Add SDK conformance, MCP Inspector smoke, intended-client tests, concurrency, cancellation, cache, outage, stale-index, rollback, content-tamper, 150/1,000/5,000-skill CPU profiles, bundle-size checks, and cold/warm geo-latency harnesses. | MCP-006 through MCP-010 | One machine-readable conformance/security/performance receipt; Workers Free ceilings pass with margin or a reviewed paid/origin fallback is selected before deployment. |

Stop condition: remote tools expose unselected bodies, execute content, require a service-role key, or cannot be revoked.

### Phase 4 — Build credible product-efficacy evidence

| ID | Task | Depends on | Deliverable and pass condition |
|---|---|---|---|
| DATA-001 | Prepare a private rehearsal corpus containing only SkillMap-owned or explicitly authorized/licensed bodies. | MCP-006 | Corpus manifest/digest and authority evidence; zero production seed/fixture fallback. |
| EFF-001 | Replace the demo eval with eval-suite/v3 using independent labels, qualified IDs, provenance, frozen holdout, and baseline revision. | DATA-001, RHR-006 | At least 100 implicit-natural, 25 multi-skill, 25 negative/near-miss, and 30 holdout cases; zero label/description leakage. |
| EFF-002 | Run deterministic current-versus-baseline routing evaluation locally and through remote MCP. | EFF-001, MCP-011 | Top-1, top-3, avoid, abstention, multi-skill, segment, and non-regression receipt. |
| EFF-003 | Run 60 paired objective tasks across 20 skills under no-skill, SkillMap-selected, and human-oracle conditions. | EFF-002 | Task pass, harm, constraint, time, tool, token, and context-cost report with confidence interval. |
| AUD-001 | Calibrate static audit on 20 clean, 20 known-flawed, and 20 adversarial/mutated skills. | DATA-001 | Severity precision/recall and deterministic digest agreement. |
| GRD-001 | Compare letterless provisional grading with two independent expert reviewers. | AUD-001 | Rank correlation, band agreement, adjudication log; critical blockers remain blocked. |
| EFF-004 | Freeze the accepted corpus/eval/model/runtime/index receipts and prevent holdout tuning. | EFF-003, GRD-001 | Immutable benchmark packet and anti-cheat review. |

Stop condition: holdout is used for tuning, labels leak target names/descriptions, or test-only scores are presented as live efficacy.

### Phase 5 — Run local acceptance and exact-commit CI

| ID | Task | Depends on | Deliverable and pass condition |
|---|---|---|---|
| VAL-001 | Run root build/type/tests/contracts/integration/privacy/migration/failure/connector/release/package gates in a clean worktree. | Phases 1 through 4 | Exact local candidate receipt. |
| VAL-002 | Reset local Supabase, lint all schemas, run every pgTAP file, and compare generated API types byte-for-byte. | VAL-001 | Migration/RLS/type receipt. |
| VAL-003 | Run optimized Next production server plus private web/API/auth three-browser, accessibility, visual, responsive, performance, and cleanup gates. | VAL-002 | Browser and cleanup receipt. |
| VAL-004 | Run Wrangler local MCP plus protocol, auth, load, concurrency, fault, and performance gates. | VAL-001 | Local MCP receipt. |
| VAL-005 | Run encrypted local database recovery, web rollback simulation, Worker rollback simulation, and index pointer rollback. | VAL-002, VAL-004 | Named RPO/RTO and exact restored digests. |
| VAL-006 | Run repository secret canary, production dependency audits, no-PII/log canary, package dry-run, and diff check. | VAL-001 | Zero high vulnerabilities and zero sensitive artifact. |
| VAL-007 | Freeze exact candidate and run protected Gitea plus authorized GitHub hosted-web/remote-MCP authority lanes. | VAL-001 through VAL-006 | Exact commit/tree, run IDs, job IDs, and retained receipt hashes. |
| VAL-008 | Independent engineering acceptance over the exact candidate and receipts. | VAL-007 | No unresolved P0/P1/P2; private rehearsal deployment authorized. |

Any code change after VAL-007 returns to VAL-001.

### Phase 6 — Provision real provider resources

| ID | Task | Depends on | Deliverable and pass condition |
|---|---|---|---|
| INF-001 | Create/link isolated Supabase Pro project in approved region; record project ref, plan, region, owner, backup/PITR state, and spend alerts. | VAL-008 | Redacted provider inventory; no secret values. |
| INF-002 | Apply linked migrations with dry-run, verify exact migration list, API-only exposure, grants/RLS, and generated type parity. | INF-001 | Linked migration/type/grant receipt. |
| INF-003 | Configure GitHub OAuth, exact Site URL/callback, signing keys, hosted Auth settings, and selected enrollment path. | INF-002 | Auth configuration receipt and linking probe. |
| INF-004 | Create an unlinked Vercel Hobby project rooted at apps/web, pin Node 24.x and the selected single region, configure production-only variables, app-level access enforcement, quota monitoring, logs, rollback, and an owner-controlled CLI deployment identity. | VAL-008, RHR-004 | Hobby configuration receipt; no organization Git integration, public mirror, collaboration, or preview DB credentials. |
| INF-005 | Create Cloudflare Worker environments, KV/R2 bindings, custom domain, access policy, global limiter, logs, spend/quota alerts, and rollback target. | VAL-008, RHR-004 | Cloudflare resource/version/binding receipt; workers.dev bypass absent. |
| INF-006 | Configure Cloudflare DNS for Vercel web as DNS-only initially and Worker MCP as Custom Domain. | INF-004, INF-005 | DNS/certificate evidence; no unintended proxy layer. |
| INF-007 | Configure provider secrets through dashboard/stdin only and verify the environment allowlist. | INF-001, INF-004, INF-005 | Secret names and scopes recorded; values absent from history/artifacts. |
| INF-008 | Prove encrypted off-host Supabase backup export and isolated restore before accepting pilot data. | INF-002 | Restore digest parity and measured RPO/RTO. |

Stop condition: wrong account/zone/project, preview secret inheritance, unexpected existing production resource, or spend outside approved ceiling.

### Phase 7 — Deploy the private production rehearsal

| ID | Task | Depends on | Deliverable and pass condition |
|---|---|---|---|
| DEP-001 | Upload the exact Cloudflare Worker version without traffic; smoke exact version/index/content/auth tuple. | INF-005, INF-007 | Versioned pre-traffic receipt. |
| DEP-002 | Route 100 percent only after protocol/auth/digest gates; record prior Worker and index pointer. | DEP-001 | Canonical MCP custom domain passes; rollback targets named. |
| DEP-003 | Run vercel build and deploy the exact prebuilt candidate to the unlinked Hobby project through the owner-controlled CLI path; smoke the app-gated generated URL. | INF-004, INF-007 | Commit/tree, build digest, deployment ID, Node, region, env, headers, auth, noindex, and RLS pass; no Git integration or public source mirror. |
| DEP-004 | Promote exact Vercel deployment to final web domain. | DEP-003, DEP-002 | TLS/HSTS/CSP/cookies/callbacks and no anonymous access pass. |
| DEP-005 | Provision and activate the exact five tester identities; set global signup off; remove unexpected identities. | INF-003, DEP-004 | Five active opaque user IDs; unknown GitHub account creates no user. |
| DEP-006 | Process only owned/authorized rehearsal skills through normal submission, audit, provisional grade, collision, authorization, dual-control publication, and edge export. | DEP-002, DEP-004, DATA-001 | No hand-created rows; Supabase and edge digests reconcile. |
| DEP-007 | Install manual one-shot operator workflow or reviewed scheduler; prove lease, retry, provider deferral, DLQ, and alert behavior. | DEP-006 | Operator execution receipt; worker remains outside request path. |

Stop condition: any fixture/seed reaches hosted data, any unauthorized body loads, or edge and database truth diverge.

### Phase 8 — Run live acceptance, rollback drills, and five-seat pilot

| ID | Task | Depends on | Deliverable and pass condition |
|---|---|---|---|
| LIVE-001 | Run signed-out, invited, inactive, uninvited, revoked-live-JWT, deleted, two-account, operator, outage, and mode-mismatch web/API/Data API matrix. | DEP-005 | Zero unauthorized signup/access/cross-account leak. |
| LIVE-002 | Run MCP Inspector plus every intended client through connect, consent/auth, list, recommend, select, webUrl, load, revoke, timeout, and outage journeys. | DEP-002, DEP-005 | Client-specific protocol and auth receipt. |
| LIVE-003 | Reproduce submission, audit, provisional grade, report, lifecycle, account export/deletion, and publication workflows against real services. | DEP-006, DEP-007 | Redacted live workflow receipt and exact rows/payloads. |
| LIVE-004 | Run live performance from the initial tester region and at least one distant region; correlate client timing with redacted Server-Timing/trace spans for ingress, auth, index, scoring, content, serialization, and deferred telemetry. | LIVE-001, LIVE-002 | p50/p95/p99, cold/warm, cache hit/miss, error, CPU, wall, subrequest, and network-residual distributions. |
| LIVE-005 | Inspect Vercel, Cloudflare, Supabase, and operator logs with privacy canaries. | LIVE-001 through LIVE-004 | No prompt, body, email, OAuth metadata, token, cookie, private ID, or full IP leak. |
| DR-001 | Drill access mode closed, OAuth disable, session revocation, MCP route disable, Worker rollback, index rollback, Vercel rollback, write freeze, and isolated DB restore. | LIVE-003 | Every rollback works within frozen RTO; reopen requires fresh acceptance. |
| PILOT-001 | Freeze five seat assignments, tasks, clients, no-coaching rules, and session evidence format. | DR-001, EFF-004 | Pilot preflight receipt. |
| PILOT-002 | Run five sessions covering login, browse/search, save, submit, evidence review, MCP connect/recommend/select/load, web handoff, and task completion. | PILOT-001 | Redacted per-session and aggregate receipts. |
| PILOT-003 | Review efficacy, routing, audit/grade, usability, latency, failures, spend, support load, and privacy evidence. | PILOT-002 | GO, REPEAT, or NO-GO recommendation with exact deployment tuple. |
| ACCEPT-001 | Independent engineering/product acceptance. | PILOT-003 | Private rehearsal checkpoint accepted or returned to a named phase. |

### Phase 9 — Rehearse and execute public promotion only after acceptance

| ID | Task | Depends on | Deliverable and pass condition |
|---|---|---|---|
| PUB-000 | Upgrade the Vercel project from Hobby to Pro before any public-read, public-signup, public-indexing, collaboration, or commercial change; reconnect Git only if the reviewed workflow benefits from it. | ACCEPT-001 | Pro plan/deployment/domain/rollback receipt and renewed web/auth acceptance; no public mode changed yet. |
| PUB-001 | Close policy, privacy, retention, jurisdiction, support, appeal, incident, abuse, and operator-owner gates. | ACCEPT-001 | Approved public policy/version receipt. |
| PUB-002 | Obtain and publish 20 owner-authorized receipt-backed launch listings through normal workflows. | ACCEPT-001 | Initial corpus acceptance receipt; bodies load only where authorized. |
| PUB-003 | Rehearse closed → invite-only → public-read/signup-off → public-signup → indexing-on in a disposable environment. | PUB-000, PUB-001, PUB-002 | No access, auth, RLS, MCP, or indexing drift. |
| PUB-004 | Freeze current commit and repeat all local, CI, live, recovery, efficacy, abuse, and pilot gates affected by promotion. | PUB-003 | Exact public-capable candidate accepted. |
| PUB-005 | Enable anonymous web/API catalog reads while keeping new signup off; make only read-only MCP tools public. | PUB-004 | Anonymous acceptance passes; account/write tools remain OAuth-protected. |
| PUB-006 | Enable public GitHub account creation and prove one genuinely new account plus abuse/rate limits. | PUB-005 | New account journey passes without weakening RLS. |
| PUB-007 | Set SKILLMAP_RELEASE_STAGE=public-alpha while indexing remains private; reaccept live. | PUB-006 | Truthful public-alpha copy with no indexing. |
| PUB-008 | Set SKILLMAP_INDEXING_MODE=public last and record explicit promotion receipt. | PUB-007 | Robots, sitemap, canonical URLs, DNS, support, metrics, and rollback verified. |
| PUB-009 | Monitor launch and retain the immediate rollback tuple. | PUB-008 | No P0/P1, spend, latency, auth, trust, or integrity breach. |

## Task Backlog Summary

Critical path:

1. RHR-001 through RHR-007
2. AUTH-001 through AUTH-009
3. WEB-001 through WEB-008
4. MCP-001 through MCP-011
5. DATA/EFF/AUD/GRD
6. VAL and CI
7. provider provisioning
8. private deployment
9. live acceptance and rollback
10. five-seat pilot
11. independent acceptance
12. separate public promotion

Parallelizable only after source contracts freeze:

- WEB implementation may proceed alongside the MCP package after AUTH-003 is stable.
- Efficacy dataset authoring may proceed alongside MCP implementation, but remote efficacy cannot run before MCP-011.
- Provider account inventory may be read-only researched before CI; provider creation/mutation waits for VAL-008.
- Documentation and runbook updates accompany each phase, not one late cleanup pass.

## Frozen Quantitative Acceptance Criteria

| Surface | Gate |
|---|---|
| Eval composition | At least 100 implicit-natural, 25 multi-skill, 25 negative/near-miss; holdout at least 20 percent and 30 cases; complete provenance; zero label/description leakage. |
| Retrieval | Top-1 at least 80 percent; Top-3 at least 92 percent; avoid hits 0; negative false-positive rate at most 5 percent; multi-skill required-skill recall at least 80 percent. |
| Downstream efficacy | 60 objective tasks across 20 skills; at least 10 percentage-point uplift over no-skill; lower 95 percent confidence bound above 0; oracle gap at most 10 points; harmful regression at most 2 percent; zero safety-critical regression. |
| Audit | 20 clean, 20 known-flawed, 20 adversarial; critical recall 100 percent; high-severity recall at least 95 percent; precision at least 90 percent; repeat output/digest agreement 100 percent. |
| Provisional grade | Two reviewers; Spearman rank correlation at least 0.75; exact-or-adjacent band agreement at least 90 percent; every critical blocker remains blocked and letterless. |
| MCP protocol | 100 percent valid initialize/list/call cases; 100 percent fail-closed unknown, digest, revocation, oversize, and malformed cases; no execution and no unselected body. |
| Routing optimization | Compiled-index output is byte-equivalent to the reference scanner for all frozen eval, negative, Unicode, phrase-boundary, policy, supersession, and fuzz cases; 150/1,000/5,000-skill profiles are retained. |
| Workers Free capacity | Compressed Worker at most 3 MB; recommend CPU p95 at most 5 ms and p99 at most 8 ms at the 1,000-skill target corpus; zero 1102/1027 errors; request forecast remains below 80 percent of the 100,000/day allowance. Failure selects Workers Paid or the reviewed origin fallback before deployment, never a silent quality reduction. |
| MCP local processing | Warm recommendation handler wall p95 at most 15 ms; bundled-index recommendation performs zero subrequests; KV-index mode performs at most one index subrequest; cache-hit load p95 at most 50 ms. |
| MCP live | Edge handler wall p95 at most 25 ms excluding client network; warm recommend end-to-end p95 at most 175 ms from designated pilot regions and at most 300 ms from the measured distant region; cached load p95 at most 250 ms; overall p99 at most 500 ms; cold p95 at most 750 ms. |
| MCP load | 10 requests/second with 25 concurrent clients for 15 minutes; error rate below 0.5 percent; no unbounded memory, digest drift, or 5xx burst. |
| Web | LCP at most 2.5 seconds; INP at most 200 ms; CLS at most 0.1; route JavaScript at most 294,912 bytes. |
| Auth/data | Zero unknown signups after lock; zero uninvited/revoked access; zero cross-account read/write; zero private-schema exposure; approved sign-in/session refresh 100 percent. |
| Recovery | Private-alpha RPO at most 24 hours; measured RTO at most 60 minutes; named web/MCP/index rollback succeeds; stale/revoked content propagation at most 5 minutes. |
| Pilot | At least 4 of 5 complete uncoached; every mandatory workflow has an uncoached receipt; MCP connection under 5 minutes; at least 4 of 5 reach routed and loaded skill within 15 minutes. |
| Release | Zero unresolved P0/P1, privacy, auth, data-integrity, trust, restore, rollback, or uncontrolled-spend failure. |

Local loopback latency and live provider latency are separate evidence classes. Neither substitutes for the other.

## Live Access Test Matrix

| Actor/state | Web HTML | API | Direct Supabase | MCP | Expected data result |
|---|---|---|---|---|---|
| Anonymous | sign-in redirect except explicit public exceptions | 401 JSON | no rehearsal catalog/account rows | 401/auth metadata | no user/profile/membership created |
| Invited active | allowed | allowed | membership/RLS-limited | allowed after pilot auth | own rows and authorized catalog only |
| New uninvited GitHub identity | denied | denied | denied | denied | no Auth user/profile/membership |
| Existing Auth user without membership | 403 and session clear | 403 | RLS deny | 403 | no product data |
| Revoked tester with live JWT | denied next request | denied | RLS deny immediately | denied | own data inaccessible until reactivated |
| Deleted user | denied | denied | denied | denied | account rows cascade per contract |
| Active A versus active B | both allowed | both allowed | isolated | isolated | no cross-account rows or mutations |
| Operator/service | no browser privilege | exact operator RPCs only | reviewed service boundary | no ordinary MCP bypass | no broad private output |
| Auth/database outage | fail-closed 503 | retryable 503 | unavailable | protocol-safe failure | no fallback/mutation |
| Access-mode mismatch | closed | 503 | deny | unavailable | health unhealthy |

## Validation Plan

### Existing repository commands

Run from an exact clean worktree:

    npm ci
    npm run typecheck
    npm test
    npm run test:contracts
    npm run check:web
    npm audit --omit=dev --audit-level=high
    npm --prefix apps/web audit --omit=dev --audit-level=high

    supabase start
    supabase db reset --local
    supabase db lint --local --schema api,private,public --level warning --fail-on warning
    supabase test db --local

    npm run test:hosted-gates
    npm run test:cross-browser
    npm run test:a11y
    npm run test:visual
    npm run test:perf
    npm run test:consumer-install
    npm run test:release-path
    npm pack --dry-run
    git diff --check

### Planned commands to add during implementation

These names do not exist yet and are deliverables, not current capabilities:

    npm run test:private-rehearsal
    npm run test:private-auth
    npm run test:product-efficacy
    npm run preflight:private-rehearsal

    npm --prefix apps/mcp run typecheck
    npm --prefix apps/mcp test
    npm --prefix apps/mcp run test:contract
    npm --prefix apps/mcp run test:auth
    npm --prefix apps/mcp run test:load
    npm --prefix apps/mcp run test:performance
    npm --prefix apps/mcp run test:recovery

### Browser checks

- 320 px, 390 px, tablet, and desktop.
- Chromium, Firefox, and WebKit.
- Signed out, invited, uninvited, revoked, two-account, closed, outage, and public-transition states.
- No overflow, clipping, false affordance, stale public copy, or hidden error.
- Accessibility and forced-colors checks for sign-in, access-denied, catalog, detail, save, submit, audit, grade, report, and account flows.
- Real callback and cookie behavior on final domains.

### MCP checks

- MCP Inspector.
- Official SDK client.
- Every intended end-user MCP client.
- initialize, tools/list, tools/call, invalid methods, invalid schemas, cancellation, concurrency, timeout, and rate limits.
- authenticated, uninvited, revoked, expired, wrong-audience, wrong-client, and outage cases.
- cache hit/miss, stale pointer, missing R2 object, digest mismatch, revocation overlay, last-known-good, and rollback.
- webUrl opens the exact version evidence page.
- returned content contains only the selected authorized SKILL.md.

### Evidence receipts

Retain:

- exact commit/tree and CI identities;
- migration and generated-type digests;
- Vercel deployment and rollback IDs;
- Cloudflare Worker version, routes, binding names, and index/content digests;
- Supabase project/region/plan, without credentials;
- corpus, eval, holdout, model/runtime, and rubric digests;
- aggregate latency/error/CPU/cache distributions;
- browser screenshots and accessibility results;
- restore/rollback checksums and timing;
- redacted pilot aggregates and final verdict.

Never retain:

- raw prompts or task text;
- skill bodies in tracked receipts;
- emails, GitHub handles, OAuth metadata, tokens, cookies, credentials, service keys, or full IP addresses;
- private operator notes or participant-linked IDs.

## Risks And Dependencies

| Risk | Consequence | Mitigation/gate |
|---|---|---|
| Vercel Hobby cannot import the private organization repository | deployment integration failure | unlinked Hobby project plus exact-candidate owner-controlled Vercel CLI deployment; canonical repo stays private. |
| Hobby generated/custom-domain URL is internet-reachable | login gate becomes real security boundary | fail-closed app/API/RLS gate plus direct URL bypass tests. |
| Public promotion begins while Vercel remains Hobby | plan/terms/collaboration mismatch | PUB-000 upgrades to Pro before any public mode change. |
| Global Supabase signup disabled before identities exist | no tester can complete first GitHub login | precreate/link probe; allowlist hook fallback; never unrestricted enrollment. |
| Login wall but anonymous catalog RLS remains | direct PostgREST bypass | authenticated-only catalog during invite-only mode and explicit public cutover rehearsal. |
| Revoked JWT remains cryptographically valid | revoked user retains access | live pilot-membership check and RLS on next protected request. |
| Remote MCP still absent | infrastructure does not test product | MCP phases precede provisioning and pilot. |
| Metadata-only catalog lacks authorized bodies | load_skill cannot be truthful | owned/authorized rehearsal corpus and content authority gate. |
| Cloudflare Access/client incompatibility | MCP client cannot authenticate | client matrix before provider deployment; fallback token/Supabase OAuth design. |
| Global Worker calls regional Supabase every request | latency and outage coupling | immutable edge index/content, local credential verification, and edge revocation overlay; no Supabase call on recommend/load. |
| Current O(number of skills) scanner grows beyond Workers Free CPU | request termination or pressure to reduce recommendation quality | publication-time inverted index, bounded candidates, byte-equivalence tests, and 150/1,000/5,000-skill CPU profiles. |
| Worker index or dependencies exceed Hobby-era Cloudflare ceilings | slow startup or failed deployment | 3 MB compressed bundle gate, startup receipt, versioned KV fallback, and explicit Workers Paid/origin escape hatch. |
| Static asset routing bypasses Worker authentication | private skill-body disclosure | run_worker_first on every content path, direct generated/custom/asset URL tests, workers.dev disabled, and R2 fallback if the invariant cannot be proven. |
| Worker rollback does not roll back KV/R2 | version/content skew | separate versioned index pointer and LKG rollback. |
| Vercel rollback does not roll back env/DB | partial rollback | immutable deployment/env receipt and forward-compatible migrations. |
| Preview receives production secrets | production data exposure | preview variables absent until separate preview data plane. |
| Per-process limiter treated as global | public abuse exposure | Cloudflare/provider-global limiter before public promotion. |
| Provider logs retain private text | privacy breach | telemetry allowlist, canary tests, bounded retention/export. |
| Existing user checkout used as candidate | old/divergent source and user-work loss | clean worktree from origin/main; current checkout untouched. |
| Cost/quota surprise | outage or uncontrolled spend | hard ceilings, alerts, daily pilot review, kill at 80 percent budget. |

## Implementation Orchestrator Handoff

### Recommended first implementation slice

Implement only the code-level private access contract:

1. RHR-001 through RHR-007 documentation/contracts;
2. AUTH-001 through AUTH-007 database, RLS, operator, and tests;
3. WEB-001 through WEB-008 application gate and browser/API tests.

Do not create provider projects or deploy during the first slice.

### First-slice source-of-truth contract

- Intent: make private-alpha a genuine access mode rather than only copy/noindex state.
- Current behavior: public catalog and API remain anonymous; only account routes are proxy-protected.
- Expected outcome: all hosted product routes/data fail closed for anonymous, inactive, revoked, outage, and mode mismatch; exact invited users work.
- Truth owner: migration/RLS row behavior, proxy/API responses, callback records, browser-rendered states, and test receipts.
- Contract boundary: Supabase Auth/RLS plus Next proxy/callback/catalog client.
- Displaced path: anonymous private-alpha catalog access.
- Cutover: closed → invite-only; public is retained as a separately tested future state.
- Acceptance evidence: pgTAP rows, API responses, auth-user/profile counts, callback outcomes, and browser results.
- Kill criteria: any unauthorized profile/user/data, cross-account result, fail-open outage, or public-mode regression.
- Forbidden moves: no provider mutation, no service role in web, no unrestricted enrollment, no unrelated refactor.

### Phase order and dependency constraints

- Access-mode and membership schema precede web gating.
- Web/API/RLS gates precede remote MCP authorization.
- Remote MCP contracts and immutable loading precede efficacy and provider deployment.
- Complete local validation and exact-commit CI precede provider provisioning.
- Backup/restore and rollback precede pilot invitations.
- Pilot acceptance precedes every public signup/read/indexing change.

### Likely files and areas to change

First slice:

- docs/decisions/2026-07-11-hosted-architecture.md
- docs/security/hosted-threat-model.md
- docs/operations/hosted-alpha-deploy.md
- docs/operations/free-public-alpha-runbook.md
- apps/web/proxy.ts
- apps/web/app/sign-in
- apps/web/app/auth/callback/route.ts
- apps/web/lib/auth
- apps/web/lib/supabase
- apps/web/lib/registry/repository.server.ts
- apps/web/lib/security/policy.ts
- apps/web/app/robots.ts
- apps/web/app/sitemap.ts
- apps/web/tests and apps/web/scripts
- a new Supabase migration and pgTAP test
- operator CLI under apps/worker
- root package scripts and focused tests

Later MCP slice:

- new apps/mcp package
- shared hosted contracts
- index/content builder and publisher
- Wrangler environments and bindings
- Cloudflare/MCP tests
- CI workflows
- deployment and recovery runbooks

### Allowed changes

- scoped schema, RLS, RPC, proxy, auth callback, catalog-client, error-state, test, contract, runbook, and new MCP package work required by this plan;
- new deterministic scripts and receipts;
- reviewed CI coverage for the new surfaces.

### Disallowed changes

- provider account or DNS mutation before its phase;
- public signup/indexing;
- service-role expansion into web/MCP;
- third-party body mirroring without authority;
- unrelated UI redesign or local CLI behavior changes;
- deletion or overwrite of user-owned dirty files;
- hand-editing generated Supabase types.

### Required skills and tools

- implementation-orchestrator
- checkpoint-quality-loop
- context7-mcp for current platform/API behavior
- Supabase/Postgres best practices
- Cloudflare MCP, Workers, Wrangler, and web-performance skills
- Vercel current official docs/CLI
- security validation and engineering acceptance review
- protected Gitea and authorized GitHub CI
- browser automation and real MCP clients

### Required validation before completion

- focused first-slice unit/contract/pgTAP/browser tests;
- full existing root/web/database/browser/recovery/package gates;
- zero generated-type diff;
- secret and privacy canaries;
- exact route/row/payload/browser evidence;
- independent acceptance.

### Blocking questions

- Exact final web and MCP domains.
- Exact Vercel Hobby owner/CLI deployment identity, Supabase Pro ceiling, Cloudflare Free/Paid choice, and quota owners.
- Supabase project/region and whether asymmetric signing is active.
- Five exact tester identities and the result of the GitHub pre-created-user linking probe.
- Target MCP client list and whether each supports the selected auth flow.
- Which rehearsal skills have body redistribution/publisher authority.
- Cloudflare Access/OAuth feature availability and cost in the owner account.

These block provider provisioning or body-loading, not the first local implementation slice.

### Questions resolvable during implementation

- Exact internal module names for access-mode helpers.
- Exact migration timestamp.
- Whether the membership predicate is exposed as one RPC or a small pair.
- Whether local MCP fixtures use Miniflare-only KV/R2 or Wrangler local persistence.
- Exact log export sink, provided the privacy allowlist and retention contract are preserved.

### Stop conditions

- A required provider/account/domain cannot be verified.
- The auth design cannot prevent uninvited user creation without an unrestricted window.
- A direct Vercel, workers.dev, API, or Supabase route bypasses access control.
- The exact Worker cannot meet the 10 ms Free CPU ceiling with margin and neither Workers Paid nor the reviewed origin fallback is approved.
- A target MCP client cannot complete the selected auth flow and no reviewed fallback exists.
- The content authority needed for load_skill is missing.
- A required test or rollback path is skipped or cannot produce target-perspective evidence.

### Do not claim complete until

- the exact target route, payload, database record, MCP trace, skill digest, rendered UI, provider deployment/version, and operator-visible receipt are captured;
- all affected local, CI, live, recovery, and independent acceptance gates pass;
- private rehearsal remains noindex and invite-only;
- no user-owned dirty work is modified.

The future implementation orchestrator should create its own goal for the selected slice, run implementation and validation cycles, and continue until every slice acceptance criterion is satisfied or a real blocker is recorded. “Implemented,” “tests pass,” or “deployed” is not equivalent to verified; verification requires evidence from the real route, payload, row, artifact, trace, rendered UI, and operator output.

## Orchestration Closeout

- Workers actually used: plan_platform_topology, plan_auth_access, plan_validation_promotion.
- Worker scopes:
  - hosting/topology/provider constraints;
  - invite-only auth/RLS/account/MCP access;
  - validation/efficacy/recovery/pilot/promotion.
- Worker results accepted:
  - Vercel Hobby for the private non-commercial rehearsal through an unlinked exact-candidate CLI deployment, with Pro required before public promotion;
  - application-level web gate;
  - active membership and immediate revocation;
  - remote MCP and load_skill as pre-deployment dependencies;
  - precompiled edge candidate index and zero-Supabase recommendation hot path;
  - production-shaped local and live gates;
  - frozen efficacy and pilot metrics.
- Worker results adapted:
  - the plan chooses strict authenticated catalog access during invite-only mode instead of accepting direct anonymous PostgREST visibility;
  - MCP auth remains a client-compatibility decision between Cloudflare Access, Supabase OAuth, and per-seat tokens, with no fail-open fallback.
- Worker results rejected:
  - unrestricted temporary signup enrollment;
  - treating app-only login as confidentiality while anonymous database policies remain.
- Parent verification:
  - exact origin/main SHA/tree and clean inspection tree;
  - current proxy/catalog/MCP behavior;
  - Context7 plus official Vercel, Supabase, Cloudflare, and MCP documentation.
- Gaps that would benefit from more workers: none before implementation; live provider/account inspection belongs to the implementation phase.
- Visible thread considered: no; one durable repo-local plan is sufficient.
