# Security Notes

SkillMap treats installed skills as untrusted local metadata.

## What SkillMap reads

- `SKILL.md` frontmatter and body size
- skill paths and roots
- presence of `scripts/`, `references/`, and `assets/`
- local `.skillmap` policy/eval/source files
- external source metadata only when `sources` commands are explicitly used

## What SkillMap does not do

- execute skill scripts
- upload skill content
- call an LLM in route or hook paths
- call the network during scan, doctor, route, graph, eval, or hook paths
- delete source skills
- install hooks without an explicit command
- overwrite downloaded skills during source update preview

## Native-agent curation boundary

`skillmap curate codex --prepare` creates a local prompt packet. The user chooses whether to paste that packet into Codex or Claude. `curate --ingest` records user-reported model provenance and does not claim provider-verified model identity.

## Source update boundary

`skillmap sources check` is an explicit network-capable command when GitHub sources are tracked. `sources update` is preview-only in this alpha slice and does not modify source skill files.

## Hook boundary

The Codex hook adapter is passive. It emits compact route context through `UserPromptSubmit` and does not block or rewrite prompts. Install defaults to project-local `.codex/hooks.json`; `--global` is deliberate opt-in.

Codex may load matching hooks from multiple sources. Review installed hooks with `/hooks` and trust only definitions you recognize.

## Sensitive data

Doctor packs can contain local filesystem paths and skill descriptions. Do not paste them into untrusted external services unless you are comfortable exposing that metadata.

## Import/export and MCP boundaries

- `skillmap export` reads local `.skillmap` artifacts and writes a local JSON snapshot. It does not upload data.
- Use `skillmap export --redact-paths` before sharing snapshots outside the machine.
- `skillmap import` does not overwrite active artifacts in v1; it archives the imported snapshot and writes a conflict report.
- `skillmap mcp` is read-only in v1. It can route, search, and summarize existing registry artifacts, but cannot update skills, install hooks, or mutate policy.

## Source review receipts

`skillmap sources review` records why a stale, risky, or unknown source state is accepted or held. Review receipts are state-specific; if the upstream state changes, `status` warns again.
