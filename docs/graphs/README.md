# SkillMap maps

Start with [the project map](../project-map.md), then open the diagram that answers the question you actually have. Each diagram stays deliberately small; none tries to explain the whole repository at once.

| Question | Diagram |
| --- | --- |
| What are the two products and how do they relate? | [`project-orientation.mmd`](project-orientation.mmd) |
| What must happen before a public release? | [`production-path.mmd`](production-path.mmd) |
| What happens when SkillMap routes a local prompt? | [`local-routing-sequence.mmd`](local-routing-sequence.mmd) |
| How does a hosted submission become public metadata? | [`hosted-submission-authority.mmd`](hosted-submission-authority.mmd) |
| Which source areas depend on which? | [`module-dependencies.dot`](module-dependencies.dot) |
| Where do local and hosted responsibilities stop? | [`system-boundaries.mmd`](system-boundaries.mmd) |

The Mermaid files render in GitHub and Markdown viewers. The DOT file is the intentionally lower-level view for maintainers; it is not the recommended starting point.

These diagrams are curated from checked-in source and tests. They are not generated artifacts, and they remain intentionally maintained independent of any local CodeGraph index status or receipt state.
