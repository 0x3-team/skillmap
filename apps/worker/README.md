# SkillMap hosted worker

This directory is the constrained Node worker boundary for hosted source ingestion, audit, provisional grading, queue processing, and metadata-only publication. It is deliberately separate from the browser-facing Next.js application.

## Hard database preflight

Do not start a worker until `20260713020000_backend_completion_hardening.sql` and every preceding migration are applied and the exact candidate has passed database lint, full pgTAP, and generated `api` type parity. `process-once` unconditionally renews its claim through `api.renew_skill_submission_claim`; publication also requires the collision-evidence authority introduced by the final hardening migration. Worker-before-migration is a hard `NO_GO`, not a recoverable compatibility mode. Follow [the free public alpha runbook](../../docs/operations/free-public-alpha-runbook.md#hard-worker-migration-gate) before the first run and after every database deploy.

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
- static inspection only; submitted content and scripts are never executed
- no database claim, review, grade promotion, or publication in dry-run mode
- output is created with owner-only permissions and refuses to overwrite an existing file
- `GITHUB_TOKEN` is never read or sent, and the worker never adds an `Authorization` header

Public visibility does not establish permission to redistribute repository contents. With confirmed license evidence and a structurally declared host reference, the dry run may emit a low-confidence provisional score with no letter; unresolved license or critical audit evidence remains blocked. It is not the final public hosted grade-receipt projection. A static scan is not a safety certification and cannot mint a current letter grade.

## Operator queue workflow

The mutating commands require server-only environment variables and an explicit `--execute` flag:

```bash
# Load SKILLMAP_SUPABASE_URL and SKILLMAP_SUPABASE_SERVICE_ROLE_KEY from the
# approved root-only runtime secret source; never type the key into shell history.
test -n "$SKILLMAP_SUPABASE_URL"
test -n "$SKILLMAP_SUPABASE_SERVICE_ROLE_KEY"

# Claim and audit one row. Without confirmed license review this will request changes.
npm run hosted:queue:process-once -- --execute --submission-id sub_...

# Accept only after an operator verifies the license disposition.
npm run hosted:queue:process-once -- \
  --execute --submission-id sub_... \
  --license-state confirmed --spdx MIT --disposition accepted

# Inspect the immutable completion-time and current-catalog collision subject.
# A collision must receive an explicit reviewed disposition before publication.
npm run hosted:collisions:list -- --execute --submission-id sub_...
npm run hosted:collisions:review -- \
  --execute --submission-id sub_... --disposition approved-distinct \
  --reason-code independently-reviewed-source \
  --operation-id 00000000-0000-4000-8000-000000000000

# Publish reviewed metadata after the completion state and any collision are accepted.
cp apps/worker/examples/reviewed-publication.example.json /tmp/reviewed-publication.json
npm run hosted:queue:publish -- \
  --execute --submission-id sub_... --metadata /tmp/reviewed-publication.json

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
  --execute --skill-id skl_... --version-id skv_... \
  --action quarantine-version --reason-code security-review \
  --operation-id 00000000-0000-4000-8000-000000000000

# Read the oldest queued report IDs through a bounded service-only projection,
# then resolve one with a bounded public reply.
npm run hosted:reports:queue -- --execute --limit 20
npm run hosted:reports:disposition -- \
  --execute --report-id rpt_... --disposition confirmed \
  --reason-code listing-quarantined --public-message "The version was quarantined for review." \
  --operation-id 00000000-0000-4000-8000-000000000000
```

Never export the service-role value into the web-server or browser environment. Queue RPCs are allowlisted, same-origin, bounded, and redact provider bodies from errors. GitHub source requests remain fully unauthenticated even when the Supabase operator credential is present.

Static evidence can produce a low-confidence provisional integer score with no band. It cannot produce a current letter. Current authority additionally requires exact signed compatibility and behavioral receipts from a configured trusted Ed25519 issuer.
