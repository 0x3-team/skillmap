# Host compatibility

| Host | V1 support | Notes |
| --- | --- | --- |
| Codex CLI/Desktop | Supported | Passive hook dry-run/install/uninstall commands are implemented. Global install still requires explicit user approval. |
| Claude Code | Documented post-v1 adapter | SkillMap can still be used through the CLI and read-only MCP. A native Claude hook adapter is deferred until current local behavior is verified. |
| Lovable | Portable skill packages | Each mirrored skill fits Lovable's documented package limits and can be exported as a deterministic ZIP. GitHub URL import requires this repository to be public; it remains private pending an explicit owner decision. |
| GitHub Copilot / VS Code | Portable skill packages | Project installs target `.github/skills`; global installs target `~/.copilot/skills`. |
| Cursor | Portable skill packages | Project installs target `.cursor/skills`; use a custom destination if the installed Cursor release is configured differently. |
| Hermes/custom agents | Supported through CLI or local MCP | Use `skillmap mcp manifest`, `skillmap mcp call ...`, or connect an MCP SDK-compatible stdio client to `skillmap mcp serve`. The six-tool metadata surface is local only; no remote HTTP endpoint exists. |
| Cloud registry | Not in v1 | Use `skillmap export --redact-paths` and `skillmap import --dry-run` for local/dotfiles workflows. |

Runtime route and hooks are deterministic and do not call an LLM.

The local MCP server negotiates lifecycle through the official SDK, reports the string package version, and accepts newline-framed stdio requests up to 64 KiB. It returns revision-bound metadata only, never skill bodies or local paths. From a source checkout, `npm run test:mcp:stdio` is the compatibility smoke for the actual built child process.
