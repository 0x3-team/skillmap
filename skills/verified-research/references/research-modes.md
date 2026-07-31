# Research Modes

Choose the lightest mode that can support the user's decision.

| Mode | Use When | Required Output |
| --- | --- | --- |
| `quick research` | narrow, low-risk question with limited drift | short answer, key sources, uncertainty |
| `deep research` | multi-source, current, high-stakes, contradictory, or implementation-bound research | goal, dossier, claim ledger, receipts |
| `background research` | user asks research to proceed while studying/working elsewhere | `background-browser-operator` lane, target, safety boundary, timeout, evidence |
| `research audit` | user provides an article, plan, claim set, or previous answer to verify | claim-by-claim statuses and corrected conclusion |

## Quick Research

Use quick research when the answer is narrow and low risk. Still include source tier, date/freshness notes when relevant, and a clear uncertainty statement.

Label it `lightweight research only` if no goal or durable file is created.

## Deep Research

Use deep research when:

- the topic is current or drift-prone
- official and unofficial sources may conflict
- the output will feed planning or implementation
- the topic is high-stakes or spend-related
- more than one independent source lane is needed

Create/reuse a goal and save a dossier unless blocked or explicitly unnecessary.

## Background Research

Use `background-browser-operator` when browser inspection can proceed while the user studies or works.

Required receipt, aligned with `background-browser-operator` status reporting:

```text
Background browser research receipt:
- Target/surface:
- Browser/session:
- Auth state:
- Safety boundary:
- Success criteria:
- Timeout/stop condition:
- Evidence captured:
- Blocked checks:
- Final status:
```

Default safety boundary: read-only. Do not submit, purchase, delete, send, change settings, or mutate production/account state unless explicitly authorized.

## Research Audit

Use when verifying an existing claim set. Output statuses:

- confirmed
- likely
- disputed
- false
- stale
- unverifiable

The corrected conclusion must explain which claims changed and why.
