# Host compatibility

| Host | V1 support | Notes |
| --- | --- | --- |
| Codex CLI/Desktop | Supported | Passive hook dry-run/install/uninstall commands are implemented. Global install still requires explicit user approval. |
| Claude Code | Documented post-v1 adapter | SkillMap can still be used through the CLI and read-only MCP. A native Claude hook adapter is deferred until current local behavior is verified. |
| Hermes/custom agents | Supported through CLI or read-only MCP | Use `skillmap mcp manifest`, `skillmap mcp call ...`, or `skillmap mcp serve`. |
| Cloud registry | Not in v1 | Use `skillmap export --redact-paths` and `skillmap import --dry-run` for local/dotfiles workflows. |

Runtime route and hooks are deterministic and do not call an LLM.
