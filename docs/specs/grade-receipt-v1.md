# Grade Receipt v1

Status: Phase 0 frozen semantic contract. The hosted grade response contract exists in Phase 1, but all seeds remain `ungraded`; canonical evaluators and signed receipts are Phase 4 work.

## Principle

A grade is a reproducible, host-specific, version-bound evidence summary. It is never a publisher claim, popularity score, generic safety badge, or substitute for provenance, licensing, audit, compatibility, freshness, or lifecycle state.

## States

- `ungraded`: no canonical receipt exists.
- `provisional`: evidence is valid but below the rubric's stable sample/confidence threshold.
- `current`: all hard gates and currency rules pass for the named host profile and rubric.
- `stale`: a bound input changed or the receipt expired.
- `blocked`: a hard gate failed or required evidence is unavailable.
- `revoked`: the receipt issuer or operator invalidated the result for a consequential reason.

Only `current` and explicitly allowed `provisional` receipts may expose a band. Phase 1 contracts require `ungraded` to have no band, confidence, or fabricated receipt.

## Canonical receipt

The signed payload is an in-toto Statement v1 whose subject includes the immutable skill version and normalized artifact digest. The SkillMap predicate includes:

- receipt schema, rubric ID/version, evaluator/runtime/container digests, and issuer;
- skill, version, raw snapshot, manifest, and normalized artifact identities;
- host profile/version and host-documentation snapshot digest;
- evaluation suite ID/digest and train/validation/held-out split digests;
- no-skill and previous-version baseline identifiers/results;
- model/runtime snapshot, parameters, seed, tool policy, and network policy where applicable;
- dependency, vulnerability, advisory, provenance, license, audit, and compatibility evidence digests;
- case counts by class, repeated trial count, failures, variance, confidence interval, latency/token/cost deltas, and bounded evidence references;
- hard-gate results, dimension results, band, confidence, reason codes, issued time, expiry, and invalidation policy;
- signature or transparency verification bundle.

Raw prompts, private paths, secrets, account identifiers, and unrestricted model transcripts are not public receipt fields. Public case evidence is redacted and content-addressed.

## Hard gates

A current public grade requires:

- canonical immutable source and package identities;
- valid package structure and declared permissions;
- acceptable license/redistribution state;
- current provenance, audit, and required host-compatibility receipts;
- no unresolved critical security finding or applicable blocking advisory;
- minimum representative evaluation evidence, clean-context execution, required baselines, and rubric-defined confidence;
- reproducible evaluator inputs and current issuer trust.

Failure produces `blocked`, `stale`, or `ungraded` as defined by the rubric; the system does not average past a hard gate.

## Scorecard

The initial rubric may weight trigger quality, instruction quality, task effectiveness, host compatibility, safety/permissions, maintainability/freshness, and provenance/licensing. Exact weights and A-F thresholds are separately versioned calibration data. Public output shows dimension evidence and hard gates beside any band so the band is explainable.

Required evaluation classes include positive, paraphrase, negative, near-miss, platform/framework disambiguation, alternative/complement/prerequisite selection, ordered multi-intent routing, clarification/abstention, redundancy/conflict, prompt injection, unavailable permission/tool, and stale-reference behavior.

## Currency and invalidation

Any change to a bound source/artifact digest, host profile, rubric, suite, evaluator, dependency/advisory snapshot, permission declaration, or required evidence receipt makes the grade non-current. The current projection changes; the original signed receipt remains immutable. Regrading creates a new receipt and never edits the old result.

The canonical public response is constrained by `contracts/hosted-grade-summary/v1.schema.json`; later receipt schemas must be added separately rather than widening that summary with private evaluator data.
