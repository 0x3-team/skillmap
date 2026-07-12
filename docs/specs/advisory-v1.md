# Advisory v1

Status: Phase 0 frozen semantic contract. Phase 3 will implement advisory storage, signed revisions, public projection, exposure evaluation, and revocation-overlay integration.

## Independent states

- Advisory lifecycle: `draft`, `published`, `withdrawn`.
- Severity: `unknown`, `low`, `moderate`, `high`, `critical`.
- Version exposure: `not-checked`, `no-known-applicable`, `affected`, `stale`.
- Recommended action: `review`, `warn`, `block-new-load`, `replace`.

An advisory does not itself deprecate, quarantine, yank, or revoke a version. Any consequence requires a separate lifecycle/revocation receipt. `no-known-applicable` means only that no published advisory in the exact bound snapshot applies; it is not a general safety claim.

## Canonical payload

```json
{
  "kind": "skillmap.advisory",
  "schemaVersion": 1,
  "advisoryId": "adv_00000000000000000000000000000000",
  "revision": 1,
  "state": "published",
  "severity": "critical",
  "aliases": ["GHSA-xxxx-xxxx-xxxx"],
  "summary": "Bounded public summary",
  "details": "Bounded, redacted public explanation",
  "recommendedAction": "block-new-load",
  "affected": [{
    "skillId": "skl_00000000000000000000000000000000",
    "versionId": "skv_00000000000000000000000000000000",
    "subject": {"digestDomain": "normalized-artifact", "digest": "sha256:..."},
    "fixedByVersionId": null,
    "lastKnownGoodVersionId": null,
    "reasonCodes": ["credential-exfiltration"]
  }],
  "references": [{"type": "report", "url": "https://example.test/advisory"}],
  "issuerId": "skillmap-registry",
  "policyVersion": "advisory/1",
  "issuedAt": "2026-07-11T00:00:00Z",
  "publishedAt": "2026-07-11T00:00:00Z",
  "withdrawnAt": null,
  "previousRevisionDigest": null,
  "receiptDigest": "sha256:...",
  "verificationBundleDigest": "sha256:..."
}
```

`digestDomain` is exactly `entrypoint-content`, `raw-snapshot`, `manifest`, or `normalized-artifact` and authorizes only that byte domain. Version ranges and aliases may aid discovery but cannot replace exact `skv_...` plus digest binding for enforcement. Public payloads exclude private findings, credentials, reporter identity without consent, raw skill content, unrestricted logs, and unnecessarily harmful exploit detail.

## Advisory transitions

| From | Allowed next state | Gate/effect |
| --- | --- | --- |
| none | `draft` | Private review only; no public authority. |
| `draft` | `published` | Exact affected subjects, issuer, policy, receipt digest, and verification bundle exist. |
| `published` | `published` | Correction creates the next immutable revision linked by `previousRevisionDigest`. |
| `published` | `withdrawn` | A signed revision explains withdrawal and preserves prior revisions. |
| `withdrawn` | none | Reassertion uses a new advisory identity. |

A withdrawn advisory does not automatically restore grade, routing, loading, or lifecycle state. Those projections change only after fresh exposure evaluation and any required lifecycle/revocation reversal.

## Exposure transitions

| From | Allowed next state | Gate |
| --- | --- | --- |
| `not-checked` | `no-known-applicable`, `affected` | A current advisory-snapshot receipt evaluated the exact version/digest. |
| `no-known-applicable`, `affected` | `stale` | Snapshot changed, receipt expired, or version/digest changed. |
| `stale` | `no-known-applicable`, `affected` | Fresh evaluation completed. |

Phase 3 must add `contracts/advisory/v1.schema.json`, draft-rejection/published/corrected/withdrawn/wrong-digest/stale-exposure fixtures, and generated validators before this payload becomes machine authority.
