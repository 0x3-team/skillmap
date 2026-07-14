# Changelog

## Unreleased — experimental free public alpha

The latest completed product source-integration boundary recorded here is
completion-audit candidate `918a5015bcb8c264f9fe39c6cdd7940e67aef02e` and tree
`29aba50561cbb9f79d15a8b8257076ff671fd1ee`, merged as `main` commit
`a4f97fa0d32b1abaaf29bc38f81d81cbc593b04b`. The earlier baselines remain
separate historical rows in the append-only release ledger. This
source-integration boundary does not prove a tag, package publication,
deployment, live OAuth, public indexing, open-user launch, or verified-live
status. Subsequent Unreleased product changes require their own candidate and
merge receipt before this boundary covers them.

The completion-audit changes below are included in that source-integration
boundary:

- Preserved safe submission values, request identifiers, validation feedback,
  and deterministic focus across recoverable server-side submission failures;
  account history now exposes the submission update timestamp used by recovery
  and operator support.
- Added a GitHub provider-budget gate before exact candidate claim plus an
  atomic post-claim deferral path for bounded primary, secondary, and reset-time
  rate limits. Deferrals return work to the queue without consuming an attempt
  or fabricating a worker-run failure, while separate cooldown/defer telemetry
  keeps upstream capacity visible to operators.

- Recorded Gitea candidate run `61`, GitHub Actions run `29304994899`
  one-shot self-hosted hosted-web job `86996452876`, artifact `8299987067`,
  GitHub PR `#15`, Gitea protected sync PR `#5`, and Gitea sync-branch, PR,
  and post-merge `main` runs `62`, `63`, and `64` as passed. The one-shot
  runner self-removed; its dedicated containers and volumes, temporary Gitea
  users and tokens, and remote feature/sync branches were deleted. The overall
  GitHub workflow remained red only because unrelated GitHub-hosted jobs were
  organization-allowance blocked; acceptance is scoped solely to the named
  hosted-web job. The frozen static receipt is
  `sha256:c4a847a64e2811f34eb5a8babd6f536b624f50826647707238a0cd13cf0ed350`;
  the frozen database receipt is
  `sha256:fa53fa1a4026ce180bce8048d6aeb9a6a3aa8549a9143d9186304de69e13f5a1`.
  These are source and scoped-CI receipts, not deployment or live-product proof.

- Added an identifier-free, no-store hosted health endpoint and a bounded
  service-only operations checker with explicit queue-age, backlog, retry,
  expired-claim, failure, and dead-letter alert thresholds.
- Made confirmed suspicious-listing disposition atomically quarantine or revoke
  its exact reported version; added paired report pagination, retained
  report/lifecycle replay outcomes, legacy-upgrade guards, maximum Unicode-page
  transport coverage, and stricter operator result validation.
- Moved the mobile save/sign-in action ahead of long evidence and reporting
  content at 320px and 390px, retained the desktop sticky panel, froze visual
  time deterministically, and prevented authenticated clients from forging
  profile creation timestamps.
- Updated public security truth, deployment/runbook contracts, generated API
  types, candidate preflight bindings, cross-browser hosted smokes, and eleven
  reviewed strict visual baselines for the launch-readiness slice.

- Recorded Gitea candidate run `57`, GitHub Actions run `29299879085` one-shot
  self-hosted hosted-web job `86981228569`, GitHub PR `#14`, Gitea protected
  sync PR `#4`, and Gitea sync-branch, PR, and post-merge `main` runs `58`,
  `59`, and `60` as
  passed. The one-shot runner self-removed and the GitHub repository reported
  zero registered runners afterward. The overall GitHub workflow remained red
  only because unrelated GitHub-hosted jobs were organization-allowance blocked;
  acceptance is scoped solely to the named hosted-web job. The frozen static
  receipt is
  `sha256:79509a1ba5ad50b6b9be09a47c761268b71c261695cdee30d0839309ef11ce85`;
  the frozen database receipt is
  `sha256:3bd274cd5043819a9d5bc707000f70aad3500ef2540874c6a2d4aa0e23238715`.
  These are source and scoped-CI receipts, not deployment or live-product proof.

- Added qualified skill identity, explicit canonical duplicate decisions, and
  fail-closed routing from one exact approved workspace revision.
- Added fsynced immutable workspace revisions with fencing, compare-and-swap
  publication, migration, corruption quarantine, last-known-good recovery,
  verified history, and explicit rollback as a new unapproved revision.
- Added the capability-authenticated IPv4-loopback connector and packaged,
  versioned local application with workspace/root onboarding, live Route Lab,
  skills and variants, policy/source/eval review, redacted feedback/activity,
  allowlisted maintenance jobs, cancellation, and recovery workflows.
- Added bounded route, feedback, and job ledgers; raw route prompts and caller
  idempotency keys are not persisted in their public receipts.
- Added canonical runtime JSON Schemas, generated root/web adapters, strict
  payload digests, allowlisted safe exports, and read-only bounded MCP tools.
- Added credible-eval-v2 composition, provenance, holdout, leakage, baseline,
  and safety gates. Legacy/self-labeling suites remain demo evidence even when
  their scores are high.
- Hardened GitHub source reads with immutable resolution, time/byte/tree caps,
  retry/cache behavior, and preview-only source updates; ordinary V1 commands
  do not overwrite source skill trees.
- Added modular local-app routes, explicit disconnected/stale/malformed/version
  states, automated accessibility checks, cross-browser critical-flow runners,
  deterministic visual-diff infrastructure, performance budgets, and a clean
  tarball-consumer dashboard smoke.
- Added local install/update/uninstall/rollback, support, privacy, security,
  provenance, browser-QA, and separate local-product/hosted-pilot runbooks.
- Added the locally validated hosted trust-alpha candidate: free-account saves,
  exact-commit submission/status/withdrawal, bounded inert static audit,
  letterless provisional grades, service-only review/publication, authenticated
  reports, lifecycle actions, export, deletion, and current-version public
  evidence projections.
- Added receipt-backed fifth-attempt dead-letter recovery, explainable blocked
  grades without fabricated compatibility evidence, and fail-closed immutable
  source/content collision review before publication.
- Added a service-role-only submission queue summary, cursor-paged redacted list,
  and exact bounded receipt-history detail plane plus strict read-only operator
  CLIs. Submitter/actor identities, internal claims, private evidence, and raw
  source contents remain outside those projections. The generated Supabase type
  file remains byte-exact for schema parity, while an application-only override
  restores the nullable return fields that the generator cannot infer for the
  three operator `RETURNS TABLE` RPCs.
- Added fail-closed private/public release-stage and indexing controls plus a
  composed disposable hosted-browser gate. Team sync, billing, package
  mirroring/loading, TUF distribution, current-letter behavioral grading,
  remote worker scheduling, external hosted pilot evidence, npm publication,
  and deployment are not included.
- Added a pinned 20-version, five-group initial-corpus candidate with exact
  Apache-2.0/MIT evidence, deterministic preparation, shared-memoized inert
  GitHub audit, and owner-only provisional-grade receipts. Publisher consent,
  authenticated ingestion, database publication, and public launch remain
  explicitly unclaimed.

## 0.1.0-alpha

Initial private alpha.

- Added local skill scanner.
- Added deterministic doctor findings.
- Added native-agent doctor pack generation with summary mode, pack-size warning, curation prompt, and policy skeleton.
- Added reversible policy model.
- Added effective graph generation.
- Added deterministic route traces.
- Added route eval pass metrics.
- Added passive Codex hook dry-run, install, and uninstall commands with backups.
- Added hook safety and command documentation.
- Added fixture evals and package validation.

## Historical 0.1.0 candidate baseline

These notes describe an earlier local baseline. They are retained for history
and are not proof that the current worktree is release-ready.

- Added real-root status, native Codex curation receipts, source provenance/update checks, SkillGraph commands, release-confidence evals, passive Codex hook support, doctor fix plans, local export/import, and read-only MCP access.
- Added the initial source update safety baseline. The current implementation is stricter: source updates are preview-only, risky updates are review-gated, and ordinary commands cannot overwrite skill roots.
- Added first-run, troubleshooting, host compatibility, and threat-model documentation.
- Validated against copied skill roots without mutating original skill files.
