# Threat model

## Assets

- Local skill contents and paths
- Policy and curation receipts
- Source provenance records
- Hook configuration files
- Exported registry snapshots

## Trust boundaries

- `scan`, `doctor`, `route`, `graph`, `eval`, `status`, `export`, `import`, and `mcp` operate on local files.
- `sources check`, `sources diff`, and `sources update` can fetch explicit GitHub raw URLs for tracked source records.
- Hook installation mutates only the configured hook file and creates a backup.

## Non-goals in v1

- No cloud upload
- No background daemon
- No runtime LLM calls
- No automatic source updates
- No automatic deletion of skills
- No write-capable MCP tools

## Main risks and controls

| Risk | Control |
| --- | --- |
| Hidden upload of skill content | No cloud service in v1; source network calls are explicit commands. |
| Skill script execution | Scan/doctor/route never execute skill scripts. |
| Overwriting local skill edits | Source updates compare installed/current/upstream hashes and require confirmation; local modifications block overwrite. |
| Risky upstream instruction changes | `external-risky-update` requires review and `--allow-risky`. |
| Hook config corruption | Hook install is explicit and writes a timestamped backup. |
| Export leaks local paths | Use `skillmap export --redact-paths`. |
| Agent mutation through MCP | V1 MCP tools are read-only. |
