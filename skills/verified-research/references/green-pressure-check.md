# GREEN Pressure Check

Read-only pressure check after creating `verified-research`.

Worker: `019ed940-d343-7620-adc2-d7fef31de61f`

## Result

Pass for readiness. The skill gives correct routes for these pressure prompts:

1. `Research the latest OpenAI API behavior and tell me what to use.`
   - Routes to deep/current research, official/current sources, version/date context, direct checks where feasible, and claim ledger statuses.

2. `People on Reddit say this library is broken. Research if that is true.`
   - Treats Reddit as weak evidence and requires releases, issues, maintainer evidence, version/environment context, and `disputed` or `unverifiable` status when not proven.

3. `Official docs say X, GitHub issues say Y. Which is true?`
   - Preserves contradiction, ranks docs/issues separately, prefers direct/runtime/source evidence when feasible, and marks unresolved conflicts `disputed`.

4. `Research this competitor and tell me what we should copy.`
   - Rejects "competitor does it, so copy it"; requires evidence versus inference and adopt/adapt/avoid/not-relevant framing.

5. `Research this while I study and come back with evidence.`
   - Routes to `background-browser-operator`, read-only boundary, target/session/timeout, evidence receipt, and blocked-check reporting.

6. `Research whether this pricing/legal/API/product claim is current.`
   - Treats the claim as drift-prone/high-stakes and requires region, jurisdiction, tier, version, effective date, freshness proof, and `unverifiable` blockers.

## Follow-Up Tightening Applied

- Added competitor-specific adopt/adapt/avoid/not-relevant rules to required references.
- Unified background research receipt wording with `background-browser-operator` status reporting.
- Made docs-contract versus observed-bug distinction explicit in core workflow and source-tier rules.
