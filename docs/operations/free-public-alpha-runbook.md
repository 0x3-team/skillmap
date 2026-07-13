# Free public alpha deployment, worker, and recovery runbook

Status: local launch-candidate runbook. It does not authorize provider creation, spending, DNS, OAuth, indexing, public announcements, or invitations. Those actions require the owner decisions in the canonical launch plan.

## Production decision record

Record these values before any remote mutation:

| Decision | Required value |
| --- | --- |
| Exact source commit | reviewed full SHA |
| Supabase owner/project/region/plan | owner-approved target and free-tier limits |
| Web owner/project/plan | owner-approved zero-cost-compatible target, limits, deploy command, and rollback command |
| Canonical origin | exact HTTPS origin |
| GitHub OAuth owner | organization, app, callback, secret custodian |
| Worker host/schedule | server-only environment and operator |
| Backup/restore owner | named operator and off-host encrypted target |
| Incident/rollback owner | named operator and contact path |
| Support/security/license owner | named people or explicit single-owner assignment |
| Public support intake | approved reachable HTTPS page configured as `SKILLMAP_SUPPORT_URL`, including appeal and confidential security-report instructions |
| Retention/policy version | approved public text and effective date |

Free to users means no product billing. It does not authorize an infrastructure charge.

## Exact candidate gate

Use a clean worktree at the reviewed commit. Preserve unrelated user files.

Start with the fail-closed candidate preflight. It records the exact commit and tree, requires a clean worktree, scans every tracked text file for high-confidence credential canaries, runs the root/web/package release gates, and always keeps the public launch verdict at `NO_GO` because local evidence is not deployment proof:

```bash
mkdir -p /tmp/skillmap-release-evidence
npm run preflight:public-alpha -- \
  --output /tmp/skillmap-release-evidence/exact-candidate.json
```

The output path is exclusive: use a new path for every run. The individual commands below remain the reviewable source of truth for database and browser coverage not included in that candidate command.

```bash
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

tmp_types=$(mktemp)
supabase gen types typescript --local --schema api | sed -e '${/^$/d;}' > "$tmp_types"
cmp "$tmp_types" apps/web/lib/supabase/database.types.ts
rm -f "$tmp_types"

# The raw file above must stay generator-exact. The application imports
# database.runtime.types.ts, whose narrow override restores nullable return
# fields for the three operator RETURNS TABLE RPCs. Compile-time assertions and
# the web truth contract guard both nullable and required fields.
npm --prefix apps/web run typecheck
npm --prefix apps/web run test:fixtures

# Starts one production Next.js server and runs API, authenticated account,
# non-destructive submission, report, receipt-row, export, and deletion smokes.
npm run test:hosted-gates

npm run test:cross-browser
npm run test:a11y
npm run test:visual
npm run test:perf
npm run test:consumer-install
npm run test:release-path
npm pack --dry-run
git diff --check
```

The hosted launch smoke emits its pass receipt only after every synthetic auth user is absent and the exact synthetic publisher, repository, skill, and version row counts are all zero. Any cleanup or postcondition failure makes the gate fail; a warning-only cleanup is not acceptance evidence.

Record each gate separately. A skipped browser, auth, database, backup, or live check is blocked, not passed.

### Hard worker migration gate

Do not start `hosted:queue:process-once`, a scheduler, any queue consumer, or a service-role operator command until migration `20260713060000_operator_submission_read_plane.sql` and every preceding migration are applied to the target. The worker unconditionally calls `api.renew_skill_submission_claim`, publication relies on claim-scoped exact license evidence, a current unexpired publisher authorization, target-bound collision disposition, and exact publication recheck, and queue inspection relies on the final read-plane RPCs. Operator-before-migration is a hard `NO_GO` because a claimed row could otherwise fail during source processing, make a deterministic receipt retry unrecoverable, bypass reviewed authority, or leave the operator without the supported redacted read boundary.

Before the first worker start and after every database deploy:

```bash
supabase migration list --linked
# Verify 20260713060000 is present in both the local and remote columns.
supabase db push --linked --dry-run

# Against the exact candidate locally:
supabase db reset --local
supabase db lint --local --schema api,private,public --level warning --fail-on warning
supabase test db --local
tmp_types=$(mktemp)
supabase gen types typescript --local --schema api | sed -e '${/^$/d;}' > "$tmp_types"
cmp "$tmp_types" apps/web/lib/supabase/database.types.ts
rm -f "$tmp_types"
npm --prefix apps/web run typecheck
npm --prefix apps/web run test:fixtures
```

On the deployed target, repeat the migration list and linked generated-type parity check after `supabase db push --linked`. Keep `apps/web/lib/supabase/database.types.ts` as the byte-exact generator artifact; application code imports `apps/web/lib/supabase/database.runtime.types.ts`, which narrows only the three operator RPC return shapes where PostgreSQL expressions can be null. Both the application typecheck and fixture truth contract must pass. Record migration `20260713060000`, the pgTAP verdict, and the type digest in the deployment receipt, and verify the receipt explicitly names claim-scoped license evidence, current publisher authorization, target-bound collision authority, and the redacted operator read plane. An unverified migration list, skipped pgTAP, type mismatch, failed application type assertion, or incomplete authority receipt blocks worker start.

## Environment boundaries

The web deployment receives only:

- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SKILLMAP_RELEASE_STAGE=private-alpha` until the public gate passes
- `SKILLMAP_INDEXING_MODE=private-alpha` until public acceptance
- `SKILLMAP_SUPPORT_URL` only after the owner approves one reachable public HTTPS page containing support, formal-appeal, and confidential security-report instructions
- reviewed public rate-limit tuning values

The operator worker receives, from a root-only runtime secret source:

- `SKILLMAP_SUPABASE_URL`
- `SKILLMAP_SUPABASE_SERVICE_ROLE_KEY`

The service-role value must never enter the web deployment, client bundle, shell history, screenshots, logs, CI artifacts, or GitHub source requests. GitHub ingestion remains unauthenticated and public-only.

Release copy and indexing are independently fail-closed. A private pilot uses `SKILLMAP_RELEASE_STAGE=private-alpha` with `SKILLMAP_INDEXING_MODE=private-alpha`. After every live gate, initial-corpus gate, policy approval, and external-pilot gate passes, change both values together to `public-alpha` and `public`. Setting indexing to `public` alone leaves robots private; setting the release stage alone changes truthful product copy but does not enable indexing.

## Migration and deployment

```bash
supabase link --project-ref PROJECT_REF
supabase migration list --linked
supabase db push --linked --dry-run
supabase db push --linked

tmp_types=$(mktemp)
supabase gen types typescript --linked --schema api | sed -e '${/^$/d;}' > "$tmp_types"
cmp "$tmp_types" apps/web/lib/supabase/database.types.ts
rm -f "$tmp_types"

# From apps/web, use the zero-cost provider command recorded in the production
# decision record and retain its immutable deployment ID plus exact commit.
```

Do not push local-only Supabase auth configuration. Configure the production Site URL, one exact application callback, GitHub provider callback, exposed `api` schema, and provider secrets deliberately in the production dashboard.

## Submission operator workflow

The operator queue read plane is service-role-only, bounded, redacted, and non-mutating. `--execute` confirms use of the protected credential for these reads; it does not turn them into mutation commands. List responses contain an aggregate snapshot and at most 32 deterministic least-recently-updated rows. Inspect responses contain exactly one submission and bounded receipt/history projections. Neither response contains submitter or actor account IDs, internal claim IDs, private evidence digests, or raw skill or license contents.

1. Query the bounded operator queue without claiming a submission. Omit `--state` to include the active `queued`, `processing`, `accepted`, `changes-requested`, and `failed` states, or pass one exact supported state. Use a limit from 1 through 32:

   ```bash
   npm run hosted:queue:list -- --execute --state queued --limit 20
   ```

   If the response contains `nextCursor`, pass both fields together and the same state filter to continue from that live update-order position:

   ```bash
   npm run hosted:queue:list -- \
     --execute --state queued --limit 20 \
     --after-updated-at 2026-07-13T21:38:40.079Z \
     --after-submission-id sub_0123456789abcdef0123456789abcdef
   ```

   The cursor is explicitly best-effort and live. It is not an MVCC snapshot, CDC feed, exhaustive scan, or at-least-once delivery contract. A row updated during pagination can appear again, and a transaction that began before the current page can commit behind its cursor. Deduplicate by submission ID plus `updated_at`. After reaching the end, restart from no cursor with the same filter, reconcile IDs, timestamps, and summary counts, and inspect every consequential submission by exact ID. Do not call an operating pass complete until the restart sweep is stable.

2. Inspect the selected exact submission before claiming it:

   ```bash
   npm run hosted:queue:inspect -- \
     --execute --submission-id sub_0123456789abcdef0123456789abcdef
   ```

3. Verify the source is a public GitHub repository, full immutable commit, canonical path, and the intended version.
4. Review the applicable license file. A submitter claim is not license confirmation.
5. Process exactly one row. The review reference is an opaque `licref_` value with 32 lowercase hexadecimal characters; the evidence digest is one lowercase SHA-256 digest. Include each exact root or enclosing license path reviewed at the submitted commit:

   ```bash
   npm run hosted:queue:process-once -- \
     --execute --submission-id sub_... \
     --license-state confirmed --spdx Apache-2.0 \
     --license-review-reference licref_0123456789abcdef0123456789abcdef \
     --license-review-evidence-digest sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
     --license-evidence-path LICENSE \
     --disposition accepted
   ```

6. Re-run `hosted:queue:inspect` for the same submission and inspect the durable redacted completion receipt. Static evidence may create a provisional numeric score with no band; it cannot create a current letter.
7. Load the bounded collision subject. It contains both completion-time and current-catalog evidence and never authorizes publication by itself:

   ```bash
   npm run hosted:collisions:list -- --execute --submission-id sub_...
   ```

8. If `collisionFound` is true, compare the exact matched skill/version IDs and match types, then record one immutable disposition. Use `approved-update` only when the reviewed publisher/slug is the existing skill identity, `approved-distinct` only when the source is independently legitimate, and `blocked-duplicate` when publication must stop:

   ```bash
   npm run hosted:collisions:review -- \
     --execute --submission-id sub_... --disposition approved-distinct \
     --reason-code independently-reviewed-source \
     --operation-id 00000000-0000-4000-8000-000000000000
   ```

   Publication recomputes the subject under advisory locks. A new or changed collision invalidates the old approval and fails closed. If either evidence snapshot reports `truncated: true`, its bounded matches are only an operator sample: `approved-distinct` and `approved-update` both fail closed, and publication remains blocked until the complete collision set can be reviewed.
9. Record current exact-publisher authorization with a redacted evidence reference, digest, and bounded expiry:

   ```bash
   npm run hosted:publisher:authorization -- \
     --execute --submission-id sub_... --publisher-handle publisher-handle \
     --decision authorized --basis publisher-owner-approval \
     --evidence-reference authref_0123456789abcdef0123456789abcdef \
     --evidence-digest sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef --expires-at 2026-10-01T00:00:00.000Z \
     --operation-id 00000000-0000-4000-8000-000000000000
   ```

   Expiry hides the listing at the public RLS boundary. Run the same command with fresh retained evidence, a new operation ID, and a future expiry to renew the exact still-published source version; it becomes visible again without a new submission. Wrong-handle renewal rolls back. A blocked or quarantined version cannot be renewed. Explicit revocation is terminal: it atomically blocks every published version at the exact repository URL, commit, and path and writes a private redacted tombstone. That tombstone survives submission/account deletion and remains effective across accounts and publisher handles; no identity-transfer exception exists in this launch. A stale authorized replay fails rather than reporting current authority.
10. Copy and review the publication metadata template outside the repository.
11. Publish transactionally:

   ```bash
   npm run hosted:queue:publish -- \
     --execute --submission-id sub_... --metadata /tmp/reviewed-publication.json
   ```

12. Verify the public catalog/detail projection and account result point to the exact new skill/version IDs.
13. Delete the temporary metadata file if it contains operator-only notes. The template must contain public fields only.

For unresolved evidence, omit confirmed license authority. The worker records changes-requested or failed truthfully. Requeue only after remediation:

```bash
npm run hosted:queue:requeue -- --execute --submission-id sub_...
```

The worker never executes source files. A current grade additionally requires exact signed compatibility and behavioral receipts from a configured trusted Ed25519 issuer and remains outside the static-only publication command.

## Reports and catalog lifecycle

Authenticated reports are private, immutable account records. The database allows at most five queued reports and twenty created reports per account in a rolling 24-hour window, in addition to the exact version/category cooldown. Anonymous intake remains disabled until production-global anti-spam is approved.

Use only the bounded service RPC commands; do not inspect or edit private rows by hand:

```bash
# Read at most the oldest 20 queued report projections.
npm run hosted:reports:queue -- --execute --limit 20

# Resolve one report. Reuse an operation UUID only to retry this exact payload.
npm run hosted:reports:disposition -- \
  --execute --report-id rpt_... --disposition confirmed \
  --reason-code listing-quarantined \
  --public-message "The version was quarantined for review." \
  --operation-id 00000000-0000-4000-8000-000000000000

# Hide a disputed version from the catalog and both evidence projections.
npm run hosted:catalog:lifecycle -- \
  --execute --skill-id skl_... --version-id skv_... \
  --action quarantine-version --reason-code credible-security-report \
  --operation-id 00000000-0000-4000-8000-000000000000
```

Each consequential command needs a newly generated canonical UUID. Exact retries must reuse the same UUID and the same subject, action, reason, disposition, and public message; conflicting replay payloads fail closed. Restoration is allowed only when the exact version still has a valid, non-restricted, receipt-backed publication chain. Quarantine or revoke first when continued public exposure may cause harm, then disposition the report with bounded public copy.

## Queue and reliability checks

Run `npm run hosted:queue:list -- --execute --limit 32` before each operating pass. The summary exposes bounded counts and oldest timestamps; rows expose only the redacted fields needed to identify expired claims, retry-eligible submissions, dead-letter candidates, and accepted submissions awaiting publication review. Use `hosted:queue:inspect` for the exact submission before any consequential command.

Alert on:

- oldest queued row above the reviewed response target;
- any live claim beyond its five-minute lease;
- repeated failure or the five-attempt ceiling;
- a receipt/state contradiction;
- publication replay digest conflicts;
- unexpected queue growth, auth failure, rate limiting, or report volume; and
- any private schema, service credential, or hidden lifecycle disclosure.

Reclaim only expired leases through the reviewed claim RPC. When an exact fifth-attempt claim expires, it is no longer reclaimable and must be terminalized through the service-only dead-letter receipt path:

```bash
npm run hosted:queue:dead-letter -- \
  --execute --submission-id sub_... \
  --operation-id 00000000-0000-4000-8000-000000000000
```

The command accepts only an expired processing claim at the attempt ceiling, records a cancelled worker run, moves the submission to a truthful terminal failure, and is idempotent only for the exact operation UUID and payload. Never rewrite claim IDs, receipt rows, review rows, collision decisions, or public pointers manually.

## Backup and restore

Before invitations and on the approved schedule:

1. export schema, migration history, auth/account data, submissions, private receipts, reviews, worker runs, lifecycle state, and catalog rows to a root-only temporary location;
2. encrypt the backup with an operator-owned key and copy it off-host;
3. restore into an isolated disposable environment;
4. rerun migrations, type parity, RLS/pgTAP, catalog row/digest checks, cross-account isolation, and one queue replay;
5. record timestamp, exact commit, encrypted artifact digest, bounded row counts, and restore verdict; and
6. remove all unencrypted temporary data.

An export without a tested restore is not a backup receipt.

For the local destructive rehearsal, start from a disposable local Supabase stack. The command exports only application data from `auth`, `api`, and `private`, records bounded table and sequence digests plus migration versions, resets from reviewed migrations, replays the dump in one transaction, compares every table and sequence, lints the rebuilt database, deletes the plaintext dump, and retains a private receipt. Supabase owns `auth.schema_migrations`: the CLI data dump excludes it, the rehearsal never truncates it, and the migration-version comparison proves the reset rebuilt the same platform history without a duplicate restore:

```bash
npm run preflight:public-alpha:recovery -- \
  --execute \
  --output /tmp/skillmap-release-evidence/local-recovery.json
supabase test db --local
```

`--execute` is deliberately mandatory because this resets local data. The local receipt is not encrypted off-host backup retention or hosted-provider restore proof; those remain separate production gates.

## Live acceptance and indexing

With indexing still disabled, verify:

- landing, catalog, detail, trust, privacy, security, support, submit, and account routes;
- the signed-out `/support` route reaches the approved `SKILLMAP_SUPPORT_URL`; a private-repository-only tracker or missing URL blocks public alpha;
- malformed API input, hidden/not-found parity, no-store, global/provider rate limits, and CSP/security headers;
- GitHub OAuth, callback, session refresh, logout, two-account isolation, save/unsave, submit/status/withdraw, export, and self-delete;
- benign accepted publication, license-unresolved remediation, hostile-source blocking, retry/reclaim, and idempotent publish replay;
- report/quarantine/revocation behavior when that launch gate is enabled;
- desktop, 320/390 px, 200% zoom, keyboard, screen reader, forced colors, performance, and zero unexpected browser diagnostics;
- absence of service keys, OAuth secrets, private findings, user IDs, raw content, and canaries in HTML, JavaScript, logs, screenshots, and deployment metadata; and
- backup restore and web rollback against the exact candidate.

Indexing changes from private to public only after the production gate is `GO`, the initial 20-version corpus is complete, and external pilots pass. Record the indexing change as its own consequential receipt.

## Incident and rollback

- Web regression: roll back to the previous exact deployment and rerun anonymous/authenticated smoke checks.
- Queue/worker defect: stop the worker, preserve leases and receipts, keep submissions visible with truthful state, fix forward, and replay idempotently.
- Trust or source defect: quarantine the affected version immediately; do not delete evidence history.
- Database defect: pause mutations and indexing, take an encrypted backup, restore or forward-fix from reviewed migrations, and rerun RLS/type/live gates.
- OAuth or credential compromise: disable the provider/worker, rotate the secret, revoke sessions, inspect bounded logs, and rerun callbacks and secret-canary checks.
- Privacy or legal report: quarantine when continued exposure could cause harm, preserve evidence privately, and follow the approved takedown/appeal policy.

No invitation or public announcement resumes until the incident owner records cause, impact, remediation, rotations, rollback/restore evidence, and a fresh exact-commit live verdict.

## Cleanup

After every rehearsal:

```bash
supabase stop --no-backup
rm -f /tmp/skillmap-worker-live.json /tmp/reviewed-publication.json
```

Also remove synthetic users, saves, submissions, reports, OAuth credentials, temporary dumps, web processes, and unexpected preview variables. Record `validated locally`, `pushed`, `deployed`, `verified live`, `indexing enabled`, and `publicly launched` as distinct states.
