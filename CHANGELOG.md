# Changelog

## Unreleased — experimental free public alpha

The latest product source-integration boundary for these entries is operator
candidate `69e7d1e7f2042ae996c1bed379891ec65ece84a4` and tree
`67235ad3ce1553c4b3ba47a36c8e22f9c53cf89c`, merged as feature `main` commit
`8a30578520974257a1ab4ee2f6c7442696ee0289`. The earlier baseline remains a
separate historical row in the append-only release ledger. This
source-integration boundary does not prove a tag, package publication,
deployment, live OAuth, public indexing, open-user launch, or verified-live
status. Subsequent Unreleased product changes require their own candidate and
merge receipt before this boundary covers them.

- Recorded Gitea candidate run `50`, GitHub Actions run `29294494176` one-shot
  self-hosted `hosted-web` job `86964954830`, Gitea protected sync PR `#2`, and
  Gitea sync-branch, PR, and post-merge `main` runs `51`, `52`, and `53` as
  passed. The one-shot runner self-removed and the GitHub repository reported
  zero registered runners afterward. The overall GitHub workflow remained red
  only because unrelated GitHub-hosted jobs were organization-allowance blocked;
  acceptance is scoped solely to the named hosted-web job. The frozen static
  receipt is
  `sha256:7dec38b69c6b709c13f6e0aac4d5f6767411e3a2b2e07b3226b87f16902bdd13`;
  the frozen database receipt is
  `sha256:74b8e840a2e1b5343df5daa79d8bbb2bc08d28bdd54ebd51277c9d912bc37fa6`.
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
