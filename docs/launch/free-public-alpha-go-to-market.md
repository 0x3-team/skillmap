# SkillMap free public alpha go-to-market kit

Status: launch-ready copy and operating template; publishing is blocked until the production-readiness gate records a live `GO` or explicitly scoped `CONDITIONAL GO`.

## Market wedge

Audience: developers and skill authors who use several agent skills and need to know which exact version they are looking at, what it can do, what authority it requests, and what evidence supports its quality claims.

Positioning: **Find agent skills you can inspect, compare, and trust.**

The launch product is a free, curated, metadata-only directory. Users can browse, save, and submit an exact public GitHub skill version. SkillMap fetches bounded inert source evidence, never executes submitted scripts, separates audit, compatibility, license, provenance, and grade states, and requires operator review before publication.

Do not claim that SkillMap proves a skill is safe, indexes every skill, mirrors every package, improves every prompt, or has launched until live acceptance proves it.

## Launch gate

The public announcement may be sent only when all boxes are checked:

- [ ] Exact candidate commit is pushed, reviewed, and accepted by authoritative CI.
- [ ] Production Supabase, web, OAuth, domain, worker, backup, incident, and support owners are recorded.
- [ ] `SKILLMAP_SUPPORT_URL` opens an approved public HTTPS page with support, formal-appeal, and confidential security-report instructions; `/support` links to it while signed out.
- [ ] Production migrations, generated types, secrets, callback URLs, and indexing mode are verified.
- [ ] Anonymous browse/search/detail and public evidence pages pass live smoke checks.
- [ ] Two-account sign-in, save, submit, status, withdrawal, export, and deletion pass live smoke checks.
- [ ] One benign and one hostile exact-commit submission complete the operator workflow without row surgery.
- [ ] Retry, replay, report, quarantine/revocation, database restore, and web rollback are exercised.
- [ ] Responsive, keyboard, screen-reader, CSP, RLS, rate-limit, performance, and secret-canary gates pass.
- [ ] The initial catalog has at least 20 fully evidenced versions across five useful comparison groups.
- [ ] Five external pilots run; at least four people complete browse, save, or submit without operator coaching.
- [ ] The public policy pack is approved for the chosen operating jurisdiction and support identity.

## Initial corpus plan

Curate four evidenced versions in each group before indexing is enabled:

1. Frontend design and UI implementation.
2. Code review, security review, and acceptance testing.
3. Research, documentation, and technical writing.
4. Deployment, infrastructure, and production operations.
5. Skill authoring, discovery, routing, and maintenance.

Each group should include alternatives or complements that make comparison useful. A version counts only when its immutable source, license disposition, audit receipt, compatibility evidence, grade state, and lifecycle state are truthful and linked.

## Ninety-second demo

1. Open the search-first homepage: “SkillMap is a free directory for agent skills with version-bound trust evidence.”
2. Search for a real task, open one result, and show the exact repository, commit, and `SKILL.md` path.
3. Open audit methodology: “Submitted content is treated as inert evidence. SkillMap does not run bundled scripts.”
4. Open the grade explanation: “A static scan can be provisional or blocked; a current letter needs package-, audit-, host-, rubric-, suite-, baseline-, and evaluator-bound evidence.”
5. Sign in, save the skill, then submit a public GitHub URL with a full commit and canonical path.
6. Show the account-owned queued state and withdraw control.
7. Run the operator command, show the bounded receipt, approve and publish, then open the canonical current-version public page.
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

Recruit five participants: three regular skill users and two skill authors. Do not explain the UI after the opening prompt.

Ask each participant to complete one primary task:

- find a skill for a real job and explain why they would or would not trust it;
- save a skill and return to it from the account page; or
- submit an exact public skill version and interpret its status.

Record only task completion, elapsed time, route names, bounded error codes, and volunteered feedback. Do not record raw prompts, private repository data, tokens, or submitted skill bodies in analytics or research notes.

Pass target: four of five participants complete their task without operator coaching. Every failure is fixed, explicitly accepted as a known limitation, or blocks launch.

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
- sample one published receipt and reproduce its source/version binding;
- answer support requests and publish any user-visible incident or known limitation;
- compare funnel counts with redacted logs and investigate unexplained divergence;
- preserve a backup receipt and confirm the last restore exercise remains within policy.

On any trust, privacy, credential, or data-integrity incident: pause submissions and indexing, preserve bounded evidence, rotate affected credentials, revoke or quarantine impacted listings, follow the rollback/restore runbook, and do not reopen until a fresh live gate passes.

## FAQ

**Is SkillMap free?** Yes. The launch product has no checkout, subscription, entitlement, or billing system. Infrastructure capacity may be rate-limited so the free service remains operable.

**Does an audit mean a skill is safe?** No. The audit records bounded evidence and findings. It cannot prove the absence of harmful behavior.

**Does SkillMap run submitted code?** No. Submitted text and files are inspected as inert bytes under size, path, host, and timeout limits.

**Why require a full commit?** A branch or tag can move. An immutable commit lets users and reviewers reproduce the exact source identity.

**Why might a skill have no letter grade?** Static or incomplete evidence remains provisional or blocked. A current letter requires all hard gates and subject-bound behavioral evidence.

**Does SkillMap host the package?** Third-party launch listings are metadata-only and point to the exact public source. Package mirroring and installation are not launch features.

**Can an author buy a better result?** No. There is no billing path, and product analytics do not affect grades or organic relevance.

**How do I challenge a listing or finding?** Use the authenticated suspicious-listing report workflow. The operator can quarantine or revoke a listing while preserving evidence history; formal appeals remain a support-managed alpha process rather than a separate product workflow.
