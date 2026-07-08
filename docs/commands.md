# Commands

## `skillmap init`

Creates starter `.skillmap` files. Use `--dry-run` first.

## `skillmap scan`

Scans configured skill roots and writes `.skillmap/inventory.json`.

```bash
skillmap scan --root ~/.agents/skills --json
skillmap scan --fixtures test/fixtures/basic --json
```

## `skillmap status`

Summarizes trust state across inventory, policy, effective registry, curation receipts, eval reports, SkillGraph, and source freshness.

```bash
skillmap status
skillmap status --json
```

Warnings include fixture roots, unmatched policy entries, stale effective registry, missing curation receipt, weak eval confidence, and missing source-status.

## `skillmap doctor`

Analyzes the current inventory and writes doctor reports under `.skillmap`.

```bash
skillmap doctor
skillmap doctor --json
```

## `skillmap doctor-pack`

Creates a native-agent curation packet for Codex or Claude.

```bash
skillmap doctor-pack
skillmap doctor-pack --summary
skillmap doctor-pack --max-skills 80
```

Prefer `skillmap curate codex --prepare` before pasting curation context into a native agent so SkillMap can record provenance.

## `skillmap curate`

Prepares and ingests manual native-agent curation.

```bash
skillmap curate codex --prepare
skillmap curate codex --ingest .skillmap/proposals/policy.yml --rationale .skillmap/proposals/policy-rationale.md --model codex-sota --dry-run
skillmap curate codex --ingest .skillmap/proposals/policy.yml --rationale .skillmap/proposals/policy-rationale.md --model codex-sota --confirm
```

Model identity is user-reported unless a future provider-verified integration is added.

## `skillmap apply-policy`

Applies a reviewed policy to create an effective registry and graph. It does not edit source skills.

```bash
skillmap apply-policy --policy .skillmap/policy.yml --dry-run
skillmap apply-policy --policy .skillmap/policy.yml --strict
skillmap apply-policy --policy .skillmap/policy.yml --strict --allow-fixtures
```

`--strict` blocks fixture roots, unmatched policy entries, and duplicate inventory names sharing policy entries.

## `skillmap graph`

Builds, queries, explains, and exports graph data.

```bash
skillmap graph build
skillmap graph query frontend
skillmap graph explain "make this UI less generic"
skillmap graph duplicates
skillmap graph conflicts
skillmap graph export --format mermaid
skillmap graph export --format json
```

## `skillmap route`

Routes a prompt against the effective registry and emits traceable recommendations.

```bash
skillmap route "review this PR for auth bugs" --trace
skillmap route --hook --prompt "review this PR for auth bugs"
```

`--hook` emits compact text suitable for Codex `UserPromptSubmit` additional context. It reads the Codex hook JSON event from stdin when no `--prompt` is provided.

## `skillmap eval`

Runs prompt-to-skill route evals from a JSON eval file.

```bash
skillmap eval --file .skillmap/real-evals.json
skillmap eval --file .skillmap/real-evals.json --min-count 150 --save-report
```

Confidence labels: `demo`, `weak`, `alpha`, and `release`.

## `skillmap sources`

Tracks external skill provenance and checks for update state.

```bash
skillmap sources list
skillmap sources adopt writing-great-skills --repo mattpocock/skills --path skills/writing-great-skills
skillmap sources check
skillmap sources diff writing-great-skills
skillmap sources update writing-great-skills --dry-run
```

Update application is preview-only in this alpha slice; no source skill files are overwritten.

## `skillmap hook`

Dry-runs or manages a passive Codex hook.

```bash
skillmap hook dry-run codex "make this UI less generic"
skillmap hook install codex --passive --dry-run
skillmap hook install codex --passive
skillmap hook uninstall codex --dry-run
skillmap hook uninstall codex
```

Defaults to project-local `.codex/hooks.json`. Use `--global` for `~/.codex/hooks.json` only after deliberate review. Use `--config PATH` for a controlled config file.

## Doctor repair planning

```bash
skillmap doctor --fix-plan
```

Writes `.skillmap/reports/fix-plan.md`, a review-only repair plan grouped by severity. It does not edit, move, delete, or update skills.

## Export and import

```bash
skillmap export --redact-paths --output skillmap-export.json
skillmap import skillmap-export.json --dry-run
skillmap import skillmap-export.json --confirm
```

`export` creates a local JSON snapshot of inventory, policy, effective registry, SkillGraph, source receipts, source-status, source review decisions, eval report, and curation receipt when present. Use `--redact-paths` before sharing outside the machine.

`import` is intentionally conservative in v1. Dry-run is the default. Confirmed imports archive the incoming snapshot and write a conflict report under `.skillmap/imports/`; they do not overwrite active registry artifacts.

## Read-only MCP access

```bash
skillmap mcp manifest
skillmap mcp call route_prompt --prompt "make this UI less generic"
skillmap mcp call search_skills --query frontend
skillmap mcp serve
```

The v1 MCP surface is read-only. It exposes compact registry queries for agents without giving them mutation tools.

Read-only tools:

- `route_prompt`
- `search_skills`
- `show_skill`
- `show_skillgraph`
- `doctor_summary`
- `source_status`

## Related docs

- [First-run tutorial](first-run.md)
- [Host compatibility](host-compatibility.md)
- [Troubleshooting](troubleshooting.md)
- [Threat model](threat-model.md)

## Source review receipts

```bash
skillmap sources review ask-matt --decision hold --reason "Upstream renamed local flow commands; hold until local skill set is reconciled."
```

`review` records that a non-clean source state has been manually reviewed for the current source-status state. `status` continues to warn when the state changes or when a non-clean source record has no review receipt.
