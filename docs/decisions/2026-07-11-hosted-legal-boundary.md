# Decision: Hosted Source, License, and Redistribution Boundary

Date: 2026-07-11
Status: accepted technical/legal operating boundary; formal launch policies and agreements still require owner/legal approval

## Decision

SkillMap distinguishes public source visibility from permission to redistribute a skill package.

- A clearly licensed first-party or third-party version may be mirrored only after immutable source binding and concluded license evidence.
- Unclear, conflicting, absent, or restrictive redistribution rights use `metadata-only` or `blocked`; SkillMap may link to an authorized source but does not copy or serve the body as an installable artifact.
- Declared, detected, and concluded license states remain separate and version-bound.
- Publisher verification, ownership, license, provenance, audit, compatibility, grade, popularity, and lifecycle are independent claims.
- Takedown, dispute, correction, appeal, deprecation, quarantine, and revocation create auditable lifecycle records; they do not erase or reuse identity.
- Private repositories or submissions are read-only within the explicitly authorized job and are never made public by default.

## Phase 1 application

The catalog seeds are three checked-in first-party `0x3-team` skills under the repository MIT license. Phase 1 exposes metadata and source coordinates only and labels artifacts `metadata-only`; it does not claim raw snapshot, normalized artifact, or manifest digests.

## Required later controls

Before accepting public submissions or mirroring third-party bodies, publish and approve a publisher agreement, submission authorization/ownership proof, privacy notice, acceptable-use policy, takedown/appeal workflow, retention schedule, license-review procedure, and operator escalation ownership. The ingestion worker must fail closed to metadata-only or blocked whenever concluded redistribution authority is missing.

This document records an engineering boundary, not jurisdiction-specific legal advice.
