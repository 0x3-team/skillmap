# Reviewing Capability Usage Examples

## Last 24 Hours Review

User: `Review the last 24 hours of skill usage.`

Good response shape:

```markdown
# Capability Usage Review

## Evidence Boundary

- Window: last 24 hours requested.
- Sources inspected: named output artifacts, local skill files, available worker reports.
- Sources unavailable: complete transcript/tool log export.
- Memory use: routing only, not proof.
- Cannot prove: live/browser/deployed states unless receipts exist.

## Executive Verdict

Capability use was mostly justified, but there were two misses: one stalled worker was waited on too long, and browser/background mode should only receive credit where a browser receipt exists.

## Capability Benchmark

| Capability | Used? | Fit | Outcome | Issue | Recommendation |
| --- | --- | --- | --- | --- | --- |
| implementation-orchestrator | yes | correct use | gave acceptance contract | none | keep |
| subagent worker | yes | overused | stalled | ceremony/latency | use shorter RED prompt or parent-owned fallback |

## Concrete Next Actions

1. Add eval for stalled worker fallback.
2. Leave existing checkpoint/research skills unchanged.
```

## New Skill Pressure

User: `Should this pattern become another skill?`

Good verdict:

```markdown
New-skill verdict: do not create a new skill yet.

Evidence: one example only. Existing `checkpoint-quality-loop` and `implementation-orchestrator` already cover most of the behavior. Add one eval or trigger note first; revisit after a second evidence-backed failure.
```

## Browser Capability Review

User: `Did we use background browser correctly?`

Good boundary:

```markdown
Browser capability: blocked/partial.

Evidence inspected: plan mentions background browser support, but no target, session, timeout, screenshot, log, or browser receipt was available. I can credit the planning decision, not actual browser execution.
```

