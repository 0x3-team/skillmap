# SkillMap

SkillMap is a local-first SkillOps CLI for people with too many agent skills. It scans installed `SKILL.md` files, doctors the library for ambiguity and risk, creates a native-agent curation pack, applies reversible policy, builds an effective graph, routes prompts to the best skills, and can optionally install a passive Codex route-hint hook.

Status: experimental alpha. The current release is useful for local inventory, doctoring, native-agent policy curation, route-quality dogfooding, and controlled Codex hook dry-runs. It does not mutate global skill roots and does not install hooks unless you explicitly run a hook install command.

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
skillmap doctor-pack --summary
skillmap doctor-pack --max-skills 120
```

Then open `.skillmap/doctor-pack.md` or `.skillmap/doctor-pack.summary.md` in Codex or Claude and ask the native agent to propose a policy. Apply that policy only after review:

```bash
skillmap apply-policy --policy .skillmap/proposals/policy.yml --dry-run
skillmap apply-policy --policy .skillmap/proposals/policy.yml
skillmap route "make this dashboard less generic and verify mobile" --trace
skillmap eval --file .skillmap/real-evals.json
```

## Optional Codex hook

The hook is passive: it only injects a compact route hint from the local effective registry. It does not call an LLM, does not use the network, and does not execute skill scripts.

```bash
skillmap route --hook --prompt "make this dashboard less generic"
skillmap hook dry-run codex "make this dashboard less generic"
skillmap hook install codex --passive --dry-run
```

Only install after route quality is acceptable:

```bash
skillmap hook install codex --passive
skillmap hook uninstall codex
```

By default, hook install targets the current project at `.codex/hooks.json`. Use `--global` only when you deliberately want `~/.codex/hooks.json`, or `--config PATH` for a controlled test file.

## Core flow

```text
scan -> doctor -> doctor-pack -> policy -> effective graph -> route/eval -> optional passive hook
```

- `scan` records raw filesystem truth in `.skillmap/inventory.json`.
- `doctor` reports duplicates, missing descriptions, scripts, broad triggers, and other hygiene issues.
- `doctor-pack` creates a bounded Markdown packet for Codex/Claude to curate.
- `apply-policy` builds `.skillmap/effective.json` without editing source skills.
- `route` recommends skills from the effective graph with traceable reasons.
- `eval` measures route quality against prompt-to-skill cases.
- `hook` can dry-run, install, or uninstall a passive Codex `UserPromptSubmit` hook with backups.

## Safety defaults

- No cloud dependency.
- No hook install unless explicitly requested.
- No deletion of skill files.
- No broad home-folder scan outside configured skill roots.
- Script-bearing skills are flagged, not trusted or executed.
- Hook installation backs up an existing `hooks.json` before modifying it.

## Development

```bash
npm ci
npm run typecheck
npm test
npm pack --dry-run
```

## Release state

This repository is private while the tool is being dogfooded. Treat the package as alpha until route quality is validated on a real curated policy, not just fixtures.
