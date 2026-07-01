# Architecture

SkillMap separates judgment from runtime routing.

```text
Native chat agent = semantic curation and user preference handling
CLI = scan, persist, policy, graph, route, eval
Hook = future tiny passive route advisory
```

The tool keeps two graph views:

- Raw graph: every skill found on disk.
- Effective graph: raw inventory after policy tiers, supersedes, overlaps, and exclusions.

Runtime routing uses the effective graph only. The hook path must remain deterministic and must not call an LLM.
