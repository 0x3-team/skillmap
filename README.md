# SkillMap

SkillMap is a local-first SkillOps CLI for people with too many agent skills. It scans installed `SKILL.md` files, doctors the library for ambiguity and risk, creates a native-agent curation pack, applies reversible policy, builds an effective graph, and routes prompts to the best skills.

Status: experimental alpha. The current release is useful for local inventory, doctoring, policy experiments, and route-quality dogfooding. It does not install hooks by default and does not mutate global skill roots.

## Why this exists

Modern coding agents can use skills, hooks, MCP servers, plugins, and project instructions. Once a user has dozens or hundreds of skills, the hard problem becomes governance:

- What skills do I actually have?
- Which skills overlap or duplicate each other?
- Which skills are risky because they include scripts?
- Which skill should be preferred for a given request?
- What tiny route hint should the agent see without loading everything?

SkillMap is the local quality layer for that workflow.

## Install

```bash
npm install -g skillmap
```

Or run from a local checkout:

```bash
npm install
npm run build
node dist/cli.js --help
```

## Quickstart

```bash
skillmap init --dry-run
skillmap scan
skillmap doctor
skillmap doctor-pack
```

Then open `.skillmap/doctor-pack.md` in Codex or Claude and ask the native agent to propose a policy. Apply that policy only after review:

```bash
skillmap apply-policy --policy .skillmap/proposals/policy.yml --dry-run
skillmap apply-policy --policy .skillmap/proposals/policy.yml
skillmap route "make this dashboard less generic and verify mobile" --trace
```

## Core flow

```text
scan -> doctor -> doctor-pack -> policy -> effective graph -> route trace
```

- `scan` records raw filesystem truth in `.skillmap/inventory.json`.
- `doctor` reports duplicates, missing descriptions, scripts, broad triggers, and other hygiene issues.
- `doctor-pack` creates a bounded Markdown packet for Codex/Claude to curate.
- `apply-policy` builds `.skillmap/effective.json` without editing source skills.
- `route` recommends skills from the effective graph with traceable reasons.

## Safety defaults

- No cloud dependency.
- No hook install in the alpha core flow.
- No deletion of skill files.
- No broad home-folder scan outside configured skill roots.
- Script-bearing skills are flagged, not trusted or executed.

## Development

```bash
npm ci
npm run typecheck
npm test
npm pack --dry-run
```

## Release state

This repository is private while the tool is being dogfooded. Treat the package as alpha until route quality is validated on a real curated policy, not just fixtures.
