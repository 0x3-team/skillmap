# Evidence States v1

Status: Phase 0 frozen contract. Phase 1 implements truthful negative/unknown states and blocks unreceipted promotion. Later workers may promote states only through version-bound receipts described here.

## Independent dimensions

Publisher identity, source provenance, package integrity, license/redistribution, audit, host compatibility, grade, advisory exposure, freshness, and lifecycle are independent. UI badges, API payloads, search filters, and router policy must not collapse them into a single trust label.

| Dimension | Initial/unknown | Positive | Negative or terminal |
| --- | --- | --- | --- |
| Publisher identity | `unverified` | `identity-verified` | `disputed` |
| Provenance | `unverified` | `source-pinned`, `attested` | `stale`, `blocked` |
| Artifact availability | `metadata-only` | `mirrored` | none; restriction belongs to publication/lifecycle |
| License conclusion | `noassertion` | `confirmed` | `restricted` |
| Redistribution | `metadata-only` | `mirrored` | `blocked` |
| Audit | `not-run` | `passed` | `warnings`, `stale`, `blocked` |
| Compatibility | `not-tested`, `declared` | `compatible` | `stale`, `incompatible` |
| Grade | `ungraded` | `provisional`, `current` | `stale`, `blocked`, `revoked` |
| Advisory exposure | `not-checked` | `no-known-applicable` | `affected`, `stale` |
| Freshness | `unknown` | `current` | `stale` |
| Publication | `draft` | `published` | `blocked` |
| Version lifecycle overlay | none | `deprecated` | `quarantined`, `yanked`, `revoked` |
| Logical-skill lifecycle | `draft` | `published`, `deprecated` | `retired` |

These values match the checked-in hosted schema vocabulary where Phase 1 implements the dimension. Future values require a versioned contract and migration; consumers fail closed on unknown values and never infer a stronger state from absence.

## Receipt rule

Every positive or consequential transition records:

- immutable skill and version IDs;
- exact subject digest(s) and digest domain;
- issuer identity and trust chain;
- policy/rubric/profile version;
- inputs and evidence digests;
- issued, valid-from, expiry, and observed timestamps;
- outcome and machine-readable reason codes;
- signature or verification bundle;
- superseded receipt when applicable.

A receipt that lacks issuer authenticity or exact version/digest binding is `unverifiable`, not positive evidence.

## Invalidations

The following invalidate affected evidence without rewriting history:

- new source commit, package bytes, manifest, permissions, dependency, or host-profile version;
- rubric, evaluation-suite, evaluator, vulnerability/advisory snapshot, or policy change named by the receipt;
- publisher dispute, license correction, security advisory, takedown, or revocation;
- expiry, freeze, rollback, or trusted-root/key transition outside the client's accepted window.

Invalidation creates a new event/receipt and updates the current projection. Historical receipts remain append-only.

## Publication and routing gates

- Public catalog visibility requires the publisher and source to be published and non-revoked, the skill to be public, published or deprecated, and non-revoked, and the current version to be published, non-quarantined, and non-revoked.
- An installable artifact additionally requires admissible license/redistribution, canonical package digests, and current registry metadata.
- A public grade requires all hard-gate receipts named by its rubric.
- Router eligibility applies host, permission, lifecycle, advisory, evidence-currency, and local policy filters before relevance scoring.
- `ungraded` does not mean unsafe; `current` does not mean identity-verified; identity verification does not mean compatible or secure.

## Phase 1 enforcement

Seeds remain publisher `unverified`, provenance `unverified`, audit `not-run`, compatibility `not-tested`, grade `ungraded`, and artifact `metadata-only`. Database constraints prevent setting verified/passed/compatible/current states before canonical receipt tables and workers exist. Public copy must preserve those exact limitations.
