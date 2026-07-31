---
name: workflow-mining-to-skills
description: Mine accessible Codex, ChatGPT, repo, memory, transcript, or project history to identify repeated workflows and create or update skills. Use when asked to review prior threads/sessions, workflow-mine, author skills from repeated work, deduplicate skills, or decide what belongs in skills versus AGENTS/scripts/automations. Do not use when creating a single user-specified skill without history analysis.
---

# Workflow Mining To Skills

## Purpose

Turn real repeated behavior into a small number of useful skills or durable instructions. Do not fabricate patterns from missing history, and do not create skills from one-off tasks.

## Required Inputs

- Accessible historical sources or a clear statement that none are available.
- Existing skill directories and durable instruction files.
- Permission to edit the appropriate skill location.

## Source Discovery

Search broadly before editing. Inspect likely sources such as:

- `.agents/skills/`, `.codex/skills/`, and other installed skill folders.
- `AGENTS.md`, README, project docs, prompt libraries, issue/PR templates, planning docs.
- Codex session indexes, archived sessions, rollout summaries, memory registries, logs, scratchpads, and exported conversations.
- Repo history and task artifacts when the workflow is repo-specific.

If no real historical sources are available, stop after discovery and report exactly what exports or files are needed.

## Workflow

1. Inventory sources.
   - List directories/files inspected and note unavailable sources.
   - Sample raw transcripts plus curated summaries when both exist.
   - Treat memory as routing context, not proof for current live/project state.

2. Inventory existing coverage.
   - Read existing relevant `SKILL.md` files, local/global `AGENTS.md`, docs, scripts, prompts, and automation/tool configs.
   - Detect duplicates and near-duplicates before proposing anything new.

3. Cluster repeated workflows.
   - Group by job-to-be-done, not by project name.
   - For each family capture: repeated action, why it matters, evidence, recurrence strength, pain points, inputs, outputs, existing coverage, priority, and confidence.

4. Choose the right artifact.
   - Skill: repeatable method with clear triggers, inputs, outputs, and nontrivial steps.
   - AGENTS.md: broad always-on behavior, repo conventions, validation commands, durable preferences.
   - Script: deterministic conversion, validation, extraction, generation, migration, formatting, or batch work.
   - Automation: stable scheduled or event-driven workflow after the method is proven.
   - MCP/tooling: repeated need for live external state or authorized app actions.
   - No action: weak evidence, one-off task, already covered, or too project-specific for global reuse.

5. Create or update conservatively.
   - If an existing skill covers at least 70 percent of the workflow, improve it instead of creating a duplicate.
   - If variants share one method, create one focused skill with variant notes.
   - Prefer instruction-only skills until a helper script would materially reduce errors.
   - Use trigger-focused frontmatter descriptions optimized for implicit invocation.
   - For operational loops, encode the workflow contract, not just advice: scope, gates, commands, evidence, stop rules, output shape, permissions, and closeout state.

6. Validate and report.
   - Run available skill validators or manually check frontmatter, naming, focus, and overlap.
   - Report sources, workflow matrix, created/updated files, intentionally skipped skills, recommended scripts/automations, and missing history.

## Operational Skill Design

Use this design pass when a mined workflow is a real execution loop such as triage, review, release, incident response, multi-agent coordination, or account/provider operations.

- Separate roles when the workflow has layers: a control-plane skill coordinates, delegates, monitors, and asks decisions; worker skills execute repository or surface-specific work. State who may create workers, steer them, mutate public state, and close work.
- Split permissions explicitly: read/triage, local implementation, push, CI rerun/fix, comment, close, merge, release, publish, account action, and destructive cleanup. Do not let one permission imply another unless the skill says so.
- Define gates as first-class requirements: clean worktree, current branch, latest remote state, comments read, owner comments authoritative, reproducible root cause, tests, live proof, CI, review, release readiness, and final clean checkout.
- Make evidence boundaries visible. Say what counts as proof, what is only a hint, and what blocks completion. For live/provider/UI work, require real authenticated or visual proof when the workflow depends on it, or ask for an explicit waiver/access step.
- Use concrete command ladders for fragile operations. Start with preferred tools, then fallback commands. Keep commands copy-pasteable and avoid broad destructive actions.
- Require output schemas for recurring reports. Good schemas force URL/ref, what changed, fit, risk, trust/context, proof, blocker, next action, residual risk, and skipped scope.
- Use decision briefs instead of vague escalation. Before asking the owner, refresh state and include the canonical URL, plain-language change, completed proof, why the decision is needed now, tradeoffs, recommendation, and exact choices.
- Preserve bounded autonomy. Define which items are safe to process without more input, which require owner/product/security/access judgment, and when the agent should keep going versus stop.
- Put helper scripts in `scripts/` only when they produce repeatable evidence or remove quoting/API hazards. Keep the script narrow and referenced from the skill with an expected output shape.
- Keep bespoke local details only when they are operationally necessary. If names, paths, accounts, private tools, or owner-specific rules are included, mark whether they are routing policy, proof requirements, or replaceable examples.
- Prefer one dense skill over scattered prompts when the workflow needs persistent state, gates, and permission boundaries. Prefer slash/prompt templates for simple one-shot command sequences.

## Skill Quality Signals To Replicate

When updating or creating an operational skill, check whether it has the specific qualities that make strong maintainer skills work:

- Strong opening contract: the first paragraph says exactly when to use the skill, what default scope applies, and what the output must accomplish. Avoid vague "help with X" framing.
- Scope with escape hatches: define the default narrow scope, the words or conditions that broaden it, and what must never be included unless explicitly named.
- Fast pass plus authority pass: use a broad/cheap tool for discovery, then switch to authoritative commands, source files, logs, rows, or comments before recommending action.
- Source-of-truth hierarchy: state which evidence overrides what, such as owner comments over labels, current source over stale issue text, or live proof over mocks.
- Classification before action: separate queue analysis, candidate selection, implementation, push, merge, close, and release. A summary should not silently authorize mutation.
- Bounded autonomy: define `go`, `ask first`, and `stop` cases. Include examples tied to risk, proof, product direction, credentials, and blast radius.
- Exact stop rules: say what condition halts work and what the agent must report, including branch/status, blocker, proof already gathered, and next decision.
- Decision-ready escalation: require the agent to prepare the work up to the last safe boundary before asking the owner. The owner question should be a concrete choice, not "please review".
- Output schema: include a short report template with fields that force useful evidence, such as URL/ref, what, fit, risk, proof, blocker, next action, skipped scope, and residual risk.
- Closeout state: define what "done" means in filesystem, branch, CI, live proof, public comment, release, or deployment terms.
- Helper-script discipline: include scripts only for repeatable evidence, fragile API calls, quoting hazards, or deterministic transformations. State fallback behavior when the helper is absent.
- Bespoke detail with purpose: keep local names, tools, paths, accounts, and people only when they change routing, permissions, proof, or safety. Otherwise convert them into placeholders or examples.

## Workflow Matrix Fields

Use these fields for each repeated workflow:

- Workflow name
- What we repeatedly do
- Why it matters
- Evidence from prior sessions or files
- Recurrence strength
- Pain points or failure modes
- Usual inputs
- Expected outputs
- Existing coverage
- Recommendation
- Priority
- Confidence

## Common Mistakes

- Creating many shallow skills from project names instead of reusable methods.
- Burying global operating preferences inside a task-specific skill.
- Duplicating an existing skill because its description was vague instead of improving it.
- Treating inaccessible private conversation history as reviewed.
- Creating a skill when a small script would be the reliable artifact.

## Good Trigger Prompts

- "Review my prior Codex sessions and create skills for repeated workflows."
- "Mine our work history and improve the skill library."
- "Decide what belongs in skills versus AGENTS.md or scripts."
- "Find duplicate or incomplete skills and clean up coverage."
