# Examples

## Quick Research

Prompt: `Research whether this API behavior is still current.`

Correct route:

- Anchor API, version, SDK/runtime, date sensitivity, and decision.
- Inspect official docs/changelog first.
- Check source repo/issues if behavior is disputed.
- Run or request a minimal direct check if feasible.
- Return claim statuses and blocked checks.
- Do not implement.

## Deep Research

Prompt: `People say this library is broken. Research whether we should use it.`

Correct route:

- Use source tiers: official docs/releases, source repo, issues, maintainer comments, credible secondary reports, weak unofficial anecdotes.
- Build a claim ledger by version/environment.
- Mark unresolved complaints as `disputed` or `unverifiable`, not proof.
- Produce an adoption recommendation only after evidence quality is clear.

## Background Research

Prompt: `Research this logged-in browser workflow while I study.`

Correct route:

- Use `background-browser-operator`.
- Record target, auth/session state, read-only safety boundary, success criteria, timeout, evidence, and blocked checks.
- Do not mutate account or production state unless explicitly authorized.

## Competitor Research

Prompt: `Research this competitor and tell me what we should copy.`

Correct route:

- Inspect official site/product evidence where available.
- Separate product truth from positioning copy.
- Output adopt/adapt/avoid/not-relevant takeaways.
- Do not copy branding, exact layouts, proprietary flows, or unsupported assumptions.

