---
name: verified-research
description: Use when the user asks to research, investigate, compare sources, verify claims, evaluate evidence, or produce an evidence-backed answer or dossier without immediately implementing changes.
---

# Verified Research

## Overview

Research is not complete because sources were found. It is complete when important claims are tied to source quality, freshness, verification status, contradictions, and actionability.

Use this skill to turn research into an auditable claim ledger. Do not plan or implement unless the user asks for that next step.

## When To Use

- The user says "research", "look into", "verify", "is this true", "compare sources", or "what is actually current".
- Official docs, community reports, pricing, APIs, product claims, legal/regulatory information, competitors, or current behavior may conflict or drift.
- The user asks for official and unofficial sources.
- The user wants background browser research while studying or doing other work.
- A planning or implementation decision needs evidence, but implementation has not been authorized.

## When Not To Use

- The user asks for a local code audit or checkpoint; use `checkpoint-quality-loop` or `audit-orchestrator`.
- The user asks for root cause of an unexplained live incident; use `root-cause-investigator`.
- A verified research dossier already exists and the user wants only planning or implementation.
- The answer is a trivial fact that does not need source ranking or a durable trail.

## Goal Rule

Use a `/goal` for deep, multi-source, high-stakes, current, contradictory, background-browser, or implementation-bound research. The goal is the research ledger.

For a tiny answer, a goal is optional. If skipped, label the run `lightweight research only`.

Never close a research goal because web search finished. Close only when the claim ledger is complete enough for the requested decision, or an exact blocker prevents verification.

## Required Workflow

1. **Anchor:** question, decision to support, target repo/product/system, time sensitivity, jurisdiction/region/version/tier, source types needed, exclusions, and stop conditions.
2. **Choose mode:** use `references/research-modes.md`.
3. **Rank sources:** use `references/source-tiers.md`; official sources start high, but stale docs do not beat current local or empirical evidence.
4. **Build claim ledger:** use `references/claim-ledger.md` for every important claim.
5. **Verify material claims:** prefer local truth, official primary sources, direct runtime/browser/API checks, changelogs, source repos, and maintainer evidence.
6. **Preserve contradictions:** do not smooth conflicts into one answer. Mark claims `confirmed`, `likely`, `disputed`, `false`, `stale`, or `unverifiable`. When docs and real-world reports conflict, distinguish intended contract, observed behavior, version/environment, and whether the conflict is a bug, stale documentation, rollout gap, or unsupported edge case.
7. **Handle background browser work:** use `background-browser-operator` when the user asks for browser research while they study or work; include target, timeout, safety boundary, and evidence receipt.
8. **Synthesize:** separate evidence, inference, recommendation, and what not to use.
9. **Stop or hand off:** research-only stops with a report/dossier. If the user asks for planning, hand the dossier to `planning-orchestrator`. If the user asks for implementation, require a plan before code edits.

## Required Receipts

Include these in the final answer or dossier:

- `Research anchor`: question, scope, time sensitivity, target system, region/version/tier, exclusions.
- `Source receipt`: sources inspected, source tiers, dates/versions/access limits, blocked sources.
- `Claim receipt`: confirmed/likely/disputed/false/stale/unverifiable counts.
- `Verification receipt`: direct checks, browser/API/runtime evidence, blocked checks.
- `Dossier`: path if a durable file was saved.
- `Next action`: answer, plan, implement, monitor, or stop.

## Dossier Contract

For non-trivial research, save a Markdown dossier unless the user only wants a short answer:

```markdown
# <Topic> Verified Research Dossier

## Research Contract
## Executive Findings
## Claim Ledger
## Source Notes
## Contradictions And Uncertainty
## Actionable Implications
## What Not To Use
## Planning Handoff
## Verification Gaps
```

Use a repo-local `docs/research/` path when a repo is anchored. Otherwise use the current workspace `outputs/` directory.

## Red Flags

Stop and tighten the research when you hear:

- "I searched, so it is verified."
- "Official docs say it, so it must be current."
- "Multiple users complained, so it is broken."
- "The page says as of now" without date, version, region, or access evidence.
- "Competitor does it, so we should copy it."
- "The sources conflict, so I will choose the more authoritative-looking one."
- "Browser workflow seemed fine."

## Common Mistakes

- Treating search snippets as sources.
- Omitting source dates, versions, tiers, regions, plan levels, or access limits.
- Not separating claim, evidence, inference, and recommendation.
- Treating Reddit/social/listicles as proof.
- Treating stale official docs as stronger than current empirical evidence.
- Failing to say `unverifiable` when auth, paywall, API key, region, or account state blocks proof.
- Passing disputed claims downstream as facts.
- Copying competitor branding, layouts, copy, or proprietary flows instead of extracting adopt/adapt/avoid principles.
