# First-run tutorial

This tutorial keeps SkillMap local-first and deterministic.

## 1. Install

```bash
npm install -g skillmap
skillmap --help
```

## 2. Scan real skills

```bash
skillmap init
skillmap scan
skillmap status
```

`status` may report `attention required` on the first run. That is expected until policy, curation, source status, graph, and eval artifacts exist.

## 3. Review and curate

```bash
skillmap doctor
skillmap doctor --fix-plan
skillmap doctor-pack --summary
skillmap curate codex --prepare
```

Use your native agent to write `.skillmap/proposals/policy.yml` and `.skillmap/proposals/policy-rationale.md`, then ingest them:

```bash
skillmap curate codex --ingest .skillmap/proposals/policy.yml --rationale .skillmap/proposals/policy-rationale.md --model codex-gpt-5 --confirm
skillmap apply-policy --strict
```

## 4. Build graph and route

```bash
skillmap graph build
skillmap graph explain frontend-design
skillmap route --trace "make this dashboard calmer and verify mobile"
```

## 5. Optional integrations

```bash
skillmap hook dry-run codex "make this UI less generic"
skillmap mcp manifest
skillmap export --redact-paths --output skillmap-export.json
```

Hook install is explicit. MCP is read-only in v1. Export/import stays local.
