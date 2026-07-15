# Hosted Skill Library Threat Model

Status: historical Phase 0 baseline plus a remotely accepted product-code boundary. The last accepted product candidate and merge are recorded below. At the 2026-07-15 checkpoint anchor, GitHub and protected Gitea `main` both resolve to the later documentation/release-receipt commit `5b9fb6e49ee3fcbcfc63336c810cbb1cc3bff93a` with tree `8d74d820235657a0060bcca7b514392c073bb3b1`. Gitea runs `75` through `77` passed that anchor, but GitHub workflow run `29320562416` failed before any job steps because hosted-runner allowance was unavailable; exact-current GitHub `hosted-web-browser` acceptance therefore remains open. Nothing in this document claims deployment or live verification. Revisit before remote provisioning, artifact serving, signing keys, new evaluation authority, or production traffic.

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

## Historical accepted candidate and current local checkpoint

The last remotely accepted product-code candidate includes exact-commit public GitHub ingestion,
bounded inert audit and provisional grading, authenticated report intake,
operator-reviewed publication/lifecycle, and account-owned submission workflows.
It still does not execute submitted content, mirror third-party packages, publish
TUF metadata, or issue a current letter grade from static evidence alone.

Migration `20260714050000_report_authorization_enforcement.sql` requires a new
report target to remain the exact current public version and to retain current
publisher authorization. Migration `20260714060000_operator_dual_control.sql`
keeps the service role as transport but requires immutable 30-minute
exact-envelope approval and distinct execution for five consequential RPCs.
Opaque binary/non-UTF-8 admitted files are critical audit findings and block the
grade. The historical local acceptance receipt records audit policy
`skillmap-static-audit/v2` and worker `skillmap-worker/0.2.0`. Authorization,
collision-review, and publication clients accept a protected RPC success only
after strict validation of the exact single-row projection and expected
key/value. Root `npm test` passed `440/440` with zero failures, cancellations,
or skips; focused tests passed `45/45`; and pgTAP passed `585/585`. Final
`npm --prefix apps/web run test:hosted-gates` passed API,
Chromium/Firefox/WebKit authentication, acquisition/composed-launch,
dual-control, accessibility/responsive/forced-colors, private/public-stage,
thirteen strict zero-diff visual, and cleanup gates. Representative browser
journeys retained three approvals and three executions, denied
service-role-only and approver-as-executor calls with SQLSTATE `42501`, and
cleaned all synthetic operator/catalog/auth state.

Those `440/440`, `45/45`, `585/585`, and thirteen-baseline results are the
historical candidate's acceptance record; they are not claimed as the current
checkpoint's final test receipt.

The local 2026-07-15 checkpoint patch adds migration
`20260715010000_hosted_evidence_version_authority.sql` to bind worker, audit,
grade, and publication success to one exact current evidence-authority tuple.
It also adds migration
`20260715020000_hosted_report_idempotency_recovery.sql` so owner-scoped request
identity distinguishes a true report replay from a reused request ID and from a
different queued payload. The patch also closes the recorded accessibility,
production-seed, metadata, mutable-CI-source, and release-truth gaps. It remains
local, uncommitted, unpushed, undeployed, and not remotely accepted; its final
local gate passed root tests `448/448`, hosted boundary tests `35/35`, release
path tests `47/47`, pgTAP `621/621`, schema lint, generated-type parity, web
typecheck/lint/build, clean consumer installation, package inspection,
production dependency audits, secret scanning, and the static preflight. The
composed hosted gate also passed three-browser authentication, the report
request-ID/queued-target conflict journeys, dual control, private/public runtime
stages, accessibility, and thirteen strict zero-diff Linux Chromium baselines.
The final performance gate stayed below its budgets on all seven routes. These
receipts validate the local patch only; the product-checkpoint implementation
ledger retains the aggregate result and the remaining launch boundary.

Accepted non-blocking follow-up risks are a missing visible current-page
navigation state, the mutable upstream Playwright container tag in CI, and the
absence of a dedicated dirty-upgrade harness that deliberately seeds stale
authority rows before the migration preflight. Fresh reset, constraint, RPC,
and full pgTAP coverage are green, but these follow-ups must not be described as
closed by the checkpoint.

The historical remotely accepted product-code boundary is candidate
`413d8759e244005406280cd8d7c2fe2ec01b84bf` with tree
`00273fce90c0294f4f3aea2407d4ba0c65aec1f9`, squash-merged as
`8bb2b1d25befeb53e13d0e05a6934dacc9d45cd7` on both GitHub and protected
Gitea `main`. Gitea run IDs `70` through `73` (UI runs `53` through `56`)
passed their recorded candidate, sync, pull-request, and post-merge scopes. GitHub Actions run `29317179590`
one-shot hosted-web job `87033792983` passed all fifteen steps; unrelated
GitHub-hosted jobs were allowance-blocked, so that acceptance remains scoped to
the named job.

That `413d8759`/`8bb2b1d2` receipt remains the last exact product-code receipt;
it must not be misreported as the repository's current remote head. The later
dual-remote `5b9fb6e4` checkpoint anchor records release documentation and does
not supply the missing exact-current GitHub authority receipt. This checkpoint
remediation is neither pushed nor remotely accepted until it receives its own
candidate, merge, and required-CI receipts.

This posture is remote source acceptance, not a production claim. Deployment,
live OAuth, operator credential custody, live RLS probes, encrypted off-host
restore, public traffic, indexing, and open-user launch remain unverified.

## Production gates and residual risk

Before remote alpha: resolve the current Cloudflare/OpenNext Next.js 16 Node-runtime proxy/middleware blocker or choose another approved zero-recurring-cost host; the failed evaluation is not a deploy receipt. Then follow the hosted-alpha runbook, configure exact OAuth redirects, provision distinct operator principals with reviewed credential custody, verify security headers/cookies, test backup and restore with named incident ownership, run real-data accessibility/performance checks, validate rate/cost controls, and retest the deployed grant/RLS/dual-control matrix. Before package/TUF phases: complete the package/TUF/SSRF/signing adversarial suites and a signing-key recovery exercise. Before current-letter automated grading: complete receipt authority, anti-gaming review, held-out behavioral evidence, appeal/takedown handling, and the updated privacy/legal assessment.

Residual model behavior, provider compromise, novel package formats, false-negative audits, key compromise, and legal disputes cannot be eliminated; the system limits blast radius through separate evidence states, immutable subjects, quarantine/revocation, metadata-only operation, and reversible gated rollout.
