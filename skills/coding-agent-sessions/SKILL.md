---
name: coding-agent-sessions
description: Use when asked to inspect, reconstruct, audit, compare, or summarize prior coding-agent work across Codex, Claude, OpenCode, or local session logs, including token usage, subagents, tool calls, archived rollouts, disconnected work, or questions about what happened since a specified time.
---

# Coding Agent Sessions

Use this skill to answer questions about what coding agents actually did. The job is evidence reconstruction, not memory-based storytelling.

Start read-only. Treat session files, SQLite state, rollout JSONL, tool-call records, and current local files as evidence. Treat memory summaries, chat recollection, and browser continuity as routing context only.

## When To Use

Use this skill when the user asks:

- What happened in a Codex/Claude/OpenCode/session/thread.
- Whether a prior agent completed, skipped, or overclaimed work.
- Why token usage increased or quality changed.
- Which tools, skills, subagents, hooks, MCPs, or commands were used.
- To resume, audit, compare, or reconcile disconnected/stale work.
- To find session IDs, rollout paths, timestamps, token-count events, or final answers.

Skip this skill for normal repo implementation, simple command history, or fresh tasks with no prior-session dependency.

## Source Hierarchy

Prefer evidence in this order:

1. Current filesystem/config/repo state.
2. Raw session or rollout logs, including JSONL events and tool outputs.
3. Local state databases or session indexes.
4. Agent final answers and user-visible summaries.
5. Memory summaries or prior chat summaries as pointers only.

Do not present memory-derived claims as proof. If evidence is missing, say what could not be inspected.

## Discovery Workflow

1. Anchor the question:
   - requested time window, repo/path, thread/session ID, agent type, tool, skill, or behavior under review.
   - current workspace path and whether the user wants a broad or bounded audit.
2. Search likely local sources with bounded queries:
   - Codex session/rollout JSONL files.
   - Codex state SQLite files and session indexes.
   - archived sessions and rollout summaries.
   - project-local `outputs/`, `work/`, plans, ledgers, logs, or scratch artifacts.
   - Claude/OpenCode session stores when the user names those tools or the local setup indicates them.
3. Use exact filters when possible:
   - session ID, date, path suffix, thread title, repo path, command name, tool name, skill name, or token-count event.
4. Inspect raw records before concluding:
   - `session_meta` for path, model, timestamp, and source.
   - `event_msg` for progress, token counts, task completion, and errors.
   - `response_item` for assistant messages, tool calls, tool outputs, and final answers.
   - subagent events or child-thread references when present.
5. Reconcile claims against current state:
   - a session saying "done" is not proof that files/config/live state still match.
   - verify drift-prone facts from current files, dashboards, commands, or runtime evidence.

## Token And Quality Audits

When analyzing token usage or quality:

- Count comparable windows, not isolated anecdotes.
- Separate parent-thread tokens, subagent tokens, tool-output volume, hook output, docs/search output, and repeated validation loops when the data allows it.
- Record medians or bounded samples when full coverage would be wasteful.
- Distinguish "more tokens" from "worse outcome"; quality needs evidence such as missed validation, wrong source truth, overbroad edits, or unsupported claims.
- Note whether a skill/hook/tool was actually invoked, merely installed, or only visible in config.

## Output Shape

Use a compact evidence-led report:

```text
Session Audit:
- Scope:
- Sources inspected:
- Time/session IDs:
- What happened:
- Tool/skill/subagent usage:
- Token evidence:
- Quality evidence:
- Current-state verification:
- Gaps/blockers:
- Verdict:
```

Include exact session IDs, file paths, commands, timestamps, and counts when they matter. Summarize large logs; do not dump full private transcripts unless the user explicitly asks and it is necessary.

## Guardrails

- Do not mutate session logs, state databases, memory, or archived sessions.
- Do not broad-scan private history when a bounded query can answer the question.
- Do not expose secrets, auth headers, private customer data, or full transcripts unnecessarily.
- Do not treat hook output, setup banners, or final answers as proof of current repo/runtime state.
- Do not create visible threads for hidden scratch work.
- If a scan would be very large, sample first and state what the sample can and cannot prove.

## Closeout

State whether the conclusion is:

- `confirmed from raw session evidence`
- `confirmed from current filesystem/runtime evidence`
- `inferred from partial evidence`
- `blocked by missing logs/access`

When the task affects future workflow, include one or two concrete changes that would prevent the same failure or preserve the useful behavior.
