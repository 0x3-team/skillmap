# Delegate Prompt Contract

Use this contract when constructing the prompt sent to Cline.

## Required Fields

- Project: repo path, branch, route/product surface, app run command when known.
- Plan slice: the exact task delegated from Codex or planning-orchestrator.
- Mode: `implement`, `audit`, `design-pass`, `plan-critique`, or `review`.
- Context: relevant local instructions, design system notes, screenshots, image paths, local URLs, browser observations, and acceptance criteria.
- Allowed files/areas: narrow paths or surfaces.
- Exclusions: files, workflows, generated artifacts, secrets, deployments, databases, and commands Cline must not touch.
- Verification: focused checks Cline may run and how it should report them.
- Final output label: require one of `implementation`, `audit`, `design alternatives`, `review`, or `plan critique`.

## Required Cline Instructions

```text
You are a child specialist. Codex is the project owner and final verifier.
Stay within the delegated slice.
Read local repo instructions before editing.
Do not commit, push, deploy, publish, inspect secrets, edit credentials, or run destructive commands.
Do not broaden scope without saying what is blocked.
For GLM 5.2 runs, operate at maximum reasoning.
Report changed files, design rationale, checks run, unresolved risks, and anything Codex must verify.
```

## Implementation Prompt Skeleton

```text
Mode: implement
Repo: <repo>
Plan slice: <slice>
Product surface: <route/url/screenshots>
Acceptance criteria: <criteria>
Allowed files: <paths>
Forbidden moves: no commits, pushes, deployments, secrets, broad rewrites, destructive commands.
Verification to run if feasible: <commands>

Implement the slice only. Preserve existing patterns and design system. End with:
- Output label: implementation
- Changed files
- Design rationale
- Checks run and result
- Integration assumptions
- Risks/blockers
```

## Audit Prompt Skeleton

```text
Mode: audit
Repo/surface: <repo/route/screenshots>
Question: <audit question>
Acceptance criteria: <criteria>
Do not edit files unless explicitly asked.

Return:
- Output label: audit
- Findings ordered by severity
- Concrete file/route references
- Recommended changes
- Uncertainty or missing evidence
```

