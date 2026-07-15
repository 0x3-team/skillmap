# Hosted Skill Library Threat Model

Status: historical Phase 0 baseline plus an accepted product-checkpoint boundary. Candidate `33e66c4175676355c275db091eb876bae81e29cf` with tree `c0fc2ce7e8d4584ee2f7ed5ae2fb72e54b69ade6` was accepted and merged as product-code commit `72ce471f378db36dfeb4faa31ec52c05e2e57654`. At integration, GitHub and protected Gitea both resolved that exact merge and tree; moving branch heads require live verification and are not frozen by this threat model. Nothing in this document claims deployment or live verification. Revisit before remote provisioning, artifact serving, signing keys, new evaluation authority, or production traffic.

## Security objectives

- Never execute or obey untrusted skill content during discovery, ingestion, audit, grading, routing, or metadata rendering.
- Bind every consequential claim to immutable identity, exact byte domain, issuer, policy version, and time window.
- Expose only published, eligible projections; keep private account, worker, operator, and evidence data non-public.
- Preserve local prompt/skill privacy and keep hosted sessions separate from local connector authority.
- Fail closed on identity, lifecycle, revocation, package integrity, authorization, and evidence ambiguity.
- Keep the free launch independent of billing, entitlement, and payment data.

## Assets

- account sessions and OAuth identity;
- publisher identity and memberships;
- source coordinates and admitted snapshots;
- package manifests/artifacts and signing metadata;
- provenance, audit, compatibility, grade, advisory, and revocation receipts;
- public catalog/index correctness and availability;
- private profiles, saved skills, submissions, appeals, operator actions, and audit logs;
- local prompts, local skill bodies, workspace paths, policies, and route history;
- Supabase/web-host/worker credentials, operator credentials, and TUF keys.

## Trust boundaries

1. Browser to Next.js/Supabase Auth.
2. Next.js server to exposed Supabase `api` schema.
3. Exposed projections to non-exposed `private` schema with forced RLS.
4. Source provider/network to isolated ingestion worker.
5. Untrusted source bytes to canonical package/evidence pipeline.
6. Worker service-role transport and independently credentialed approver/executor identities to consequential database state.
7. Artifact/index publication to TUF signing roles and CDN/object storage.
8. Hosted registry to local router/loader.
9. Local prompt/workspace state to any optional hosted request or telemetry.

## Adversaries and failures

- malicious or compromised publisher/source repository;
- skill-authored prompt injection intended to steer reviewers or agents;
- unauthenticated attacker, compromised account, or cross-tenant user;
- compromised dependency, CI job, worker, online signing key, or cloud credential;
- malicious/over-privileged operator;
- grade gamer, popularity manipulator, or automated submission spammer;
- CDN/network attacker performing rollback, freeze, replay, substitution, or partial delivery;
- ordinary bugs, stale state, retries, clock skew, resource exhaustion, and partial failure.

## Threats and required controls

| Threat | Required controls | Verification |
| --- | --- | --- |
| Skill prompt injection changes audit/grade behavior | Treat all content and referenced files as inert untrusted data; fixed reviewer procedure; no target-instruction following or tool invocation | Adversarial skill fixtures and independent review |
| Mutable-ref or repository substitution | Provider repository ID, normalized repository URL, full commit, path, version ID, and named digests; resolve once | Contract, ingestion, and receipt-binding tests |
| Traversal, symlink, archive bomb, or executable surprise | Streaming limits, normalized paths, regular-file-only manifest, no links/submodules/devices, exact expanded entry verification, no lifecycle script execution | Package adversarial matrix |
| Opaque binary or non-UTF-8 supporting content hides behavior from the static audit | Treat any undecodable admitted file as a critical `binary-file` finding; block both audit and grade; never infer safety from the readable subset | Hosted audit/grade hard-gate tests |
| Rollback, freeze, mix-and-match, replay, or stale revocation | Pinned TUF root, monotonic metadata, consistent snapshots, short-lived revocation role, atomic updates, bounded LKG | TUF profile integration tests |
| Forged grade/audit/rollback receipt | Issuer trust chain, signature bundle, exact version/digest/domain binding, rubric/policy version, expiry | Receipt semantic and signature tests |
| Grade or router gaming | Held-out and near-miss suites, no-skill/previous baselines, repeated trials, separate popularity, deterministic policy filters, visible reason codes | Calibration and red-team evaluation |
| Unauthorized or cross-user account access | Server-verified Supabase user, strict callback/redirect allowlist, relational authorization, owner RLS, CSRF/same-origin actions; report insert rechecks that the exact current target is public and has current publisher authorization | Anonymous/owner/cross-user pgTAP and browser tests |
| RLS bypass or private-schema exposure | Non-exposed `private` schema, explicit `api` views, least grants, forced RLS, security-invoker/barrier views, no service key in client | Schema lint, grant matrix, direct PostgREST probes |
| Parent lifecycle leak | Compose publisher/repository/skill/version eligibility in every public view and router index | Independent lifecycle predicate tests |
| Stored XSS or unsafe rendering | Contract-bounded plain text, framework escaping, no skill HTML/script execution, strict headers before production | Browser security and payload fixtures |
| SSRF/credential leak during source fetch | Provider allowlist, DNS/IP/redirect validation, no ambient credentials, bounded response/time/concurrency, isolated egress | Transport tests and network policy |
| Local prompt/path leakage | Local routing default, no raw prompts in hosted schema, redacted bounded diagnostics, consent for any hosted planning/telemetry | Secret/path/prompt canaries and privacy review |
| Service-role or signing-key compromise | Server/worker-only scope, separate environments/roles, secret scanning, short-lived credentials where possible, offline root keys, rapid rotation | Deployment review and incident exercise |
| Shared service role, operator abuse, destructive error, or a false-success RPC projection | Service role is transport only; publisher authorization, collision review, publication, catalog lifecycle, and report disposition require an exact payload/digest/operation approval, a short expiry, a role-scoped approver credential, and a distinct executor credential; authorization, collision-review, and publication clients accept success only after validating the exact single-row projection and expected key/value; retain immutable approval, execution, and audit attribution | All-five-RPC pgTAP, exact success-projection tests, service-role-only and approver-as-executor denial, database-backed browser journeys, consequential-action recovery drill |
| Denial of service or cost exhaustion | Query/page/body/time/concurrency limits, job admission/idempotency, rate limits, quotas/alerts, bounded package/index sizes | Load, fuzz, and budget-alert tests |
| License or ownership fraud | Separate publisher verification, immutable source evidence, concluded license review, metadata-only/blocked modes, takedown/appeal | Legal workflow fixtures and audit trail |

## Historical Phase 1 security posture

Phase 1 has anonymous catalog reads and account-owned saves only. It does not fetch third-party sources, mirror packages, execute skills, run graders, publish TUF metadata, accept publisher mutations, or expose operator controls. It may be deployed only as the separately evidenced private hosted alpha governed by `docs/operations/hosted-alpha-deploy.md`; the implementation ledger owns whether that deployment is currently live, blocked, or absent. Seeds are first-party MIT files pinned to an immutable commit and exact entrypoint digest, while provenance/audit/compatibility/grade remain explicitly unverified/not-run/not-tested/ungraded.

Implemented controls include explicit `api`/`private` schemas, forced RLS, parent visibility composition, immutable identities, positive-evidence promotion blocks, no-store server responses, hidden/nonexistent parity, missing-config/backend-outage states, OAuth privacy disclosure, client-secret canaries, synthetic-user cleanup, and mobile/browser diagnostics.

## Accepted product checkpoint and historical predecessor

The earlier accepted go-to-market/dual-control product candidate includes
exact-commit public GitHub ingestion, bounded inert audit and provisional
grading, authenticated report intake, operator-reviewed publication/lifecycle,
and account-owned submission workflows. It still does not execute submitted
content, mirror third-party packages, publish TUF metadata, or issue a current
letter grade from static evidence alone.

Migration `20260714050000_report_authorization_enforcement.sql` requires a new
report target to remain the exact current public version and to retain current
publisher authorization. Migration `20260714060000_operator_dual_control.sql`
keeps the service role as transport but requires immutable 30-minute
exact-envelope approval and distinct execution for five consequential RPCs.
Opaque binary/non-UTF-8 admitted files are critical audit findings and block the
grade. That historical acceptance receipt records audit policy
`skillmap-static-audit/v2` and worker `skillmap-worker/0.2.0`. Root `npm test`
passed `440/440`; focused tests passed `45/45`; pgTAP passed `585/585`; and the
hosted gates passed three-browser authentication, dual control, accessibility,
private/public runtime, thirteen strict zero-diff baselines, and cleanup. Those
results belong to candidate `413d8759e244005406280cd8d7c2fe2ec01b84bf`, tree
`00273fce90c0294f4f3aea2407d4ba0c65aec1f9`, and product merge
`8bb2b1d25befeb53e13d0e05a6934dacc9d45cd7`, covered by Gitea run IDs `70`
through `73` (UI `53` through `56`) and GitHub named job `87033792983`.

The accepted 2026-07-15 product checkpoint adds migration
`20260715010000_hosted_evidence_version_authority.sql` to bind worker, audit,
grade, host profile, rubric, and publication success to one exact current
evidence-authority tuple. Migration
`20260715020000_hosted_report_idempotency_recovery.sql` makes owner-scoped
request identity distinguish a true report replay from a reused request ID and
from a different queued payload. The checkpoint also closes the recorded skip
navigation, mobile account route, privacy hierarchy, production-seed,
metadata, mutable-CI-source, and release-truth gaps.

Its final local gate passed root tests `448/448`, hosted boundary tests `35/35`,
release path tests `47/47`, pgTAP `621/621` across ten files, schema lint,
generated-type parity, web typecheck/lint/build, clean consumer installation,
package inspection, production dependency audits, secret scanning, and the
static preflight. The composed hosted gate passed three-browser authentication,
the report request-ID/queued-target conflict journeys, dual control,
private/public runtime stages, accessibility, thirteen strict zero-diff Linux
Chromium baselines, and seven-route performance budgets.

Accepted non-blocking follow-up risks are a missing visible current-page
navigation state, the mutable upstream Playwright container tag in CI, and the
absence of a dedicated dirty-upgrade harness that deliberately seeds stale
authority rows before the migration preflight. Fresh reset, constraint, RPC,
and full pgTAP coverage are green, but these follow-ups must not be described as
closed by the checkpoint.

The checkpoint was frozen from parent
`5b9fb6e49ee3fcbcfc63336c810cbb1cc3bff93a` as candidate
`33e66c4175676355c275db091eb876bae81e29cf` with tree
`c0fc2ce7e8d4584ee2f7ed5ae2fb72e54b69ade6`. The exact local receipt is
`sha256:46ce7276a7e4c8206245651182376e615c1878d168fff1daa002cc4400f39dcf`.
Gitea candidate run ID `78` (UI `61`) passed both required jobs. GitHub Actions
run `29388840669` named one-shot hosted-web job `87267621311` passed all
fifteen target steps and retained unexpired artifact `8332525171`; sixteen
other failed jobs and two skipped jobs executed zero steps, so acceptance is
scoped to the named job.

GitHub PR `#19` squash-merged the identical tree as product-code commit
`72ce471f378db36dfeb4faa31ec52c05e2e57654`. Gitea protected sync PR `#9`
fast-forwarded that exact merge after sync-branch run ID `79` (UI `62`) and PR
run ID `80` (UI `63`) passed; post-merge `main` run ID `81` (UI `64`) passed
both required jobs. Candidate static/database receipts are
`sha256:c65091486359bc69286b0a65fd2e4935be57cc2535125e3a527250550eeb7ae1`
and `sha256:8f94a6b39c6f3a60686b24da2b62a99d9a619e08d1bed06a301b24dd14d3a4bf`;
post-merge receipts are
`sha256:f718f5cde176c4b5260808f2c228a4bf19541d7c4a61f10451d19c436cc5c50e`
and `sha256:fb26de51345999ddce4f85a5bff4d42b9c6a9b854e874349546b34b714116a34`.
One-shot runner `32` and all isolated resources were removed.

At integration, GitHub and protected Gitea both resolved the exact product
merge and tree. The later documentation/tests-only receipt descendant records
that boundary but is not a new product candidate. Moving remote heads must be
verified live; `72ce471f378db36dfeb4faa31ec52c05e2e57654` is the latest accepted
product-code merge, not an immutable current-`main` assertion.

This posture is remote source acceptance, not a production claim. Deployment,
live OAuth, operator credential custody, live RLS probes, encrypted off-host
restore, public traffic, indexing, and open-user launch remain unverified.

## Production gates and residual risk

Before remote alpha: resolve the current Cloudflare/OpenNext Next.js 16 Node-runtime proxy/middleware blocker or choose another approved zero-recurring-cost host; the failed evaluation is not a deploy receipt. Then follow the hosted-alpha runbook, configure exact OAuth redirects, provision distinct operator principals with reviewed credential custody, verify security headers/cookies, test backup and restore with named incident ownership, run real-data accessibility/performance checks, validate rate/cost controls, and retest the deployed grant/RLS/dual-control matrix. Before package/TUF phases: complete the package/TUF/SSRF/signing adversarial suites and a signing-key recovery exercise. Before current-letter automated grading: complete receipt authority, anti-gaming review, held-out behavioral evidence, appeal/takedown handling, and the updated privacy/legal assessment.

Residual model behavior, provider compromise, novel package formats, false-negative audits, key compromise, and legal disputes cannot be eliminated; the system limits blast radius through separate evidence states, immutable subjects, quarantine/revocation, metadata-only operation, and reversible gated rollout.
