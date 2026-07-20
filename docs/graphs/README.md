# SkillMap graphs

These diagrams are intentionally separated by question. The old project map tried to answer architecture, runtime behavior, hosted authority, and release readiness in one view, which made it hard to read.

Use them like this:

- `system-boundaries.mmd` — what exists and which side owns it.
- `local-routing-sequence.mmd` — what happens when a prompt is routed locally.
- `hosted-submission-authority.mmd` — how a submitted skill becomes public metadata.
- `module-dependencies.dot` — the code-level dependency shape; render with Graphviz when available.

The first three are Mermaid so they render directly in GitHub and Markdown viewers. The dependency graph is Graphviz DOT because file-level dependency graphs become dense quickly.

These are generated from the current CodeGraph-indexed repository and then curated into a human-sized view. CodeGraph is the source for symbols/call paths; the diagrams are views, not a replacement for the index.

Current index receipt: 316 files, 6,781 nodes, 24,038 edges, index up to date on 2026-07-20.
