# Cline Stewardship

Codex owns Cline as a managed capability.

## Pre-Use Checklist

```bash
command -v cline
cline --version
cline update --verbose
cline skill list
cline skill list -g
```

Record Cline version, update status, project skills, global skills, and selected skill/plugin usage in the provenance receipt.

## Skill Handling

- Prefer installed trusted skills under `~/.agents/skills` and `~/.codex/skills`.
- Use `cline skill list` for project skills and `cline skill list -g` for global skills.
- If a relevant installed skill exists, mention it in the Cline prompt.
- If a useful trusted skill is missing, install with:

```bash
cline skill add <owner/repo> --agent cline
cline skill add <owner/repo> -g --agent cline
npx skills add <owner/repo> --agent cline
```

Verify after install:

```bash
cline skill list
cline skill list -g
```

## Trust Boundary

Do not install community skills/plugins/MCP/connectors that request broad local, browser, network, repo, credential, deployment, or database access unless the user explicitly authorizes that risk for the current task.

Never print raw Cline config files or secrets.

