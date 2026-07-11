# SkillMap Registry TUF Profile v1

Status: Phase 0 frozen profile. Phase 1 has no remote package/index publication and therefore does not claim TUF protection. Phase 2 must implement and adversarially test this profile before clients trust hosted artifact pointers or lifecycle overlays.

## Scope

TUF metadata protects the compact registry index, normalized artifacts, manifests, delegated publisher/collection shards, and the fast revocation overlay. Source provenance and grade receipts remain separately signed evidence bound as TUF targets; TUF publication does not make their claims true.

## Roles and custody

| Role | Initial threshold | Key posture | Maximum expiry |
| --- | ---: | --- | ---: |
| `root` | 2 of 3 | Offline, separately held, recovery documented | 365 days |
| `targets` | 2 of 3 | Controlled release signing; may delegate shards | 30 days |
| `snapshot` | 1 of 1 | Online, isolated from application runtime | 7 days |
| `timestamp` | 1 of 1 | Online, isolated and frequently rotated | 24 hours |
| `revocations` delegated target role | 1 of 2 | Separate online key from ordinary targets; emergency rotation path | 6 hours |

Root and targets threshold changes require a root rotation ceremony and a recovery rehearsal. Application, Supabase service-role, Vercel, GitHub OAuth, and worker credentials are never signing keys.

## Target organization

- Every artifact target name contains or is custom-metadata-bound to `skv_...`, manifest digest, and normalized artifact digest.
- Compact index shards are deterministic, bounded, content-addressed targets. Full skill bodies, scripts, raw prompts, and private evidence are excluded.
- The revocation overlay is a small delegated target with monotonically increasing sequence, issued/expiry times, affected version/digest, reason code, and replacement/last-known-good information when authorized.
- Consistent snapshots are mandatory. Clients fetch versioned metadata and content-addressed targets; mutable CDN paths are transport hints only.
- Delegations terminate explicitly and are scoped by path/hash prefixes so a publisher or collection signer cannot replace root, top-level index, or another publisher's targets.

## Client update algorithm

1. Begin from a pinned trusted root and maximum known metadata versions.
2. Update root one version at a time, verifying old-root and new-root thresholds.
3. Fetch and verify unexpired timestamp, snapshot, top-level/delegated targets, then the revocation overlay.
4. Reject rollback, version skip outside root rotation, mix-and-match, inconsistent length/hash, unknown critical fields, expired metadata, and delegation escape.
5. Resolve an alias only after the trusted index returns immutable version and digest.
6. Fetch a target by trusted length/hash; verify manifest and artifact again before exposure.
7. Apply revocation/quarantine before router eligibility, cache use, or loading.
8. Commit the trusted metadata set atomically only after all required roles verify.

## Freeze and last-known-good policy

- An expired timestamp or snapshot stops metadata advancement and all new package installation.
- Previously verified, non-revoked local artifacts may remain available for explicitly offline use for at most 72 hours after ordinary metadata expiry, visibly marked frozen; policy may choose a shorter window.
- An expired or unavailable revocation overlay stops new loading immediately. Existing loaded content receives a stale-revocation warning and is not recommended by the router until a current overlay is verified.
- A known revocation always wins over cached eligibility, grade, alias, and last-known-good state.
- Clients never extend an expiry locally, accept a lower version, or use wall-clock rollback to revive metadata.

## Rotation and incident response

- Online keys rotate at least every 90 days and immediately after suspected compromise.
- Root rotation is rehearsed before launch and at least annually.
- Compromised online roles are revoked through a threshold-signed root/targets update and an emergency revocation overlay.
- If root threshold may be compromised, publication freezes; recovery requires the documented offline ceremony or a new explicitly distributed trust anchor.
- Every signing action emits an append-only release receipt with subject digests, role/version, CI identity, and signer verification bundle without exposing private key material.

## Required test matrix

Phase 2 must cover valid rotation, expired roles, root rollback, snapshot rollback, mix-and-match, replay, freeze, clock skew, delegation escape, compromised online key, overlay omission, CDN corruption, partial download, cache restart, atomic update interruption, and last-known-good expiry. Size and update-cost budgets are measured at 1,000, 5,000, 25,000, and 100,000 skills.
