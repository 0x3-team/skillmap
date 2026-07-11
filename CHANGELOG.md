# Changelog

## Unreleased — experimental local alpha

This worktree is not committed, tagged, published, or deployed. The entries
below describe local implementation work and do not constitute release
evidence.

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
  provenance, browser-QA, and external-pilot runbooks. Hosted accounts, team
  sync, billing, external pilot evidence, npm publication, and deployment are
  not included.

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
