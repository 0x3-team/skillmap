# Free public alpha deployment, worker, and recovery runbook

Status: local launch-candidate runbook. It does not authorize provider creation, spending, DNS, OAuth, indexing, public announcements, or invitations. Those actions require the owner decisions in the canonical launch plan.

## Production decision record

Record these values before any remote mutation:

| Decision | Required value |
| --- | --- |
| Exact source commit | reviewed full SHA |
| Supabase owner/project/region/plan | owner-approved target and free-tier limits |
| Web owner/project/plan | owner-approved target and recurring-cost boundary |
| Canonical origin | exact HTTPS origin |
| GitHub OAuth owner | organization, app, callback, secret custodian |
| Worker host/schedule | server-only environment and operator |
| Backup/restore owner | named operator and off-host encrypted target |
| Incident/rollback owner | named operator and contact path |
| Support/security/license owner | named people or explicit single-owner assignment |
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
supabase db lint --local --level warning
supabase test db --local

tmp_types=$(mktemp)
supabase gen types typescript --local --schema api | sed -e '${/^$/d;}' > "$tmp_types"
cmp "$tmp_types" apps/web/lib/supabase/database.types.ts
rm -f "$tmp_types"

npm run test:cross-browser
npm run test:a11y
npm run test:visual
npm run test:perf
npm run test:consumer-install
npm run test:release-path
npm pack --dry-run
git diff --check
```

Record each gate separately. A skipped browser, auth, database, backup, or live check is blocked, not passed.

### Hard worker migration gate

Do not start `hosted:queue:process-once`, a scheduler, or any queue consumer until migration `20260713003000_launch_safety_reports_lifecycle.sql` is applied to the target. The worker unconditionally calls `api.renew_skill_submission_claim`; worker-before-migration is a hard `NO_GO` because a claimed row could otherwise fail during source processing.

Before the first worker start and after every database deploy:

```bash
supabase migration list --linked
# Verify 20260713003000 is present in both the local and remote columns.
supabase db push --linked --dry-run

# Against the exact candidate locally:
supabase db reset --local
supabase db lint --local --level warning
supabase test db --local
tmp_types=$(mktemp)
supabase gen types typescript --local --schema api | sed -e '${/^$/d;}' > "$tmp_types"
cmp "$tmp_types" apps/web/lib/supabase/database.types.ts
rm -f "$tmp_types"
```

On the deployed target, repeat the migration list and linked generated-type parity check after `supabase db push --linked`. Record the exact migration version, pgTAP verdict, and type digest in the deployment receipt. An unverified migration list, skipped pgTAP, or type mismatch blocks worker start.

## Environment boundaries

The web deployment receives only:

- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SKILLMAP_INDEXING_MODE=private-alpha` until public acceptance
- reviewed public rate-limit tuning values

The operator worker receives, from a root-only runtime secret source:

- `SKILLMAP_SUPABASE_URL`
- `SKILLMAP_SUPABASE_SERVICE_ROLE_KEY`

The service-role value must never enter the web deployment, client bundle, shell history, screenshots, logs, CI artifacts, or GitHub source requests. GitHub ingestion remains unauthenticated and public-only.

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

# Use the approved host command and record its deployment ID and exact commit.
vercel deploy --prod --cwd apps/web
```

Do not push local-only Supabase auth configuration. Configure the production Site URL, one exact application callback, GitHub provider callback, exposed `api` schema, and provider secrets deliberately in the production dashboard.

## Submission operator workflow

1. Open the account-owned submission status or query the bounded operator queue.
2. Verify the source is a public GitHub repository, full immutable commit, canonical path, and the intended version.
3. Review the applicable license file. A submitter claim is not license confirmation.
4. Process exactly one row:

   ```bash
   npm run hosted:queue:process-once -- \
     --execute --submission-id sub_... \
     --license-state confirmed --spdx Apache-2.0 --disposition accepted
   ```

5. Inspect the redacted completion receipt. Static evidence may create a provisional numeric score with no band; it cannot create a current letter.
6. Copy and review the publication metadata template outside the repository.
7. Publish transactionally:

   ```bash
   npm run hosted:queue:publish -- \
     --execute --submission-id sub_... --metadata /tmp/reviewed-publication.json
   ```

8. Verify the public catalog/detail projection and account result point to the exact new skill/version IDs.
9. Delete the temporary metadata file if it contains operator-only notes. The template must contain public fields only.

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

Alert on:

- oldest queued row above the reviewed response target;
- any live claim beyond its five-minute lease;
- repeated failure or the five-attempt ceiling;
- a receipt/state contradiction;
- publication replay digest conflicts;
- unexpected queue growth, auth failure, rate limiting, or report volume; and
- any private schema, service credential, or hidden lifecycle disclosure.

Reclaim only expired leases through the reviewed claim RPC. Never rewrite claim IDs, receipt rows, review rows, or public pointers manually.

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
