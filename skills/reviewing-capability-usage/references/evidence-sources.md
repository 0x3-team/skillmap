# Evidence Sources

Use the strongest available evidence for the requested review window.

## Preferred Sources

- local skill files and metadata
- implementation, planning, audit, and research artifacts
- RED/GREEN pressure reports
- tool outputs visible in the current thread
- worker/subagent prompts and final reports when available
- rollout summaries or memory entries, with stale and partial caveats
- git status, diffs, commits, and file timestamps when relevant
- browser screenshots, logs, network traces, or background-browser receipts when browser behavior is in scope
- user-supplied transcripts, named thread exports, or exact chat evidence

## Evidence Rules

- memory is routing context
- memory is not proof
- chat recap is not proof unless the reviewed claim is only about what was said
- local artifacts do not prove live, deployed, authenticated, or browser behavior
- mentioning a skill does not prove the skill was read or followed
- spawning a worker does not prove the worker improved quality
- passing static validation does not prove behavioral usefulness
- browser was used only if target, session/surface, evidence, and blocked checks are available
- unavailable transcript/tool logs mean coverage is partial

## State Labels

Use explicit labels:

- `validated locally`
- `browser checked`
- `verified live`
- `pushed`
- `deployed`
- `blocked`
- `not checked`
- `memory-derived`
- `inferred`
- `unverifiable from available evidence`

## Coverage Boundary Template

```markdown
Evidence boundary:
- Window:
- Sources inspected:
- Sources unavailable:
- Memory use:
- Local/browser/live/deploy limits:
- What this review can prove:
- What this review cannot prove:
```

## Capability Decision Template

```markdown
| Capability | Used? | Fit | Evidence | Outcome | Issue | Recommendation |
| --- | --- | --- | --- | --- | --- | --- |
```

## Blocker Handling

If evidence is missing, do not fill the gap with confidence. Mark the check as blocked or partial and say the exact source needed next: transcript export, rollout summary, browser receipt, tool output, git diff, live URL, auth access, or user confirmation.

