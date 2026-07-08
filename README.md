# SkillMap

SkillMap is a local-first SkillOps CLI for people with too many agent skills. It scans installed `SKILL.md` files, doctors the library for ambiguity and risk, prepares native-agent curation, applies reversible policy, builds/query-explains a SkillGraph, routes prompts to the best skills, tracks external skill provenance, and can optionally install a passive Codex route-hint hook.

Status: experimental alpha moving toward v1. The current release is useful for local inventory, doctoring, native-agent policy curation, route-quality dogfooding, source provenance experiments, and controlled Codex hook dry-runs. It does not mutate global skill roots and does not install hooks unless you explicitly run a hook install command.

## Why this exists

Modern coding agents can use skills, hooks, MCP servers, plugins, and project instructions. Once a user has dozens or hundreds of skills, the hard problem becomes governance:

- What skills do I actually have?
- Which skills overlap or duplicate each other?
- Which skills are stale or downloaded from others?
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
skillmap status
skillmap doctor
skillmap doctor-pack --summary
skillmap curate codex --prepare
```

Paste `.skillmap/curation/codex-prompt.md` into Codex or Claude and ask the native agent to produce:

- `.skillmap/proposals/policy.yml`
- `.skillmap/proposals/policy-rationale.md`

Then review and ingest:

```bash
skillmap curate codex --ingest .skillmap/proposals/policy.yml --rationale .skillmap/proposals/policy-rationale.md --model codex-sota --confirm
skillmap apply-policy --strict
skillmap status
skillmap graph build
skillmap graph explain "make this dashboard less generic and verify mobile"
skillmap route "make this dashboard less generic and verify mobile" --trace
skillmap eval --file .skillmap/real-evals.json --save-report
```

## Source provenance and updates

Track skills downloaded from external repositories without overwriting local edits:

```bash
skillmap sources adopt writing-great-skills --repo mattpocock/skills --path skills/writing-great-skills
skillmap sources list
skillmap sources check
skillmap sources diff writing-great-skills
skillmap sources update writing-great-skills --dry-run
```

`update` is preview-only in this alpha slice. SkillMap will not overwrite source skill files.

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
scan -> status -> doctor -> doctor-pack -> curate -> apply-policy -> graph -> route/eval -> optional passive hook
```

- `scan` records raw filesystem truth in `.skillmap/inventory.json`.
- `status` reports fixture roots, mismatched policy, stale artifacts, curation receipts, source freshness, and eval confidence.
- `doctor` reports duplicates, missing descriptions, scripts, broad triggers, and other hygiene issues.
- `doctor-pack` creates a bounded Markdown packet for Codex/Claude to curate.
- `curate` records user-confirmed native-agent policy provenance.
- `apply-policy` builds `.skillmap/effective.json` without editing source skills.
- `graph` builds and explains the SkillGraph from the effective registry.
- `route` recommends skills from the effective graph with traceable reasons.
- `eval` measures route quality against prompt-to-skill cases.
- `sources` tracks external skill provenance and update status.
- `hook` can dry-run, install, or uninstall a passive Codex `UserPromptSubmit` hook with backups.

## Safety defaults

- No cloud dependency.
- No hook install unless explicitly requested.
- No deletion of skill files.
- No broad home-folder scan outside configured skill roots.
- Script-bearing skills are flagged, not trusted or executed.
- Route and hook paths do not call an LLM or network service.
- Source update application is not automatic.
- Hook installation backs up an existing `hooks.json` before modifying it.

## Development

```bash
npm ci
npm run typecheck
npm test
npm pack --dry-run
```

## Release state

This repository is private while the tool is being dogfooded. Treat the package as alpha until route quality is validated on a real curated policy and non-demo eval suite.

## V1 operator docs

- [Project handoff](HANDOFF.md)
- [First-run tutorial](docs/first-run.md)
- [Command reference](docs/commands.md)
- [Curation workflow](docs/curation.md)
- [SkillGraph and architecture](docs/architecture.md)
- [Hook usage](docs/hooks.md)
- [Host compatibility](docs/host-compatibility.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Threat model](docs/threat-model.md)
- [Security notes](docs/security.md)
