# Package Format v1

Status: Phase 0 frozen contract. Phase 1 records metadata and exact entrypoint bytes only. Canonical snapshotting, normalization, packaging, signing, and loading begin in Phase 2 and must satisfy this contract before any artifact is called installable.

## Authorities

The publisher source tree, raw admitted snapshot, normalized package, manifest, and entrypoint are different byte domains. An `entrypoint_content_digest` is useful review evidence but is not a snapshot, manifest, or artifact digest.

Minimum manifest shape:

```yaml
schema_version: skillmap.package/v1
path_policy: skillmap-path/v1-unicode-17.0.0
skill_id: skl_...
version_id: skv_...
publisher_id: pub_...
version: 1.2.0
source:
  repository: https://github.com/example/repository
  provider_repository_id: immutable-provider-id
  commit: full-lowercase-commit
  path: skills/example
  raw_snapshot_digest: sha256:...
  importer_version: skillmap-importer/...
  agent_skills_spec_digest: sha256:...
license:
  declared: MIT
  concluded: MIT
  files: [LICENSE]
  redistribution: mirrored
entrypoint: SKILL.md
files:
  - path: SKILL.md
    size: 1234
    mode: "0644"
    sha256: sha256:...
permissions:
  scripts: false
  network: []
  tools: []
host_claims: []
relationships: []
created_at: 2026-07-11T00:00:00Z
manifest_digest: sha256:...
normalized_artifact_digest: sha256:...
attestations: []
```

## Admission and normalization rules

- Resolve a provider repository, immutable provider ID, full commit, and normalized relative source path once.
- Preserve the exact raw snapshot separately from normalized output.
- Require one regular-file `SKILL.md` entrypoint with parseable bounded frontmatter.
- Decode path names as strict UTF-8, normalize separators to `/`, and normalize every segment to Unicode NFC using the pinned Unicode 17.0.0 data in `skillmap-path/v1-unicode-17.0.0`; importer locale and host Unicode libraries are not authority.
- Canonical path identity is case-sensitive and locale-independent. For portable admission, also compute Unicode 17.0.0 default case folding followed by NFC and reject the whole package if two entries collide by normalized path or by that portable collision key; never overwrite or select a last entry.
- Reject absolute paths, `..`, empty segments, NUL, platform device names, and any path that fails the pinned normalization/collision rules.
- Reject symlinks, hard links, submodules, sockets, devices, unsupported archive entry types, and path escapes.
- Sort entries by unsigned lexicographic comparison of normalized UTF-8 path bytes and define one deterministic serialization, text-encoding, line-ending, timestamp, owner, and mode policy. Record the path-policy and Unicode versions in the manifest and provenance receipt.
- Hash every admitted regular file and bind path, size, mode, and digest in the manifest.
- Enforce explicit per-file, file-count, expanded-byte, archive-byte, and nesting limits before allocation or extraction. Limit values are versioned importer policy and recorded in the provenance receipt.
- Unknown executable formats, undeclared scripts, and permission mismatches are blocked or quarantined, never silently normalized.
- Malformed-frontmatter recovery may aid local diagnosis but cannot authorize hosted publication.

## License and redistribution modes

- `mirrored`: concluded redistribution terms permit SkillMap to store and serve the normalized artifact.
- `metadata-only`: source metadata and evidence may be indexed, but SkillMap does not mirror or serve the skill body.
- `blocked`: conflicting, absent, or prohibited rights prevent artifact publication.

Declared and detected license evidence are inputs; `concluded` is a version-bound review result. A public repository is not, by itself, redistribution permission.

## Publication and loading

- Publication is immutable. Changed bytes require a new version ID and digest.
- Semantic versions, channels, and aliases resolve to a `skv_...` plus `normalized_artifact_digest` before download.
- The loader verifies trusted registry metadata, manifest digest, artifact digest, expanded entry set, and every file digest before exposing content.
- Lifecycle overlays can stop new loading of a revoked version even though transparency history remains.
- Cache keys include immutable version and artifact digest. Mutable aliases never key trusted bytes.
- Package scripts never execute during ingestion, audit, routing, installation verification, or loading unless a separate host policy explicitly authorizes an audited execution step.

## Package state dimensions and transitions

Artifact availability, publication state, and lifecycle are independent:

- `artifact_availability`: exactly `metadata-only` or `mirrored`;
- publication state: exactly `draft`, `published`, or `blocked`;
- version lifecycle overlay: `deprecated`, `quarantined`, `yanked`, or `revoked`.

`pending` is not artifact availability; ongoing work uses job states `queued`, `running`, `succeeded`, `failed`, and `cancelled`. `retired` is a logical-skill lifecycle state, not a package-version state.

| From | Allowed next state | Gate/effect |
| --- | --- | --- |
| `draft` | `published` | Immutable version/source coordinates, admissible redistribution, required package digests, receipts, and policy pass. |
| `draft` | `blocked` | A hard admission gate failed; retry creates a new package attempt. |
| `published` | `deprecated`, `quarantined`, `yanked`, `revoked` | Consequential transition receipt required. |
| `deprecated` | `published`, `quarantined`, `yanked`, `revoked` | Undeprecation or stronger restriction requires a new receipt. |
| `quarantined` | `published`, `deprecated`, `yanked`, `revoked` | Fresh review resolves the quarantine. |
| `yanked` | `published`, `deprecated`, `revoked` | Audited restoration or stronger restriction. |
| `revoked` | `quarantined` | Two-person reversal receipt; the version remains non-routable until ordinary publication gates pass again. |
| `blocked` | none | New evidence creates a new package attempt, never an in-place rewrite. |

Transitions never change source coordinates or package bytes. Changed bytes always create a new `skv_...`. Once published, artifact availability and raw-snapshot, manifest, and normalized-artifact digests are immutable. A published `metadata-only` version therefore cannot become `mirrored` in place; mirroring requires a newly admitted package-version identity.

Phase 1 maps this contract to `private.skill_versions.publication_state`, `artifact_availability`, `quarantined_at`, and `revoked_at`, plus logical-skill `private.skills.lifecycle_state`. Phase 3 adds an append-only transition ledger and current version-lifecycle projection rather than overloading those Phase 1 fields.

## Required receipts

An admitted package has separate, version-bound provenance, license, structural-audit, permission, and compatibility statements. A grade receipt consumes these statements; it does not replace them.

Phase 2 must add adversarial fixtures for traversal, duplicate paths, Unicode aliases, symlink/hard-link escape, decompression bombs, oversized sparse entries, manifest omission, digest mismatch, lifecycle-script canaries, and metadata-only enforcement before this format leaves draft implementation status.
