---
name: skill-audit
description: Audit an Agent Skill for structure, scope, provenance, permissions, and operational risks. Use when deciding whether a skill is ready to catalog, review, or publish.
license: MIT
compatibility: Designed for Agent Skills-compatible hosts; recommendations are evidence, not a safety certification.
metadata:
  author: 0x3-team
  version: "1.0.0"
---

# Skill Audit

Audit the exact skill version supplied by the user. Do not infer safety, ownership, or compatibility from a repository name, star count, or publisher badge.

## Workflow

1. Record the source repository, immutable commit, source path, and files in scope.
2. Validate `SKILL.md` frontmatter and inventory references, assets, scripts, binaries, and declared tools.
3. Separate publisher-declared facts from detected facts and reviewer conclusions.
4. Check license and attribution evidence per skill path and version. Treat unclear redistribution rights as metadata-only.
5. Identify path, archive, secret, prompt-injection, permission, network, and execution risks without running bundled scripts.
6. Report findings with severity, evidence location, confidence, and a concrete remediation or disposition.
7. End with one of: ready for deeper evaluation, needs remediation, metadata-only, quarantined, or blocked.

## Boundaries

- Never execute skill scripts as part of the audit.
- Never call a version safe merely because automated checks pass.
- Never expose private paths, credentials, raw prompts, or detailed private findings in a public summary.

