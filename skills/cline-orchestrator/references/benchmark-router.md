# Benchmark Router

Use benchmark evidence to decide whether Cline should be invoked for a task class.

## Cache Policy

- Store routing state at `~/.codex/cline-orchestrator/benchmark-router.json`.
- Treat data as stale after seven days.
- Refresh before delegating a new task class, before changing preferred models, or when the user asks for the current best model.

## Current Default

Use Cline/GLM 5.2 primarily for:

- UI/UX design
- visual implementation
- design critique
- design audit
- image-to-code
- plan critique for visual/product surfaces

Keep Codex as default for general repo implementation unless fresh evidence says a Cline-accessible model is materially better.

## Source Classes

- UI/UX, web design, visual implementation: Design Arena, WebDev Arena, Design Arena notes.
- Coding and repo tasks: SWE-bench Verified, Terminal-Bench, public coding-agent leaderboards, official model/provider release notes.
- Browser/product-operation tasks: browser-use or web-agent benchmarks only when they match the actual workflow.

## Routing Rule

Delegate to Cline only when both are true:

- A Cline-accessible model is materially stronger than Codex for the task class.
- Codex can safely supervise, review, incorporate, and verify the output.

If evidence is stale, missing, or ambiguous, Codex does the work and may ask Cline for a narrow critique.

