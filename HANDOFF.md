# SkillMap Handoff

Date: 2026-07-08
Repo: https://github.com/Masih-0x3/skillmap
Current branch: `main`
Current pushed commit before this handoff: `2709937347cb4f556ceb0c123306f6db3df8f8af`
Status at handoff creation: local repo clean and aligned with `origin/main`.

## Purpose of this handoff

This document lets a fresh agent continue SkillMap without needing the full original Codex thread. It summarizes what was built, what was validated, what remains intentionally gated, and which artifacts should be treated as source evidence.

Do not duplicate or reinterpret the whole planning history. Use this handoff as the map, then inspect current repo state before editing.

## Product summary

SkillMap is a local-first skill registry, SkillGraph, router, source tracker, and quality system for coding agents.

The strongest intended architecture is:

```text
skills live outside the host model prompt context
SkillMap indexes and curates them
user prompt arrives
SkillMap route/MCP selects relevant skills
agent receives compact route advice
agent loads only selected skill content when needed
```

This is different from adding another skill list into Codex. The main value appears when SkillMap becomes the skill access layer, not when it sits on top of an already-loaded host skill registry.

## What has been completed

A v1 release candidate has been implemented, committed, pushed, and CI passed.

Completed surfaces:

- CLI scan/list/doctor/doctor-pack/status.
- `doctor --fix-plan` review-only repair plan.
- Native Codex curation workflow: `curate codex --prepare` and `curate codex --ingest`.
- Strict policy application and effective registry generation.
- SkillGraph commands: build/query/explain/duplicates/conflicts/export.
- Deterministic route and hook output.
- Passive Codex hook install/uninstall with backup/merge safety.
- Source provenance and update checker: list/adopt/check/diff/update/review.
- Source review receipts for reviewed stale/risky/unknown states.
- Release-confidence eval support with `.skillmap/real-evals.json`.
- Local export/import with redaction and conflict reporting.
- Read-only MCP surface: manifest/call/serve.
- First-run, troubleshooting, host compatibility, security, and threat model docs.
- GitHub issue templates.

## Validation evidence

Latest known release-candidate evidence from the prior implementation run:

- Commit: `2709937347cb4f556ceb0c123306f6db3df8f8af`
- CI run: https://github.com/Masih-0x3/skillmap/actions/runs/28982829760
- CI result: success
- `npm ci`: passed with 0 vulnerabilities reported
- `npm run typecheck`: passed
- `npm test`: passed, 16/16 tests
- `npm --cache /private/tmp/skillmap-npm-cache pack --dry-run`: passed
- `npm --cache /private/tmp/skillmap-npm-cache publish --dry-run`: passed
- Clean consumer install from local tarball: passed
- `skillmap status` on copied corpus: `ok`
- Eval: 185 prompts, 183/185 top-1, 185/185 top-3, 0 avoid hits, release confidence
- MCP serve JSON-RPC smoke: initialized and listed 6 read-only tools
- Temp hook install/uninstall smoke: passed

Important local evidence artifacts outside the repo:

- `/Users/stevmq/Documents/Codex/2026-07-01/wha/outputs/2026-07-08-skillmap-v1-completion-report.md`
- `/Users/stevmq/Documents/Codex/2026-07-01/wha/outputs/skillmap-v1-dogfood/skillmap-effect-audit.md`
- `/Users/stevmq/Documents/Codex/2026-07-01/wha/outputs/skillmap-v1-dogfood/skillmap-effect-audit.json`
- `/Users/stevmq/Documents/Codex/2026-07-01/wha/outputs/skillmap-v1-dogfood/clean-install-final-latest.json`

These output files are not part of the published package. They are audit evidence from this local workspace.

## Scientific audit summary

We compared SkillMap to a raw inventory-only lexical baseline over 185 labeled prompts.

Results:

- SkillMap top-1: 183/185 = 98.9%
- Baseline top-1: 179/185 = 96.8%
- SkillMap top-3: 185/185 = 100%
- Baseline top-3: 179/185 = 96.8%
- Top-1 gain: +2.2 percentage points, positive but not statistically decisive on this sample
- Top-3 gain: +3.2 percentage points, statistically meaningful on this sample
- Avoid hits: 0 for both
- Mean SkillMap hook output: about 70 chars, about 17.5 tokens
- Full name+description catalog: about 17,523 tokens
- Full skill bodies: about 384,016 tokens

Scientific conclusion:

SkillMap's strongest proven benefit is context efficiency and governance. Routing quality improved modestly. The honest claim is not "dramatically smarter routing"; it is compact, policy-backed skill access without loading the whole skill library into context.

## Current design truth

Codex does not literally dump every full skill body into every prompt by default. The more accurate model is:

- Codex can expose a large skill registry or capability manifest.
- Full skill bodies are loaded progressively when selected or read.
- SkillMap only saves major tokens if the host uses SkillMap as the router/access layer instead of exposing a broad native skill catalog.

Best architecture:

```text
SkillMap = external skill registry + router + policy layer + MCP/CLI loader
```

Not:

```text
SkillMap = another list of skills inside Codex
```

## Release boundary

The repo is a v1 release candidate, but public release actions were intentionally not performed without explicit user approval.

Not yet done:

- `npm publish`
- GitHub tag/release
- Global hook install
- Applying held risky/stale upstream third-party skill updates

Before public release, a fresh agent should verify current state again because package registries, CI, and repo state can drift.

## Source update state

During copied-root dogfooding, several Matt Pocock skills had upstream drift.

Safe copy-local updates applied during the v1 run:

- `handoff`
- `writing-great-skills`

Held with review receipts:

- `ask-matt`: risky upstream update references renamed flows not present locally.
- `grilling`: risky behavior wording change held.
- `implement`: stale update assumes spec/tickets/code-review naming not present locally.
- `setup-matt-pocock-skills`: stale update assumes to-spec/to-tickets naming not present locally.
- `tdd`: large upstream rewrite held for manual review.
- `diagnosing-bugs`, `edit-article`, `handoff`: latest source check hit GitHub raw 429; held until recheck succeeds.

The original user skill roots were not mutated. Work was performed on copied skill roots under local outputs.

## Suggested skills for next agent

Use these only when relevant:

- `engineering-acceptance-review`: final review before release/publish.
- `checkpoint-quality-loop`: repeat quality gates after any meaningful change.
- `implementation-orchestrator`: if implementing post-v1 changes.
- `planning-orchestrator`: if creating a v1.1 roadmap or public-release plan.
- `codegraph`: inspect blast radius before multi-file refactors if index is available.
- `handoff`: create a new concise handoff after any substantial continuation.

## Recommended next actions

If the next goal is public release:

1. Re-anchor repo state.
2. Run `git status --short --branch`.
3. Run `npm ci`.
4. Run `npm run typecheck`.
5. Run `npm test`.
6. Run `npm --cache /private/tmp/skillmap-npm-cache pack --dry-run`.
7. Run `npm --cache /private/tmp/skillmap-npm-cache publish --dry-run`.
8. Check latest GitHub CI.
9. Confirm package name, version, npm account, tag strategy, and visibility with the user.
10. Only after explicit approval: tag, publish, create GitHub release.

If the next goal is product improvement:

1. Build a true no-SkillMap human/agent A/B test, not only raw lexical baseline.
2. Add a `show`/`load` command for selected skill content if not already sufficient through MCP `show_skill`.
3. Improve host integration so Codex/Claude can avoid broad native skill registry exposure.
4. Add a hosted or synced registry only after local export/import and MCP workflows are stable.
5. Expand evals with real missed routes from daily use, not only generated examples.

## Important constraints

- Do not mutate original user skill roots unless the user explicitly asks.
- Do not install global hooks without explicit approval.
- Do not publish npm, create tags, or create GitHub releases without explicit approval.
- Treat local outputs as evidence, not package artifacts.
- Keep SkillMap local-first for v1; cloud registry/sync is v1.1 or later unless explicitly reprioritized.
- Be honest about benefits: large context savings, modest measured routing quality improvement.

## Quick commands for a fresh agent

```bash
cd /Users/stevmq/Documents/Codex/2026-07-01/wha/work/skillmap
git status --short --branch
npm run typecheck
npm test
node dist/cli.js status --json
node dist/cli.js eval --file .skillmap/real-evals.json --min-count 150 --save-report --json
```

If the local npm cache has ownership issues, use:

```bash
npm --cache /private/tmp/skillmap-npm-cache pack --dry-run
```
