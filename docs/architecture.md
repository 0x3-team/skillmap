# Architecture

SkillMap separates judgment from runtime routing.

```text
Native chat agent = semantic curation and user preference handling
CLI = scan, persist, policy, status, SkillGraph, route, eval, sources
Hook = tiny passive route advisory
```

The tool keeps two graph views:

- Raw graph: every skill found on disk.
- Effective graph / SkillGraph: raw inventory after policy tiers, supersedes, overlaps, exclusions, source provenance, and curation/eval context.

Runtime routing uses the effective graph only. The hook path must remain deterministic and must not call an LLM or network service.

CodeGraph is useful for developing SkillMap, but SkillGraph is a separate domain graph for agent capabilities rather than source-code symbols.

## V1 local sharing and agent access

SkillMap v1 keeps cross-agent access local-first:

- `skillmap export` creates a portable registry snapshot.
- `skillmap import` reports conflicts and archives imported snapshots without overwriting active artifacts.
- `skillmap mcp serve` exposes read-only registry tools over stdio-style JSON-RPC.

Mutation remains CLI-explicit. The MCP surface intentionally has no write/update/install tools in v1.
