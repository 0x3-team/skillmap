# Route Plan v1

Status: Phase 0 frozen semantic contract. The existing local deterministic router remains authoritative for current runtime behavior. Hosted compact-index routing and chronological package loading are later phases and must preserve this contract and local prompt privacy.

## Purpose

`skillmap.route-plan/v1` explains how a prompt is segmented, which immutable versions are selected for each segment, why alternatives were rejected, when selected content may be loaded, and where the router abstained. The optimization target is maximum requested-task coverage with minimum skill count and context cost, no hard constraint violation, and reproducible reason codes.

## Privacy boundary

The original prompt and source spans are local-only by default. A hosted service may receive an explicit user query only when the user chooses hosted search/planning; routine local routing sends neither raw prompt nor skill bodies. Telemetry uses bounded reason codes, aggregate counts, and prompt/plan digests only after applicable consent. A prompt digest is correlation/integrity evidence, not recoverable content or authorization.

## Canonical shape

```json
{
  "schemaVersion": "skillmap.route-plan/v1",
  "promptDigest": "sha256:...",
  "segments": [
    {
      "id": "seg-1",
      "order": 1,
      "sourceSpan": {"start": 0, "end": 120},
      "summary": "Design the web interaction flow",
      "constraints": {"platform": ["web"]},
      "dependsOn": [],
      "selections": [
        {
          "skillVersionId": "skv_...",
          "artifactDigest": "sha256:...",
          "role": "primary",
          "loadScope": "step-only",
          "reasonCodes": ["intent-match", "platform-match"]
        }
      ],
      "rejections": []
    }
  ],
  "globalSelections": [],
  "finalReviewSelections": [],
  "unresolvedAmbiguities": [],
  "estimatedContext": {"metadataTokens": 0, "selectedSkillTokens": 0},
  "indexSnapshotDigest": "sha256:...",
  "policyDigest": "sha256:...",
  "routerVersion": "skillmap-router/..."
}
```

The local envelope may carry `originalPrompt`; persisted, exported, API, and hosted variants omit it. Summaries and constraints are bounded and must pass redaction before persistence.

## Deterministic algorithm

1. Segment by headings, numbered steps, bullet groups, paragraph boundaries, sequencing terms, and named workstreams.
2. Preserve original byte order and offsets; dependencies may schedule prerequisites earlier but do not rewrite author intent.
3. Apply hard filters for lifecycle/revocation, host profile, platform/framework, permissions, prerequisites, local policy, evidence currency, and artifact availability.
4. Retrieve by lexical and structured capability evidence from the exact trusted index snapshot.
5. Classify alternatives, complements, prerequisites, guardrails, conflicts, and duplicates.
6. Score task fit, trigger evidence, host evidence, freshness, grade confidence, policy preference, and context cost with versioned deterministic weights.
7. Choose at most one primary per segment where possible; add supporting skills only for uncovered capability.
8. Add global guardrails and final-review skills only when their declared scope applies.
9. Reject redundant, conflicting, stale-blocked, wrong-platform, permission-disallowed, or unverified-artifact candidates.
10. Abstain or request concise clarification when hard requirements conflict or the leading candidates differ on an unresolved constraint.

Tie-breaking uses immutable skill/version IDs after all meaningful scores so the same snapshot, policy, profile, and prompt produce the same plan.

## Roles and loading

- `primary`: performs the segment's core job.
- `supporting`: adds a distinct missing capability.
- `prerequisite`: must be applied before named dependents.
- `global-guardrail`: constrains all applicable segments.
- `final-review`: evaluates the combined result after implementation.

Load scopes are `step-only`, `prerequisite`, `global-guardrail`, and `final-review`. Metadata selection never executes a package. The loader independently verifies TUF metadata, version, manifest, artifact digest, permissions, and lifecycle immediately before making selected content available.

## Evidence and failure behavior

Every plan binds the trusted index snapshot, policy, router version, host profile, and selected artifact digests. It records close rejections with machine reason codes, not hidden model rationale. Missing/expired metadata, unknown compatibility, blocked permissions, unavailable artifact, stale grade, or unresolved conflict yields an explicit abstention/clarification—not a broader unverified selection.

Required tests cover long ordered prompts, cross-segment dependencies, unrelated near misses, aliases, duplicate families, platform conflict, permission denial, revoked versions, stale evidence, empty results, deterministic ties, context budgets, prompt redaction, and loader handoff.
