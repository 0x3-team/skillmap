# SkillMap hosted worker

This directory is the constrained Node worker boundary for hosted source ingestion, audit, provisional grading, queue processing, and metadata-only publication. It is deliberately separate from the browser-facing Next.js application.

## Hard database preflight

Do not start a worker or service-role operator command until `20260713060000_operator_submission_read_plane.sql`, `20260714010000_atomic_report_enforcement.sql`, `20260714030000_github_provider_rate_limit_deferral.sql`, `20260714050000_report_authorization_enforcement.sql`, `20260714060000_operator_dual_control.sql`, and every preceding migration are applied and the exact candidate has passed database lint, full pgTAP, generated `api` type parity, and the web application typecheck. The raw `database.types.ts` stays byte-exact for generator comparison; `database.runtime.types.ts` corrects nullable return fields for only the three operator `RETURNS TABLE` RPCs. `process-once` peeks one exact candidate, checks an unauthenticated GitHub core budget with a two-request shared-egress reserve, claims only that candidate, and unconditionally renews a successful claim through `api.renew_skill_submission_claim`. A raced primary or secondary provider limit returns the exact claim to `queued`, retains a bounded retry time, and refunds the audit attempt without a worker-run row. Publication requires claim-scoped exact license evidence, current publisher authorization, and target-bound collision authority. Report intake independently requires that same current authorization, report confirmation requires one atomic exact-version quarantine or revocation, and both operator queues use paired cursors. Consequential publisher-authorization, collision-review, publication, lifecycle, and report-disposition commands require a short-lived exact-envelope approval from an approver and execution by a distinct executor. The atomic-enforcement migration fails closed if the target contains legacy resolved reports; reconcile those exact targets through a reviewed forward migration instead of bypassing the guard. Operator-before-migration is a hard `NO_GO`, not a recoverable compatibility mode. Follow [the free public alpha runbook](../../docs/operations/free-public-alpha-runbook.md#hard-worker-migration-gate) before the first run and after every database deploy.

The first executable slice is a non-mutating exact-commit audit rehearsal:

```bash
npm run hosted:audit:dry-run -- \
  --repository OWNER/REPOSITORY \
  --commit FULL_LOWERCASE_COMMIT_SHA \
  --source-path path/to/SKILL.md \
  --license-state noassertion \
  --output /tmp/skillmap-audit-receipt.json
```

Use `--license-state confirmed --spdx MIT` only after an operator has actually concluded the license evidence. A submitter's license claim is not confirmation.

Safety boundary:

- public GitHub repositories and immutable commits only
- an unauthenticated GitHub repository metadata preflight rejects private, internal, non-public, redirected, and non-200 repositories
- bounded tree, file, timeout, retry, and concurrency limits
- exact Git tree/blob verification through the shared source fetcher
- repository metadata, commit, tree, blob, and raw-content requests are all unauthenticated
- primary-limit 403/429 responses and bounded secondary-limit responses are typed as provider backpressure; provider timing is honored without premature retries
- static inspection only; submitted content and scripts are never executed
- no database claim, review, grade promotion, or publication in dry-run mode
- output is created with owner-only permissions and refuses to overwrite an existing file
- `GITHUB_TOKEN` is never read or sent, and the worker never adds an `Authorization` header

Public visibility does not establish permission to redistribute repository contents. With confirmed license evidence and a structurally declared host reference, the dry run may emit a low-confidence provisional score with no letter; unresolved license or critical audit evidence remains blocked. It is not the final public hosted grade-receipt projection. A static scan is not a safety certification and cannot mint a current letter grade.

## Operator queue workflow

Every service-role operator command requires server-only environment variables and an explicit supported mode. For `hosted:queue:list` and `hosted:queue:inspect`, `--execute` confirms use of the protected service credential; both commands remain read-only and report `mutation: false`.

Five consequential commands use dual control instead of a single `--execute`: publisher authorization, collision review, publication, catalog lifecycle, and report disposition. An approver loads only their server-side `SKILLMAP_OPERATOR_CREDENTIAL` and runs the exact command with `--approve`. The result returns an `opa_...` approval ID. Before its 30-minute expiry, a distinct executor loads their own credential and repeats every action argument and operation UUID byte-for-byte, replacing `--approve` with `--execute --approval-id opa_...`. Never place either `smo_v1_...` credential on the command line, in metadata, logs, receipts, or shell history. An approval is exact-envelope-bound, single-action, and safe to replay only as the same executor retrying the same operation.

```bash
# Load SKILLMAP_SUPABASE_URL and SKILLMAP_SUPABASE_SERVICE_ROLE_KEY from the
# approved root-only runtime secret source; never type the key into shell history.
test -n "$SKILLMAP_SUPABASE_URL"
test -n "$SKILLMAP_SUPABASE_SERVICE_ROLE_KEY"
# For the five dual-controlled commands only, load one operator's credential
# from that operator's separate root-only secret source.
test -n "$SKILLMAP_OPERATOR_CREDENTIAL"

# Read the queue summary and the oldest active submissions without claiming one.
# Omit --state for queued, processing, accepted, changes-requested, and failed.
npm run hosted:queue:list -- --execute --limit 20

# Filter one exact state. Limits are 1 through 32.
npm run hosted:queue:list -- --execute --state queued --limit 20

# Continue from the exact nextCursor returned by the preceding list response.
# The timestamp and submission ID cursor fields must always be supplied together.
npm run hosted:queue:list -- \
  --execute --state queued --limit 20 \
  --after-updated-at 2026-07-13T21:38:40.079Z \
  --after-submission-id sub_0123456789abcdef0123456789abcdef

# Inspect one exact submission and its bounded redacted receipt history.
npm run hosted:queue:inspect -- \
  --execute --submission-id sub_0123456789abcdef0123456789abcdef

# Claim and audit one row. Without confirmed license review this will request changes.
npm run hosted:queue:process-once -- --execute --submission-id sub_...

# Accept only after an operator verifies the license disposition.
npm run hosted:queue:process-once -- \
  --execute --submission-id sub_... \
  --license-state confirmed --spdx MIT \
  --license-review-reference licref_0123456789abcdef0123456789abcdef \
  --license-review-evidence-digest sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  --license-evidence-path LICENSE \
  --disposition accepted

# --license-evidence-path is optional when the bounded submitted directory
# already contains its license. Repeat it at most 20 times only for exact root
# or enclosing LICENSE/COPYING files reviewed at the submitted immutable commit.

# Inspect the immutable completion-time and current-catalog collision subject.
# A collision must receive an explicit reviewed disposition before publication.
npm run hosted:collisions:list -- --execute --submission-id sub_...
npm run hosted:collisions:review -- \
  --approve --submission-id sub_... --disposition approved-distinct \
  --reason-code independently-reviewed-source \
  --operation-id 00000000-0000-4000-8000-000000000000

# Append the redacted publisher authorization after the exact submission is
# accepted and the evidence reference/digest have been independently retained.
# The same authorized command, with fresh evidence and expiry, renews an expired
# or expiring exact still-published source version without a new submission.
# Expiry automatically hides the listing; renewal restores it. A revoked,
# blocked, or quarantined exact version cannot be renewed. Revocation records a
# private redacted tombstone and is terminal for the exact repository, commit,
# and path across accounts and publisher handles.
npm run hosted:publisher:authorization -- \
  --approve --submission-id sub_... --publisher-handle publisher-handle \
  --decision authorized --basis publisher-owner-approval \
  --evidence-reference authref_0123456789abcdef0123456789abcdef \
  --evidence-digest sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef --expires-at 2026-10-01T00:00:00.000Z \
  --operation-id 00000000-0000-4000-8000-000000000000

# Consent withdrawal is a terminal append-only decision. It accepts no basis or
# expiry and atomically blocks every version at the exact source coordinates.
npm run hosted:publisher:authorization -- \
  --approve --submission-id sub_... --publisher-handle publisher-handle \
  --decision revoked \
  --evidence-reference authref_fedcba9876543210fedcba9876543210 \
  --evidence-digest sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  --operation-id 11111111-1111-4111-8111-111111111111

# Publish reviewed metadata after the completion state and any collision are accepted.
cp apps/worker/examples/reviewed-publication.example.json /tmp/reviewed-publication.json
npm run hosted:queue:publish -- \
  --approve --submission-id sub_... --metadata /tmp/reviewed-publication.json \
  --operation-id 22222222-2222-4222-8222-222222222222

# Requeue an eligible failed or changes-requested item.
npm run hosted:queue:requeue -- --execute --submission-id sub_...

# Terminalize one exact expired fifth-attempt claim. Use this only after the
# queue alert identifies the exact submission and its lease is expired.
npm run hosted:queue:dead-letter -- \
  --execute --submission-id sub_... \
  --operation-id 00000000-0000-4000-8000-000000000000

# Quarantine or revoke a listing without editing rows by hand. Generate a new
# operation UUID for each consequential operator decision; replay the same UUID
# only when retrying the exact same decision.
npm run hosted:catalog:lifecycle -- \
  --approve --skill-id skl_... --version-id skv_... \
  --action quarantine-version --reason-code security-review \
  --operation-id 00000000-0000-4000-8000-000000000000

# Read queued report IDs through a bounded paired-cursor service projection,
# then resolve one with a bounded public reply and atomic exact-target action.
npm run hosted:reports:queue -- --execute --limit 20
npm run hosted:reports:disposition -- \
  --approve --report-id rpt_... --disposition confirmed \
  --reason-code listing-quarantined --public-message "The version was quarantined for review." \
  --lifecycle-action quarantine-version \
  --operation-id 00000000-0000-4000-8000-000000000000

# Emit one identifier-free readiness receipt; exit 2 means alerts are active.
npm run hosted:operations:check -- --execute
```

`process-once` can return `provider-deferred` as a handled result. `mutation: false` means the read-only budget gate stopped before claim; `mutation: true` means a post-claim provider race was atomically returned to `queued`. Neither consumes one of the five audit attempts. If persisting the post-claim deferral fails, the command exits nonzero and leaves the exact lease recoverable; it does not terminalize the submission as `failed`.

`hosted:queue:list` returns one aggregate snapshot plus at most the requested number of deterministic least-recently-updated rows. Supported exact state filters are `queued`, `processing`, `changes-requested`, `rejected`, `failed`, `accepted`, `published`, and `withdrawn`. Its `nextCursor.updatedAt` and `nextCursor.submissionId` values map directly to the paired cursor options above. Resume only with the same state filter. This is a best-effort live cursor, not an MVCC snapshot, CDC feed, exhaustive scan, or at-least-once delivery contract. A later update can replay a submission, and a transaction that began before the current page can commit behind its cursor. Deduplicate by submission ID plus `updated_at`; after reaching the end, restart once from no cursor and reconcile the IDs, timestamps, and summary counts before treating an operating pass as complete. `hosted:queue:inspect` returns exactly one submission plus bounded audit, grade, review, worker, transition, license-evidence metadata, collision-review, and publisher-authorization projections. Neither command exposes submitter or actor account IDs, internal claim IDs, private evidence digests, raw skill or license contents, or unrestricted history.

Never export the service-role value into the web-server or browser environment. Queue RPCs are allowlisted, same-origin, bounded, and redact provider bodies from errors. The read commands do not claim, complete, requeue, publish, or otherwise mutate a submission. GitHub source requests remain fully unauthenticated even when the Supabase operator credential is present.

Static evidence can produce a low-confidence provisional integer score with no band. It cannot produce a current letter. Current authority additionally requires exact signed compatibility and behavioral receipts from a configured trusted Ed25519 issuer.
