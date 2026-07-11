# Declared-Source Coverage Receipt v1

Status: Phase 0 frozen semantic contract. Phase 3 implements the schema, workers, receipts, and public projection. Phase 1 makes no declared-source completeness claim.

## Authority

A declared-source universe is a canonical content-addressed manifest containing every owner-approved catalog source, adapter name/version, and bounded source-configuration digest. Its `declaredUniverseDigest` is the authority for what “all indexed skills” means. It is never presented as a census of the internet.

A crawl attempt has immutable `crl_[0-9a-f]{32}` identity. A coverage receipt has immutable `cov_[0-9a-f]{32}` identity. Future catalog sources use immutable `src_[0-9a-f]{32}` identity; internal UUIDs remain implementation details.

## Canonical receipt

```json
{
  "kind": "skillmap.source-coverage-receipt",
  "schemaVersion": 1,
  "receiptId": "cov_00000000000000000000000000000000",
  "crawlRunId": "crl_00000000000000000000000000000000",
  "catalogSourceId": "src_00000000000000000000000000000000",
  "declaredUniverseDigest": "sha256:...",
  "sourceBoundaryDigest": "sha256:...",
  "adapter": {
    "name": "github-tree",
    "version": "skillmap-github-tree/1",
    "configurationDigest": "sha256:..."
  },
  "inputs": {
    "importerVersion": "skillmap-importer/1",
    "agentSkillsSpecDigest": "sha256:..."
  },
  "startedAt": "2026-07-11T00:00:00Z",
  "completedAt": "2026-07-11T00:01:00Z",
  "lastSuccessfulAt": "2026-07-11T00:01:00Z",
  "runState": "succeeded",
  "coverageState": "complete",
  "freshness": {
    "targetSeconds": 86400,
    "observedLagSeconds": 60,
    "freshUntil": "2026-07-12T00:01:00Z"
  },
  "counts": {
    "discovered": 200,
    "parsed": 200,
    "eligible": 175,
    "undispositioned": 0,
    "dispositions": {
      "published": 160,
      "metadataOnly": 10,
      "duplicate": 5,
      "quarantined": 2,
      "legallyUnavailable": 3,
      "ineligible": 20,
      "failedBeforeEligibility": 0,
      "failedAfterEligibility": 0
    }
  },
  "recordSetDigest": "sha256:...",
  "failures": [],
  "issuerId": "skillmap-registry",
  "policyVersion": "source-coverage/1",
  "issuedAt": "2026-07-11T00:01:00Z",
  "previousReceiptDigest": null,
  "receiptDigest": "sha256:...",
  "verificationBundleDigest": "sha256:..."
}
```

`runState` is `succeeded`, `partial`, or `failed`. `coverageState` is `complete` or `incomplete`. Public freshness is derived as `current` or `stale` by comparing trusted time with `freshUntil`; signed receipts are never rewritten merely because time passes.

Each failure has a bounded kebab-case `code`, count, and `retryState` of `scheduled`, `exhausted`, or `not-retryable`. Credentials, private locators, raw provider responses, and unrestricted error text are never public fields.

## Crawl-record states and transitions

The exact `crawlRecordState` vocabulary is `discovered`, `parsed`, `eligible`, `published`, `metadata-only`, `duplicate`, `quarantined`, `legally-unavailable`, `ineligible`, and `failed`.

| From | Allowed next state | Gate |
| --- | --- | --- |
| none | `discovered` | Adapter emitted a canonical bounded locator. |
| `discovered` | `parsed`, `failed` | Bounded retrieval and parse attempt completed. |
| `parsed` | `eligible`, `duplicate`, `ineligible`, `failed` | Structural/spec and duplicate checks completed. |
| `eligible` | `published`, `metadata-only`, `quarantined`, `legally-unavailable`, `failed` | License, audit, package, and publication policy produced a disposition or an explicitly failed eligible attempt. |
| `quarantined` | `published`, `metadata-only`, `legally-unavailable`, `ineligible` | A later review produced a new transition and receipt. |
| Any finalized disposition | none in the signed receipt | Retry or correction creates a new crawl/transition receipt; history is never rewritten. |

`published`, `metadata-only`, `duplicate`, `quarantined`, `legally-unavailable`, `ineligible`, and `failed` are terminal dispositions for one receipt.

`failedBeforeEligibility` counts `discovered`/`parsed` records that terminate as `failed`; `failedAfterEligibility` counts `eligible` records that terminate as `failed`. Both bind the same terminal `failed` record state but keep the eligibility equation mechanically verifiable. A failed attempt to reconsider an already terminal `quarantined` record does not rewrite its disposition; it records a failed run while the prior quarantine remains authoritative.

## Reconciliation invariants

- Every count is a non-negative integer; `parsed <= discovered` and `eligible <= parsed`.
- `eligible = published + metadataOnly + quarantined + legallyUnavailable + failedAfterEligibility`.
- `undispositioned = discovered - (published + metadataOnly + duplicate + quarantined + legallyUnavailable + ineligible + failedBeforeEligibility + failedAfterEligibility)`.
- `coverageState = complete` if and only if `undispositioned = 0`.
- `runState = succeeded` requires complete boundary enumeration, complete coverage, and zero `failedBeforeEligibility`/`failedAfterEligibility` dispositions.
- `partial` means an authoritative subset exists but a boundary or record failed; `failed` means no authoritative enumeration completed.
- `recordSetDigest` binds the canonically sorted locator digest, state, terminal disposition, reason codes, and hosted IDs for every discovered record.

## Public completeness gate

The website may say “all indexed skills” only when its report links the exact declared-universe manifest and every approved source has a receipt binding that digest with succeeded run, complete and current coverage, zero failed/undispositioned records, and aggregate counts that reconcile to per-source receipts. Missing, partial, failed, stale, differently bound, or unverifiable evidence makes the claim unavailable while keeping the coverage failure visible.

Phase 3 must add `contracts/source-coverage-receipt/v1.schema.json`, success/partial/failed/stale fixtures, and generated root/web validators before emitting these receipts.
