# Security Policy

SkillMap scans local agent-skill metadata and writes local `.skillmap` artifacts. It should not execute skill scripts or install hooks unless the user explicitly invokes those future commands.

## Supported versions

The project is in private alpha. Security fixes apply to the current `main` branch.

## Reporting a vulnerability

While the repository is private, report issues directly to the repository owner. Do not include secrets, private skill bodies, token values, or private filesystem dumps in reports.

## Security model

SkillMap treats third-party skills as untrusted metadata until reviewed.

Risk indicators flagged by the doctor include:

- executable scripts
- malformed or recovered frontmatter
- duplicate skill names
- broad invocation descriptions
- oversized skill bodies

## Non-goals in alpha

- SkillMap does not prove a skill is safe.
- SkillMap does not sandbox external scripts.
- SkillMap does not validate every possible prompt-injection path.
- SkillMap does not upload skill content to a cloud service.
