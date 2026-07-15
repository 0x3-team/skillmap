# SkillMap Product Checkpoint Implementation Plan

Date: 2026-07-15
Status: active implementation authority
Programs: `checkpoint-quality-loop` -> `audit-orchestrator` -> `planning-orchestrator` -> `implementation-orchestrator` -> `engineering-acceptance-review`
Repository worktree: `/tmp/skillmap-product-checkpoint`
Branch: `codex/product-checkpoint`
Baseline commit: `5b9fb6e49ee3fcbcfc63336c810cbb1cc3bff93a`
Baseline tree: `8d74d820235657a0060bcca7b514392c073bb3b1`
Receipt ledger: `docs/plans/2026-07-15-skillmap-product-checkpoint-implementation-plan-implementation-ledger.jsonl`

## Decision and boundary

This checkpoint owns the remaining locally actionable product, trust, accessibility,
workflow, release-truth, and CI-source defects in the current repository candidate.
It does not treat local source acceptance as deployment or public-launch evidence.

The checkpoint may pass only when every confirmed P1/P2 source finding below is
closed with executable evidence and an independent acceptance review. A passing
source checkpoint still leaves public launch at `NO-GO` until the external launch
gates in this plan close.

No billing, payment, entitlement, package execution, private-source ingestion, or
current-letter-grade authority is added by this plan.

## Source-of-truth contract

Executable artifacts own behavior in this order:

1. append-only Supabase migrations, RLS/grants, and pgTAP tests;
2. runtime worker and web contracts plus focused tests;
3. browser, accessibility, visual, performance, release, and packaging gates;
4. canonical runbooks and release receipts;
5. this plan and its append-only ledger.

The supported hosted evidence tuple for this checkpoint is exact:

| Field | Required value |
| --- | --- |
| worker | `skillmap-worker/0.2.0` |
| audit policy | `skillmap-static-audit/v2` |
| rubric | `skillmap-rubric/v1` |
| evaluator | `skillmap-grader/0.1.0` |
| host profile | `codex-host/v1` |

Changing any tuple member requires a new reviewed migration and matching runtime,
fixture, publication, and release evidence. Bounded arbitrary strings are not an
authority boundary.

## Baseline receipt

The exact clean baseline passed:

- root dependency install and production audit with zero vulnerabilities;
- web dependency install and production audit with zero vulnerabilities;
- root `npm test`: 440/440 passed;
- `npm run check:web`: hosted boundaries 32/32 plus typecheck, lint, and build;
- repository secret canary;
- release-truth tests 4/4;
- `git diff --check`;
- focused backend/security/local-connector tests 71/71;
- Supabase local schema lint with no warnings.

The baseline is not accepted because passing tests preserved the authority and
workflow defects below.

## Frozen audit findings

### P1-1: stale audit/worker authority can reach publication

The runtime emits audit v2 and worker 0.2.0, but active database functions accept
arbitrary bounded worker and audit versions. Publication checks receipt linkage but
does not require the current evidence tuple. A stale worker can therefore retain and
publish structurally valid evidence that bypasses current v2 hard gates.

Acceptance:

- unsupported worker versions fail before claim selection, lease, attempt, or row mutation;
- completion rejects every wrong tuple member transactionally and retains no receipts or worker run;
- retained unsupported accepted evidence cannot publish through the real dual-control path;
- current tuple completion, publication, and exact replay still pass;
- migration preflight fails closed if an existing accepted/published row has an unsupported tuple;
- no old migration is edited.

### P1-2: hosted keyboard users cannot bypass repeated navigation

Hosted routes have one main landmark but no shared skip link or focusable target.
The packaged local app already implements and tests this contract.

Acceptance:

- the first focusable hosted control is a visible-on-focus “Skip to main content” link;
- activating it focuses the unique `#main-content` target;
- all hosted route outcomes, including error/unavailable branches, have exactly one target;
- automated browser evidence covers home, catalog, detail, submit, and account surfaces;
- no horizontal overflow or visual regression is introduced.

### P1-3: production bootstrap would publish broken exact-source links

`supabase/seed.sql` points at a private repository while the production runbook uses
`--include-seed`. Anonymous exact-source access currently returns 404. The source
requirement must not be weakened.

Acceptance:

- production deployment never applies the local seed;
- the seed is explicitly classified as local development/test data;
- production corpus publication uses the normal authenticated submission, current
  worker/evidence, dual-control authorization, and publication path;
- release-truth tests reject a production `--include-seed` instruction;
- public launch remains blocked until 20 owner-authorized, anonymously readable
  exact-source listings pass the corpus receipt.

### P1-4: initial-corpus publisher authorization command cannot execute

The runbook supplies `--execute` without a prior approval or `--approval-id` even
though the CLI requires a distinct approver and executor.

Acceptance:

- the runbook shows an exact approve command and a byte-identical execute command;
- execution reuses the same operation UUID and the returned approval ID;
- the two commands require distinct credentialed roles;
- release-truth tests bind the documentation to this contract.

### P2-1: an old queued report with changed text is shown as an outage

The database correctly permits only one queued report for an account/version/category,
but the 23505 recovery lookup also requires identical message text. A changed message
after 24 hours therefore returns `service-unavailable` instead of the owner-visible
pending report.

Acceptance:

- queued-target conflicts resolve by owner-safe skill/version/category/state identity;
- successful insert and exact idempotent retry continue to resolve the inserted row;
- an older queued row with a different message returns `duplicate` and its valid ID;
- cross-account data remains inaccessible and generic database failures remain outages.

### P2-2: mobile landing has no direct account route

Below `sm`, the home header hides Sign in/Account and neither the command palette nor
footer replaces it.

Acceptance:

- signed-out, authenticated, and unavailable account states remain directly reachable
  and truthful at 320/390px;
- the control fits without overflow and retains a useful accessible name;
- mobile signed-out and authenticated browser assertions cover it.

### P2-3: privacy hierarchy overstates the local-only promise

The privacy H1 says private input stays local while hosted account, submission, OAuth,
report, and tombstone storage is disclosed only several screens later.

Acceptance:

- H1 and intro explicitly distinguish local data from hosted service storage;
- detailed existing disclosures remain intact;
- route metadata summarizes both boundaries without making a universal local-only claim.

### P2-4: public acquisition/trust pages inherit home social metadata

`/skills` has no route metadata and `/privacy` and `/security` override only title,
leaving home OpenGraph values and root URL in link previews.

Acceptance:

- `/skills`, `/privacy`, and `/security` use the shared public metadata builder;
- browser title, description, canonical, OpenGraph, and Twitter fields are route-specific;
- rendered metadata assertions prevent regression.

### P2-5: canonical release truth contains superseded current-state claims

The threat model says the candidate lacks remote acceptance while later sections record
it. The implementation plan also describes the older product merge as current remote
head. Historical receipts must remain immutable, but current status must be explicit.

Acceptance:

- current source status distinguishes the historical product candidate/merge from
  current dual-remote main `5b9fb6e...`;
- source acceptance, exact-current-commit CI, deployment, and live verification remain
  separate states;
- negative release-truth assertions reject the contradictory phrases.

### P2-6: GitHub CI dependency and runtime declarations drift

GitHub Actions use mutable major tags while Gitea already pins reviewed action commits.
The web package requires Node >=22 but GitHub's web matrix still includes Node 20.

Acceptance:

- GitHub Actions are pinned to immutable official action commits with version comments;
- the web matrix tests supported Node 22 and the deployment-target Node 24, not Node 20;
- workflow source tests reject mutable action tags and unsupported web runtimes.

### Accepted P3 follow-up

Hosted navigation does not expose a consistent visible current-page state or
`aria-current`. This is a real usability improvement but does not block this checkpoint
after the P1/P2 workflow and truth gaps close. Record it as post-checkpoint UX work unless
the implementation naturally introduces a low-risk shared navigation primitive.

## Implementation sequence

### Slice A — evidence authority migration (HIGH tier)

Files:

- new `supabase/migrations/20260715010000_hosted_evidence_version_authority.sql`
- current-path fixtures under `supabase/tests/`
- focused source contract tests under `test/`

Steps:

1. Add private immutable tuple predicates owned by migrations and unavailable for
   service-role mutation.
2. Wrap the active claim RPC so unsupported workers fail before delegating to the
   current provider-deferral-aware body.
3. replace audit and grade receipt validators with exact tuple enforcement.
4. Add insertion authority constraints for new audit/grade receipts without silently
   relabeling historical rows.
5. Wrap the real dual-control publication RPC with a retained-evidence invariant and
   a migration-time accepted/published-row preflight.
6. Update positive current-path fixtures and add negative stale/future tuple probes.
7. Run focused pgTAP first, then database reset/lint/full pgTAP/type parity.

Stop conditions: any unsupported tuple can mutate claim state, retain a receipt, create
a worker run, or publish; a positive current tuple or exact replay regresses; migration
rewrites historical evidence.

### Slice B — report lifecycle recovery (HIGH tier)

Files:

- `apps/web/app/skills/[publisher]/[slug]/report-actions.ts`
- hosted boundary/action/database browser tests

Steps:

1. Separate post-insert exact-row lookup from queued-target conflict lookup.
2. On queued-target 23505, query only the owner-filtered projection and require
   skill/version/category/queued identity.
3. Preserve exact idempotency behavior and add old-row/different-message regression.

Stop conditions: a cross-account or non-queued row can be returned; unrelated unique
violations are mislabeled as pending; a healthy pending report still appears as outage.

### Slice C — hosted accessibility and mobile acquisition (MEDIUM tier)

Files:

- `apps/web/app/layout.tsx`, hosted main shells, and `apps/web/app/globals.css`
- `apps/web/components/skillmap/landing-page.tsx`
- `apps/web/scripts/hosted-frontend-qa.mjs`
- hosted boundary/browser/visual tests

Steps:

1. Add one shared skip link and one focusable `#main-content` target to every hosted
   main outcome.
2. Make the home account state directly available at 320/390px.
3. Add first-focus, focus-transfer, signed-out/authenticated mobile, containment, and
   reduced-motion assertions.
4. Regenerate a visual baseline only after deterministic repeatability is proven and
   the expected change is manually inspected.

### Slice D — privacy, metadata, seed, runbook, and release truth (MEDIUM tier)

Files:

- `apps/web/app/{skills,privacy,security}/page.tsx`
- `supabase/seed.sql`
- `docs/operations/hosted-alpha-deploy.md`
- `docs/launch/initial-corpus-operations.md`
- `docs/security/hosted-threat-model.md`
- canonical implementation/release documents
- `test/release-truth-consistency.mjs` and web metadata tests

Steps:

1. Correct privacy hierarchy and route-specific metadata.
2. Make seed data local-only and remove production `--include-seed` instructions.
3. Document exact dual-control approval/execution for corpus authority.
4. Reconcile current head/source/CI/deployment/live truth without rewriting historical
   receipts.
5. Add positive and negative source/rendered metadata assertions.

### Slice E — CI source hardening (MEDIUM tier)

Files:

- `.github/workflows/ci.yml`
- workflow/release source tests

Steps:

1. Pin official GitHub actions to reviewed immutable commits.
2. Align the web matrix to Node 22 and 24.
3. Run workflow contract tests and YAML parsing, then the normal source gates.

## Adversarial verification matrix

| Probe | Required result |
| --- | --- |
| malformed tuple value | 22023/fail closed; no retained mutation |
| stale worker 0.1.0 | cannot claim; queued row and attempt count unchanged |
| future worker 0.3.0 | cannot claim; queued row unchanged |
| audit v1 on a current claim | completion rolls back all evidence |
| wrong evaluator or host | completion rolls back all evidence |
| retained stale accepted receipt | dual-control publication creates no catalog row |
| exact current tuple | claim/completion/publication succeeds |
| exact replay | returns the same published result without duplicate consequences |
| old queued report + changed message | resolves existing owner-visible pending ID |
| cross-account report lookup | returns nothing |
| keyboard first Tab/Enter | skip link appears and focuses main |
| 320/390px account states | reachable, named, and no overflow |
| private seed in production command | source test fails |
| execute without approval ID | documentation contract test fails |
| stale current-source phrase | release-truth test fails |
| mutable action tag or web Node 20 | workflow source test fails |

## Integrated verification

Focused gates run immediately after each slice. Terminal verification requires:

```bash
npm test
npm run check:web
npm audit --omit=dev --audit-level=high
npm --prefix apps/web audit --omit=dev --audit-level=high
node scripts/repository-secret-canary.mjs
node --test test/release-truth-consistency.mjs
supabase db reset --local
supabase db lint --local --schema api,private,public --level warning --fail-on warning
supabase test db $(rg --files supabase/tests -g '*.test.sql' | sort)
supabase gen types typescript --local --schema api | sed -e '${/^$/d;}' > /tmp/skillmap-checkpoint-database.types.ts
cmp /tmp/skillmap-checkpoint-database.types.ts apps/web/lib/supabase/database.types.ts
npm --prefix apps/web run test:hosted-gates
node --test test/release-truth-consistency.mjs test/release-operations-ci.mjs test/release-ci-candidate-binding.mjs
npm run test:release-path
npm run test:consumer-install
npm run test:web:perf
npm pack --dry-run
git diff --check
```

Use the repository's exact scripts where command names differ. Full browser evidence
must include Chromium/Firefox/WebKit critical paths, hosted authentication, accessibility,
responsive/forced-colors, strict visual comparison, performance budgets, cleanup, and
post-cleanup pgTAP. Temporary servers, containers, users, reports, operator rows, and
receipts must be cleaned.

An independent agent must run AdversarialVerify over Slice A/B and an independent
engineering acceptance review over the integrated diff. The implementer cannot self-pass
the HIGH-tier trust boundary.

## Checkpoint acceptance and remaining launch gates

Checkpoint outcome definitions:

- `PASS`: all P1/P2 source findings closed; full local gates and independent review pass.
- `PASS WITH ACCEPTED RISKS`: same as PASS, with only explicit P3/manual/external gates.
- `FAIL`: any P1/P2 source defect, regression, unexplained test skip, dirty evidence,
  or unsupported truth claim remains.

Even after source PASS, public launch remains `NO-GO` until all of these are verified:

- exact-current-commit GitHub hosted-web CI plus protected Gitea CI;
- approved zero-recurring-cost provider and trusted edge/global abuse controls;
- production Supabase/web/worker, GitHub OAuth, canonical domain, secrets, and distinct
  operator credential custody;
- approved privacy/retention/jurisdiction/support policy and named incident/rollback owners;
- encrypted off-host backup with a proved isolated restore and web rollback;
- 20 owner-authorized, anonymously readable, receipt-backed initial corpus listings;
- five-seat hosted pilot with every mandatory uncoached workflow;
- deployed anonymous/authenticated/two-account/operator/security/accessibility/performance
  acceptance; and
- explicit public indexing promotion receipt.

No push, merge, deployment, public indexing, account/provider mutation, or repository
visibility change is authorized by this local checkpoint plan.
