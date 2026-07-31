# Claim Ledger

Use a claim ledger for every important research claim. Important means the claim affects a decision, plan, implementation, spend, security, compliance, or user trust.

## Template

```text
Claim:
Why it matters:
Source tier:
Sources:
Freshness/date:
Version/platform/context:
Verification method:
Status: confirmed | likely | disputed | false | stale | unverifiable
Confidence: high | medium | low
Contradictions:
Implication:
Actionability:
Planning handoff:
Implementation risk:
```

For competitor research, add:

```text
Transferable principle: adopt | adapt | avoid | not relevant
Business/workflow fit:
Legal/IP/copying risk:
Evidence of impact:
```

## Status Rules

| Status | Meaning | Minimum Bar |
| --- | --- | --- |
| `confirmed` | Strong evidence supports the claim. | T0/T1/T2 evidence, or multiple aligned high-quality sources with no material contradiction. |
| `likely` | Credible but not directly verified. | Strong source but no direct check, or incomplete context. |
| `disputed` | Credible sources conflict. | Preserve both sides and state what would resolve it. |
| `false` | Stronger evidence contradicts the claim. | Explain which evidence overturned it. |
| `stale` | Source no longer matches the current date, version, region, or platform. | State the mismatch. |
| `unverifiable` | No safe or available path to prove it. | Name the blocker: auth, account, paywall, API key, region, rate limit, missing logs, etc. |

## Confidence Rules

- `high`: strong source tier, current context, and direct or primary verification.
- `medium`: credible source, but missing direct proof or complete context.
- `low`: weak source, incomplete source trail, or unresolved contradiction.

## Anti-Cheat

- Do not mark a claim `confirmed` from search snippets.
- Do not mark a claim `confirmed` from Reddit/social/listicles alone.
- Do not hide contradictions in a prose paragraph.
- Do not pass `likely`, `disputed`, `stale`, or `unverifiable` to planning or implementation as fact.
- Do not imply currentness without date/version/context evidence.
- Do not turn a competitor observation into a recommendation without audience fit, feasibility, and evidence of impact.
