# Hosted Skill Library Threat Model

Status: historical Phase 0 baseline plus a locally accepted hosted launch candidate. The current source adds exact-source audit/grade hard gates, report authorization enforcement, and five-RPC operator dual control, but it is not yet an exact remotely accepted candidate and has not been deployed or verified live. Revisit before remote provisioning, artifact serving, signing keys, new evaluation authority, or production traffic.

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

## Current locally accepted candidate posture

The current source candidate now includes exact-commit public GitHub ingestion,
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
grade. The final local acceptance receipt records audit policy
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

The current repository integration boundary is
`f168448a0fc89bcf12fcbe4905a5b4123030f902` on both GitHub and Gitea `main`,
as verified by a live read-only release audit. That commit reconciles release
documentation and release-truth tests and is the direct child of
`a4f97fa0d32b1abaaf29bc38f81d81cbc593b04b`, the last accepted product-code
merge. Neither commit contains this later hardening/dual-control working slice.

This posture is not a remote source or production claim. The exact candidate,
push, Gitea/GitHub acceptance, merge, deployment, live OAuth, operator credential
custody, live RLS probes, and public traffic remain unverified for this slice.

## Production gates and residual risk

Before remote alpha: freeze and push the exact source candidate, pass required Gitea and one-shot GitHub hosted-web acceptance, merge/reconcile protected `main`, and retain cleanup receipts. Resolve the current Cloudflare/OpenNext Next.js 16 Node-runtime proxy/middleware blocker or choose another approved zero-recurring-cost host; the failed evaluation is not a deploy receipt. Then follow the hosted-alpha runbook, configure exact OAuth redirects, provision distinct operator principals with reviewed credential custody, verify security headers/cookies, test backup and restore with named incident ownership, run real-data accessibility/performance checks, validate rate/cost controls, and retest the deployed grant/RLS/dual-control matrix. Before package/TUF phases: complete the package/TUF/SSRF/signing adversarial suites and a signing-key recovery exercise. Before current-letter automated grading: complete receipt authority, anti-gaming review, held-out behavioral evidence, appeal/takedown handling, and the updated privacy/legal assessment.

Residual model behavior, provider compromise, novel package formats, false-negative audits, key compromise, and legal disputes cannot be eliminated; the system limits blast radius through separate evidence states, immutable subjects, quarantine/revocation, metadata-only operation, and reversible gated rollout.
