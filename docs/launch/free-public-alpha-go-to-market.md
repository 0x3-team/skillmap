# SkillMap free public alpha go-to-market kit

Status: launch-ready copy and operating template; the current go-to-market/dual-control working slice is locally accepted but not yet frozen, pushed, remotely accepted, merged, deployed, or verified live. Publishing is blocked until the production-readiness gate records a live `GO` or explicitly scoped `CONDITIONAL GO`.

## Current handoff

The current integrated repository head is
`f168448a0fc89bcf12fcbe4905a5b4123030f902` on both GitHub `main` and protected
Gitea `main`. It is GitHub PR `#16`, a release-documentation reconciliation whose
direct parent `a4f97fa0d32b1abaaf29bc38f81d81cbc593b04b` remains the last accepted
product-code merge and the commit covered by the completion-audit candidate CI.
The later local candidate records audit policy `skillmap-static-audit/v2` and
worker `skillmap-worker/0.2.0`, adds an opaque-file audit/grade hard gate,
current-publisher-authorization enforcement for report intake, literal
visitor/submitter acquisition paths, recorded freshness signals, and mandatory
dual control for five consequential operator RPCs. Authorization,
collision-review, and publication success require strict validation of the
exact single-row RPC projection and expected key/value. Root `npm test` passed
`440/440` with zero failures, cancellations, or skips; the focused suite passed
`45/45`; and pgTAP passed `585/585`. Final
`npm --prefix apps/web run test:hosted-gates` passed API,
Chromium/Firefox/WebKit authentication, acquisition/composed-launch,
dual-control, accessibility/responsive/forced-colors, private/public-stage,
thirteen strict zero-diff visual, and cleanup gates. Those later-slice receipts
are local only.

Next source action: freeze and push an exact candidate commit/tree, run the required
Gitea candidate jobs and authorized one-shot GitHub hosted-web job, merge the
identical tree, reconcile protected Gitea/GitHub `main`, and record runner,
resource, temporary-credential, and branch cleanup. The current
Cloudflare/OpenNext evaluation is blocked at the Next.js 16 Node-runtime
proxy/middleware boundary; resolve that boundary or select another approved
zero-recurring-cost host before any deployment claim.

## Market wedge

Audience: developers and skill authors who use several agent skills and need to know which exact version they are looking at, what it can do, what authority it requests, and what evidence supports its quality claims.

Positioning: **Find agent skills you can inspect, compare, and trust.**

The launch product is a free, curated, metadata-only directory. Users can browse, save, and submit an exact public GitHub skill version. SkillMap fetches bounded inert source evidence, never executes submitted scripts, separates audit, compatibility, license, provenance, and grade states, and requires operator review before publication.

Do not claim that SkillMap proves a skill is safe, indexes every skill, mirrors every package, improves every prompt, or has launched until live acceptance proves it.

## Launch gate

The public announcement may be sent only when all boxes are checked:

- [x] Baseline-only candidate `67129297d08f7f7bc88800015b336a2a7bb1b139` with tree `3a70dbafca99153ad80d67601a5b2e3bbc2d47d5` was pushed and accepted by Gitea candidate run `44` plus GitHub Actions run `29285742074`, JIT hosted-web job `86937705880`; the identical tree was squash-merged as `main` commit `29a356a9b809d29ff8c986fbd5a0af78d87e479c`, and post-merge Gitea `main` run `47` passed. The GitHub receipt is scoped only to that hosted-web job. Frozen receipts: static `sha256:3dd68b69f5faad0e6cf70e03dbf98cedb735ed5661dc2c6a8d01c799ed7b2996`; database `sha256:ada2c9d819dce02a3b89971c44119eb96ef89f244ccd692439e80281f64056d1`. This historical baseline remains independently scoped and is supplemented by the operator read-plane receipt below.
- [x] The operator read-plane candidate `69e7d1e7f2042ae996c1bed379891ec65ece84a4` with tree `67235ad3ce1553c4b3ba47a36c8e22f9c53cf89c` passed Gitea candidate run `50` and GitHub Actions run `29294494176`, one-shot self-hosted hosted-web job `86964954830`; GitHub PR `#12` squash-merged the identical tree as `main` commit `8a30578520974257a1ab4ee2f6c7442696ee0289`. Gitea protected sync PR `#2` retained that exact commit, with sync-branch run `51`, PR run `52`, and post-merge `main` run `53` passed. The GitHub receipt is scoped only to the named hosted-web job: unrelated GitHub-hosted jobs remained allowance-blocked, so the overall workflow was red. The one-shot runner self-removed and the repository reported zero registered runners afterward. Frozen receipts: static `sha256:7dec38b69c6b709c13f6e0aac4d5f6767411e3a2b2e07b3226b87f16902bdd13`; database `sha256:74b8e840a2e1b5343df5daa79d8bbb2bc08d28bdd54ebd51277c9d912bc37fa6`. This is source-integration proof only, not deployment, live verification, indexing, or launch proof.
- [x] The launch-readiness candidate `e6fc09e9d8300fbd5bb974899cb18b5d1b2d8af6` with tree `94c910c02b224bd421905126da7c783a8f3fb0d7` passed Gitea candidate run `57` and GitHub Actions run `29299879085`, one-shot self-hosted hosted-web job `86981228569`; GitHub PR `#14` squash-merged the identical tree as `main` commit `426efb1af480dff57713d604bac617cea0e00ef2`. Gitea protected sync PR `#4` retained that exact commit, with sync-branch run `58`, PR run `59`, and post-merge `main` run `60` passed. All fifteen hosted-web steps succeeded and one unexpired `hosted-web-browser` artifact was retained. The GitHub receipt is scoped only to the named hosted-web job: unrelated GitHub-hosted jobs remained allowance-blocked, so the overall workflow was red. The one-shot runner self-removed, dedicated resources and temporary credentials were deleted, and both remotes resolved `main` to the exact merge. Frozen receipts: static `sha256:79509a1ba5ad50b6b9be09a47c761268b71c261695cdee30d0839309ef11ce85`; database `sha256:3bd274cd5043819a9d5bc707000f70aad3500ef2540874c6a2d4aa0e23238715`. This is source-integration proof only, not deployment, live verification, indexing, or launch proof.
- [x] The completion-audit candidate `918a5015bcb8c264f9fe39c6cdd7940e67aef02e` with tree `29aba50561cbb9f79d15a8b8257076ff671fd1ee` passed Gitea candidate run `61` and GitHub Actions run `29304994899`, one-shot self-hosted hosted-web job `86996452876`; GitHub PR `#15` squash-merged the identical tree as `main` commit `a4f97fa0d32b1abaaf29bc38f81d81cbc593b04b`. Gitea protected sync PR `#5` retained that exact commit, with sync-branch run `62`, PR run `63`, and post-merge `main` run `64` passed. All fifteen hosted-web steps succeeded and unexpired `hosted-web-browser` artifact `8299987067` was retained. The GitHub receipt is scoped only to the named hosted-web job: unrelated GitHub-hosted jobs remained allowance-blocked, so the overall workflow was red. The one-shot runner self-removed, dedicated resources and temporary credentials were deleted, remote feature/sync branches were removed, and both remotes resolved `main` to the exact merge. Frozen receipts: static `sha256:c4a847a64e2811f34eb5a8babd6f536b624f50826647707238a0cd13cf0ed350`; database `sha256:fa53fa1a4026ce180bce8048d6aeb9a6a3aa8549a9143d9186304de69e13f5a1`. This is source-integration proof only, not deployment, live verification, indexing, or launch proof.
- [x] GitHub PR `#16` subsequently reconciled those completion-audit release records as commit `f168448a0fc89bcf12fcbe4905a5b4123030f902` with tree `4d12e1783b52f97239f1f86e0b1b9059c45fa37a` and direct parent `a4f97fa0d32b1abaaf29bc38f81d81cbc593b04b`; a live read-only release audit verified both GitHub and Gitea `main` at `f168448...`. This records the current repository head only. It neither replaces the parent's product-candidate CI scope nor proves deployment, live verification, indexing, or launch.
- [x] The later go-to-market/dual-control working slice records audit policy `skillmap-static-audit/v2` and worker `skillmap-worker/0.2.0`; authorization, collision-review, and publication success require the exact single-row RPC projection and expected key/value. Root `npm test` passed `440/440` with zero failures, cancellations, or skips; focused tests passed `45/45`; and the local database gate passed eleven ordered migrations plus pgTAP `585/585`. Final `npm --prefix apps/web run test:hosted-gates` passed API, Chromium/Firefox/WebKit authentication, acquisition/composed-launch, dual-control, accessibility/responsive/forced-colors, private/public-stage, thirteen strict zero-diff visual, and cleanup gates. Browser-backed representative dual-control evidence retained three approvals and three distinct executions, denied service-role-only and approver-as-executor calls, cleaned all synthetic auth/catalog/operator rows, and restored four triggers. This checkbox proves local acceptance only.
- [ ] Freeze and push that working slice as an exact candidate commit/tree, pass the required Gitea candidate jobs and authorized one-shot GitHub hosted-web job, merge the identical tree, reconcile protected Gitea/GitHub `main`, and record cleanup. Neither the `a4f97fa...` product receipt nor its `f168448...` documentation reconciliation covers the current working tree.
- [ ] Resolve the Cloudflare/OpenNext Next.js 16 Node-runtime proxy/middleware blocker or select another approved zero-recurring-cost host; record an exact deploy artifact and origin separately from source CI.
- [ ] Production Supabase, web, OAuth, domain, worker, backup, incident, and support owners are recorded.
- [ ] `SKILLMAP_SUPPORT_URL` opens an approved public HTTPS page with support, formal-appeal, and confidential security-report instructions; `/support` links to it while signed out.
- [ ] Production migrations, generated types, secrets, callback URLs, and indexing mode are verified.
- [ ] Anonymous browse/search/detail and public evidence pages pass live smoke checks.
- [ ] Two-account sign-in, save, submit, status, withdrawal, export, and deletion pass live smoke checks.
- [ ] One benign and one hostile exact-commit submission complete the operator workflow without row surgery.
- [ ] Retry, replay, report, quarantine/revocation, database restore, and web rollback are exercised.
- [ ] Responsive, keyboard, screen-reader, CSP, RLS, rate-limit, performance, and secret-canary gates pass.
- [ ] The initial catalog has at least 20 fully evidenced versions across five useful comparison groups.
- [ ] The dedicated five-seat hosted pilot passes: at least four people finish uncoached and uncoached receipts cover browse/evidence, save/return, submit/status, and author follow-through through receipt-backed publication inspection.
- [ ] The public policy pack is approved for the chosen operating jurisdiction and support identity.
- [ ] The source/acquisition channel is explicit: either make the GitHub repository public and verify free branch protection/rulesets, or keep it private, retain protected Gitea `main` as the source control, and remove GitHub repository/release notes from public acquisition and support copy. A paid GitHub fallback is not authorized.

## Initial corpus plan

Curate four evidenced versions in each group before indexing is enabled:

1. Frontend design and UI implementation.
2. Code review, security review, and acceptance testing.
3. Research, documentation, and technical writing.
4. Deployment, infrastructure, and production operations.
5. Skill authoring, discovery, routing, and maintenance.

Each group should include alternatives or complements that make comparison useful. A version counts only when its immutable source, license disposition, audit receipt, compatibility evidence, grade state, and lifecycle state are truthful and linked.

The locally prepared candidate is pinned in `initial-corpus-v1.json` and operated through `initial-corpus-operations.md`. It contains 20 exact Apache-2.0/MIT versions across the five groups, but every entry remains blocked pending publisher consent. Preparation, source qualification, or a static audit does not count as ingestion or publication.

## Ninety-second demo

1. Open the search-first homepage: “SkillMap is a free directory for agent skills with version-bound trust evidence.”
2. Search for a real task, open one result, and show the exact repository, commit, and `SKILL.md` path.
3. Open audit methodology: “Submitted content is treated as inert evidence. SkillMap does not run bundled scripts.”
4. Open the grade explanation: “A static scan can be provisional or blocked; a current letter needs package-, audit-, host-, rubric-, suite-, baseline-, and evaluator-bound evidence.”
5. Sign in, save the skill, then submit a public GitHub URL with a full commit and canonical path.
6. Show the account-owned queued state and withdraw control.
7. Show the bounded worker receipt, have one credentialed operator approve the exact publication envelope, have a distinct executor publish it before expiry, then open the canonical current-version public page and its immutable operator attribution.
8. Close with: “Accounts and submissions are free. There is no checkout, subscription, entitlement, or billing system.”

## Announcement copy

### Public launch

> SkillMap is now open as a free, curated directory for agent skills.
>
> Browse and compare skills by exact source version, inspect separate provenance, license, audit, compatibility, and grade evidence, save useful skills, or submit a public GitHub skill for review.
>
> SkillMap treats submitted content as untrusted and inert: it does not execute bundled scripts or accept mutable branch links. Static checks do not become a “safe” badge, and current grades require version-bound reproducible evidence.
>
> There is no billing or paid tier in this alpha. Start with the catalog, read the methodology, and tell us what would make skill discovery more trustworthy.

### Private pilot invitation

> I am testing SkillMap, a free directory and audit workflow for agent skills. I would like you to try one real task without coaching: find a skill, inspect its evidence, save it, or submit an exact public GitHub version. The session takes about 15 minutes. I am testing whether the trust states and workflow are understandable—not your technical ability.

## Direct outreach templates

### Skill user

Subject: Can you test a trust-first agent skill directory?

> I am inviting five early users to test SkillMap. It is a free, curated directory that keeps source identity, license, audit, compatibility, and grade evidence separate. Could you spend 15 minutes finding a skill you would actually consider using and tell me what still feels ambiguous? No payment details and no local prompt or skill upload are required.

### Skill author

Subject: Would you submit one public skill to SkillMap?

> SkillMap is testing a free exact-version submission and independent audit workflow. You submit a public GitHub repository, full commit, and `SKILL.md` path; SkillMap treats the source as inert, publishes metadata only after review, and links every trust claim to version-bound evidence. Would you try the flow with one skill and review the resulting listing?

## Pilot protocol

Recruit exactly five participants: three regular skill users and two authors who control an authorized public skill. Assign the five seats and workflows from `hosted-alpha-pilot-runbook.md` before recruitment; participants do not choose an easier workflow. Do not explain the UI after the opening prompt.

Record only task completion, elapsed time, route names, bounded error codes, and volunteered feedback. Do not record raw prompts, private repository data, tokens, or submitted skill bodies in analytics or research notes.

Pass target: at least four of five participants finish uncoached **and** the cohort contains an uncoached receipt for every mandatory workflow: browse/evidence, save/return, submit/status, and author follow-through through receipt-backed publication inspection. If the only assigned seat for a mandatory workflow fails, the cohort cannot pass even if four other seats finish. Every failure is fixed, explicitly accepted as a known limitation, or blocks launch.

Run and record these sessions with the dedicated [hosted alpha pilot runbook](./hosted-alpha-pilot-runbook.md). The similarly named root `docs/external-pilot-runbook.md` belongs to the local tarball/dashboard product and is not evidence for this hosted public-alpha gate.

## Feedback survey

1. What task were you trying to complete?
2. Did you finish it without help? (`yes`, `partly`, `no`)
3. Which evidence most influenced your decision: source, license, audit, compatibility, grade, publisher, or none?
4. Which label or status was hardest to understand?
5. What information was missing before you would use or submit the skill?
6. Did any screen ask for more data or authority than you expected?
7. How disappointed would you be if SkillMap disappeared? (`not`, `somewhat`, `very`)
8. May we contact you for one follow-up? Store consent separately from product analytics.

## Privacy-safe launch metrics

Aggregate daily counts only:

- catalog visitors and returning visitors;
- successful GitHub sign-ins;
- saves and unsaves;
- submissions created, withdrawn, completed, rejected, and published;
- queue and review duration percentiles;
- audit outcome and publication-rate counts;
- report and appeal counts;
- pilot task completion.

Never include raw prompts, skill bodies, repository credentials, user email, OAuth metadata, full IP addresses, or private operator notes. Metrics do not influence search rank or grades. Define an explicit retention window before enabling collection.

## First-week operating checklist

Daily:

- review queue depth, oldest queued item, failed attempts, claim leases, and review age;
- review error rate, auth failures, rate-limit pressure, report intake, and lifecycle changes;
- review expired/conflicting operator approvals, denied service-role-only mutation attempts, and approver/executor attribution without logging either credential;
- treat GitHub provider-budget deferrals as upstream capacity signals, not submission failures; investigate sustained deferrals before retrying or increasing worker frequency;
- sample one published receipt and reproduce its source/version binding;
- answer support requests and publish any user-visible incident or known limitation;
- compare funnel counts with redacted logs and investigate unexplained divergence;
- preserve a backup receipt and confirm the last restore exercise remains within policy.

On any trust, privacy, credential, or data-integrity incident: pause submissions and indexing, preserve bounded evidence, rotate affected credentials, revoke or quarantine impacted listings, follow the rollback/restore runbook, and do not reopen until a fresh live gate passes.

## FAQ

**Is SkillMap free?** Yes. The launch product has no checkout, subscription, entitlement, or billing system. Infrastructure capacity may be rate-limited so the free service remains operable.

**Does an audit mean a skill is safe?** No. The audit records bounded evidence and findings. It cannot prove the absence of harmful behavior.

**Does SkillMap run submitted code?** No. Submitted text and files are inspected as inert bytes under size, path, host, and timeout limits. A binary or non-UTF-8 file that cannot be statically inspected blocks the audit and grade.

**Why require a full commit?** A branch or tag can move. An immutable commit lets users and reviewers reproduce the exact source identity.

**Why might a skill have no letter grade?** Static or incomplete evidence remains provisional or blocked. A current letter requires all hard gates and subject-bound behavioral evidence.

**Does SkillMap host the package?** Third-party launch listings are metadata-only and point to the exact public source. Package mirroring and installation are not launch features.

**Can an author buy a better result?** No. There is no billing path, and product analytics do not affect grades or organic relevance.

**How do I challenge a listing or finding?** Use the authenticated suspicious-listing report workflow. The operator can quarantine or revoke a listing while preserving evidence history; formal appeals remain a support-managed alpha process rather than a separate product workflow.
