# Source Tiers

Use source tiers to decide what can support a claim. Higher-tier sources can still be stale, incomplete, or contradicted.

| Tier | Source Type | Default Weight | Use |
| --- | --- | --- | --- |
| `T0 local truth` | repo code, database rows, logs, build output, deployed artifact, actual product screenshots | highest | proves what is true in the user's system |
| `T1 official primary` | official docs, specs, standards, changelogs, official repos, API references, vendor status pages, filings | very high | establishes intended or published platform behavior |
| `T2 direct empirical` | runtime API calls, browser checks, minimal reproductions, benchmarks, tests | very high | verifies whether claims hold in practice |
| `T3 maintainer/community primary` | maintainer GitHub comments, official forum answers, project issue threads, release discussions | medium-high | documents edge cases, regressions, fixes, and undocumented behavior |
| `T4 credible secondary` | reputable technical analysis, independent benchmarks, well-evidenced tutorials | medium | helps interpretation and comparison |
| `T5 weak/unofficial` | Reddit, social posts, SEO listicles, unsourced summaries, anonymous comments | low | useful for leads, user pain, and contradictions, not proof |

## Ranking Rules

- Start with T0/T1 when available.
- Use T2 to verify material behavior when it is feasible and safe.
- Use T3 to explain gaps between docs and reality.
- Use T4/T5 as leads, not as final proof.
- Record source date, access date, version, region, plan/tier, API version, runtime, and account context when material.
- Current T0/T2 evidence can override stale T1 docs.
- If a source cannot be accessed because of auth, paywall, region, missing account, or rate limit, record it as blocked.
- For docs-vs-issue conflicts, separate intended contract, observed behavior, exact version/environment, and likely cause: stale docs, implementation bug, rollout gap, unsupported edge case, or user error.
- For competitor research, do not treat observed features as proof. Convert observations into `adopt`, `adapt`, `avoid`, and `not relevant` takeaways based on audience, workflow fit, implementation feasibility, legal/IP risk, and evidence of actual impact.

## Claims That Need Strong Evidence

- current API behavior, model availability, pricing, legal/regulatory, security, medical, financial, deployment, migration, and production behavior
- claims that would affect implementation, architecture, vendor choice, launch, spend, compliance, or user trust
- claims where official docs and real-world reports conflict
- competitor claims that would drive product, UX, pricing, or positioning decisions
