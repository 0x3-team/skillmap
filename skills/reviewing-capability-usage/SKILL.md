---
name: reviewing-capability-usage
description: Use when the user asks to review recent skill, tool, subagent, browser, memory, connector, goal, or local capability usage, especially to find missed capabilities, overuse, overclaiming, redundancy, or whether a new skill is justified.
---

# Reviewing Capability Usage

## Overview

Review how Codex used available capabilities over a bounded evidence window. This is a read-only retrospective for capability choice quality, not a product/code audit and not external claim verification.

Prime directive: judge whether the right capability was used for the job. Do not reward more tools, more subagents, or more process unless they materially improved evidence, correctness, or user fit.

Use `references/baseline-pressure-tests.md` as anti-regression pressure. The skill exists to prevent vague recaps, tool-count bias, memory-as-proof, missed trigger rules, and unnecessary new-skill creation.

## When To Use

- The user asks to review the last 24 hours, day, session, thread, or project lane of skills/tools used.
- The user asks whether Codex used the right capabilities.
- The user asks whether subagents, workers, browser lanes, memory, goals, connectors, local commands, or MCP tools were skipped, blocked, unavailable, or overused.
- The user asks to benchmark Skid capability usage against native Codex behavior.
- The user asks whether a repeated pattern deserves a new skill.
- A major planning, audit, implementation, checkpoint, research, or multi-agent session needs a meta-review of operating behavior.

## When Not To Use

- Product/code correctness, maintainability, release, UI/UX, security, backend, data, or production quality checkpoint: use `checkpoint-quality-loop`.
- External or current claim verification: use `verified-research`.
- Research that should lead to planning or implementation: use `research-plan-implementation-loop`.
- Implementation from an existing plan: use `implementation-orchestrator`.
- A simple one-turn status answer with no evidence window.

## Goal Rule

Use **no /goal by default**. This skill is normally a lightweight read-only review.

Create or reuse a `/goal` only when the user explicitly asks for a durable multi-session review, the evidence window spans many threads or repos, or the review itself must become an implementation handoff. If a goal is skipped, label the run `lightweight capability review`.

## Evidence Boundary

Start every review with an evidence boundary:

- requested window or thread
- sources inspected
- sources unavailable
- local, browser, live, deployed, pushed, blocked, and memory-derived limits
- what the review can and cannot prove

Memory is routing context, not proof. Chat summaries and recollection can guide where to inspect, but do not prove a skill worked, a browser check ran, a worker completed, or a live state was verified.

## Required Workflow

1. **Anchor:** requested window, session/thread, repo/product lane, user goal, and whether this is a quick review or durable report.
2. **Collect evidence:** inspect local skill files, output artifacts, RED/GREEN reports, plan ledgers, tool receipts, rollout summaries, transcript snippets, git state, browser evidence, or user-supplied logs as available.
3. **Classify capability decisions:** mark each material skill/tool/subagent/browser/memory/goal/local-command choice as `correct use`, `missed capability`, `appropriate skip`, `blocked`, `unavailable`, `overused`, or `misused`.
4. **Score fit:** use `references/review-rubric.md`. Reward capability fit, outcome value, evidence discipline, and overhead control, not tool volume.
5. **Check native superiority:** identify where Skid behavior beat or failed to beat native Codex behavior: evidence boundary, explicit routes, worker decisions, source truth, personalization, and stop conditions.
6. **Review new-skill pressure:** recommend a new skill only for repeated evidence-backed gaps that are cross-project, judgment-heavy, and not already covered by existing skills, docs, or automation.
7. **Report concise findings:** produce a short benchmark table, missed capabilities, overuse or ceremony, overclaiming or misuse, new-skill verdict, and concrete next actions.

## Output Contract

Default output:

```markdown
# Capability Usage Review

## Evidence Boundary

## Executive Verdict

## Capability Benchmark

| Capability | Used? | Fit | Outcome | Issue | Recommendation |

## Missed Capabilities

## Overuse Or Ceremony

## Overclaiming Or Misuse

## New-Skill Verdicts

## Concrete Next Actions
```

Use a saved Markdown report only when the review is broad enough to be useful later. For projectless Codex work, save user-facing reports under the current workspace `outputs/` directory.

## Required Receipts

- `Capability review contract`: window, source surfaces, evidence limits, non-goals, and stop conditions.
- `Capability benchmark`: exact capabilities considered, fit, outcome value, issue, and recommendation.
- `Evidence boundary`: inspected files/artifacts/logs, unavailable sources, memory limits, and blocked checks.
- `Native superiority receipt`: where behavior was better than native, no better than native, or worse than expected.
- `New-skill verdict`: create, edit existing skill, add eval, automate, leave alone, or insufficient evidence.

## New-Skill Gate

A new skill recommendation requires all of these:

- repeated failure across more than one evidence-backed case
- the gap is cross-project or likely to recur
- existing skills do not already own the behavior
- automation, local docs, or a one-line trigger edit would not solve it
- RED pressure scenarios can be written before implementation

Default verdict for a single example: `do not create a new skill yet`.

## Background Browser Rule

Do not use browser work by default. Use `background-browser-operator` only when the reviewed capability decision involved browser/background-browser behavior or a live web surface.

If browser evidence is used, record target, session/surface, safety boundary, timeout, reviewed evidence, blocked checks, and why browser evidence was necessary.

## Red Flags

Stop and tighten the review when you hear:

- "They used many tools, so it was thorough."
- "The chat says it happened, so it happened."
- "Memory says this was done."
- "One miss means we need a new skill."
- "Subagents are always better."
- "Parent-only is always faster."
- "This is really a product quality audit."
- "The browser was mentioned, so browser evidence exists."

## Common Mistakes

- Counting tool calls instead of judging outcome value.
- Treating memory or chat summary as proof.
- Missing explicit skill trigger violations.
- Praising overuse or ceremony because it looks rigorous.
- Recommending new skills for one-off issues.
- Duplicating `checkpoint-quality-loop`, `verified-research`, or `research-plan-implementation-loop`.
- Failing to distinguish local, browser, live, deployed, pushed, blocked, and not checked states.
- Producing a dossier when a concise findings table would be more useful.
