# Cline Feature Selection

Use the smallest Cline surface that helps the delegated slice.

## Defaults

- Use `--json` for supervised runs.
- Use `--timeout` on every run.
- Use `--thinking xhigh` for GLM 5.2.
- Use `-P cline -m zai/glm-5.2` only when the task specifically calls for GLM 5.2 or the benchmark router selects it.
- Use `--plan` for read-only second opinions.
- Use implementation worktrees for write-scoped tasks.
- Use audit-only/read-only mode for critiques and design reviews.

## Optional Features

- `--data-dir` or `--config`: isolate state when a run should not touch default Cline settings.
- `--hooks-dir` or command permissions: restrict commands for implementation passes.
- Cline rules/skills: include relevant installed instructions in the prompt.
- Screenshots/images/local URLs: use for UI/UX audits and image-to-code.
- Cline history export: preserve evidence for substantial runs.
- Kanban: use only for multi-slice UI/UX work where board tracking helps.
- `--zen`, hub, scheduler, connectors: use only for explicit long-running/background workflows.
- Plugins/MCP: use only when they directly help and the source/permissions are trusted.

## Avoid

- Do not install or enable broad plugins/MCP/connectors just because they are available.
- Do not delegate live production mutations to Cline.
- Do not run Cline in the main dirty worktree for non-trivial implementation.
- Do not rely on Cline's reported verification without Codex verification.

