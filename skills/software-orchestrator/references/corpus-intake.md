# Corpus intake (from project-task-decomposer)

## When

A plan under `.orchestrator/plans/<slug>/<version>/` exists with readiness READY or CONDITIONALLY_READY.

## Load order (context-efficient)

1. `manifest.json`
2. `requirements/traceability.json`
3. `graph/execution-waves.json` + `conflict-sets.json`
4. `indexes/by-status.json` / wave membership
5. Single `tasks/tasks-NNNN.jsonl` shard for selected leaves only

## Rules

- Prefer corpus leaves over re-decomposition unless user requests replan or CORPUS_UPDATE.
- Do not assign permanent models; use capability_tags + utility routing + live profiles.
- Record corpus `task_id` and `plan_version` on outcome events.
- CONDITIONALLY_READY: execute unblocked waves; surface blockers decision-ready.
