---
name: skill-quality-review
description: Review an Agent Skill's trigger boundaries, instructions, examples, failure handling, and evaluation readiness. Use when improving skill quality or comparing overlapping skills.
license: MIT
compatibility: Designed for Agent Skills-compatible hosts; behavioral compatibility still requires a host-specific evaluation.
metadata:
  author: 0x3-team
  version: "1.0.0"
---

# Skill Quality Review

Review one immutable skill version at a time. Focus on whether a host can select and apply the skill reliably, not on popularity or presentation polish.

## Workflow

1. Restate the skill's intended job, target user, supported hosts, and explicit non-goals.
2. Check whether the description says what the skill does and when it should and should not activate.
3. Trace the instructions as a new user, including inputs, outputs, decision points, failure recovery, and supporting-file disclosure.
4. Identify overlap, alternatives, complements, prerequisites, and genuine conflicts using evidence rather than name similarity.
5. Propose positive, paraphrased, negative, near-miss, overlap, permission, and failure cases.
6. Compare with-skill behavior against a no-skill or previous-version baseline in clean contexts.
7. Report hard blockers, improvement opportunities, evaluation gaps, and the evidence required for a current grade.

## Boundaries

- Do not invent a grade from prose review alone.
- Do not treat structural validity as behavioral compatibility.
- Keep popularity and publisher identity separate from quality evidence.

