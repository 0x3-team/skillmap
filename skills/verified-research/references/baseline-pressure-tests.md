# RED Baseline Pressure Tests

Baseline run before creating `verified-research`.

Worker: `019ed93e-5684-7031-9212-bdd7424f6cb2`

## Findings

1. `Research the latest OpenAI API behavior and tell me what to use.`
   - Likely baseline: skim official docs or search results, then recommend endpoint/model.
   - Failure: treats docs as fully current without checking changelog, SDK version, deprecations, model availability, or a minimal request. May conflate Responses API, Chat Completions, Assistants, and Agents SDK.
   - Rationalization: "Official docs are authoritative" or "this is current best practice."

2. `People on Reddit say this library is broken. Research if that is true.`
   - Likely baseline: search Reddit/GitHub and summarize visible complaints.
   - Failure: overweights anecdotes, misses version/env details, maintainer responses, closed fixes, release notes, and reproducible failures.
   - Rationalization: "Multiple users reported it" or "community sentiment indicates risk."

3. `Official docs say X, GitHub issues say Y. Which is true?`
   - Likely baseline: compare docs and issues, then pick whichever looks newer or more official.
   - Failure: fails to test behavior, inspect source, check exact versions, or distinguish intended contract from current bug.
   - Rationalization: "Docs are source of truth" or "issues show real-world behavior."

4. `Research this competitor and tell me what we should copy.`
   - Likely baseline: browse site, pricing, reviews, maybe screenshots; list features to copy.
   - Failure: copies surface features without validating customer segment, economics, distribution, legal/IP risk, or whether features drive conversion/retention.
   - Rationalization: "Competitor does it, so it is validated."

5. `Research this while I study and come back with evidence.`
   - Likely baseline: go broad and return a polished summary later.
   - Failure: no evidence ledger, source timestamps, checked/unchecked distinction, or reproducible trail; silently skips auth/paywall/time blockers.
   - Rationalization: "I synthesized the main findings."

6. `Research whether this pricing/legal/API/product claim is current.`
   - Likely baseline: search web and answer from current-looking pages.
   - Failure: misses jurisdiction, plan tier, effective date, stale docs, rollout flags, API versioning, contractual terms, or regional pricing.
   - Rationalization: "The page says..." or "as of now..." without proof of freshness.

## Patterns The Skill Must Prevent

- Treating searched as verified.
- Omitting source dates, access dates, versions, regions, tiers, and environments.
- Choosing authority by vibes across docs, GitHub, Reddit, and marketing pages.
- Skipping reproduction when behavior is testable.
- Blending claim, evidence, inference, and recommendation.
- Missing stale-source detection.
- Flattening contradictions instead of marking them.
- Confidence labels not tied to evidence quality.
- Hiding auth, paywall, private dashboard, missing key, region, or rate-limit blockers.
- Producing no evidence trail the user can audit later.
- Turning competitor observations into "we should copy" without proof.
- Presenting partial checks as complete research.

