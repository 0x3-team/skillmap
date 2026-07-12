# Hosted Identity v1

Status: Phase 0 frozen contract. Phase 1 implements the publisher, skill, version, source, alias, and digest boundaries described here; later transfer and tombstone workflows remain gated.

## Purpose

This specification keeps local SkillMap identity, hosted logical identity, published-version identity, human aliases, and byte-integrity authority distinct. No API, database migration, package, route plan, or receipt may treat one domain as another.

## Identifier domains

| Domain | Form | Meaning |
| --- | --- | --- |
| Local skill variant | `sk_...` | Workspace/root/path-qualified local runtime identity. It is never accepted as a hosted public ID. |
| Hosted publisher | `pub_[0-9a-f]{32}` | Immutable public publisher identity. |
| Hosted logical skill | `skl_[0-9a-f]{32}` | Immutable skill identity across published versions. |
| Hosted skill version | `skv_[0-9a-f]{32}` | Immutable identity for one admitted version. |
| Source revision | 40 or 64 lowercase hexadecimal characters | Immutable provider commit recorded with repository and source path. |
| Named digest | `sha256:[0-9a-f]{64}` | Integrity authority only for the field that names its byte domain. |

Internal UUIDs are database implementation details and are never public installation authority. Handles, slugs, semantic versions, tags, channels, and `latest` are resolvable aliases only.

The canonical machine coordinate is:

```text
skillmap://publishers/pub_.../skills/skl_.../versions/skv_...#sha256:<normalized-artifact-digest>
```

Until a normalized artifact exists, a catalog record may expose source commit, path, and `entrypoint_content_digest`, but it must not construct or imply an installable package coordinate.

## Digest domains

The following digests are deliberately non-interchangeable:

- `entrypoint_content_digest`: exact checked-in `SKILL.md` bytes used for the Phase 1 metadata record.
- `raw_snapshot_digest`: exact admitted upstream tree/snapshot bytes under the package source boundary.
- `manifest_digest`: canonical package-manifest bytes.
- `normalized_artifact_digest`: canonical distributable artifact bytes.
- evidence, compatibility, advisory, grade, and route-plan digests: canonical bytes for their named receipt or payload.

A digest may authorize only its named subject. Domain prefixes must be added before signing or composing multi-field receipts so equal raw hashes in different domains do not become interchangeable authority.

## Immutability and lifecycle

- Public IDs and their original owner/source binding are immutable.
- A published version's source repository, commit, path, and authoritative digests are immutable.
- Changed bytes require a new `skv_...` even when the publisher reuses a semantic version.
- A logical skill's current-version pointer may advance only to a version belonging to that same `skl_...`.
- Old handles and slugs remain reserved. Rename creates a redirect receipt; transfer creates an explicit ownership-transfer receipt.
- Deprecation, quarantine, yank, revocation, and legal restriction are lifecycle transitions. They never delete or resurrect identity.
- A revoked or hidden record cannot be selected through public views, aliases, search, router metadata, or saved-skill projections.

## Ownership and authorization

Public identity is separate from a private Supabase Auth account. Publisher authority comes from current relational membership and role checks, not mutable user metadata or repository membership alone. In Phase 1, publisher, source, skill, version, evidence, and grade mutation remains worker/operator-only; end users own only their profile and saved-skill rows.

## Required validation

- Hosted contracts reject local IDs, mutable source refs, malformed digests, traversal paths, and unknown fields.
- Database constraints and triggers freeze public identities, repository ownership, skill ownership/source, and version coordinates.
- RLS composes publisher, repository, skill, and version visibility; child visibility never outlives a hidden parent.
- Fixtures include published, draft, restricted, quarantined, and revoked cases with hidden/nonexistent parity.

Current enforcement lives in `contracts/hosted-skill/v1.schema.json`, `contracts/hosted-skill-list/v1.schema.json`, `supabase/migrations/20260711192500_hosted_catalog_foundation.sql`, and `test/hosted-seed-integrity.mjs`.
