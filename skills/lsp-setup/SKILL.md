---
name: lsp-setup
description: Use when a coding task needs language-server diagnostics, goto/reference/rename support, project-aware static analysis, or post-edit diagnostics beyond ordinary tests, especially in typed or multi-file repositories.
---

# LSP Setup

Use this skill to make language-server diagnostics available and useful for the current task. The goal is targeted project-aware feedback, not generic tool installation.

## When To Use

Use this skill when:

- A repo has typed source and diagnostics would catch real mistakes.
- Implementation touched multiple files and type/lint output is too coarse.
- A validation failure needs symbol-aware navigation or diagnostics.
- The user asks to set up, fix, or use LSP.
- A review/checkpoint needs more confidence in edited files.

Skip this skill when:

- The task is a tiny edit and repo-native tests/typecheck already cover it.
- The project has no practical language-server support.
- Setup would require global installs or network-heavy work that the user did not authorize.

## Workflow

1. Detect the project language/ecosystem:
   - TypeScript/JavaScript, Python, Go, Rust, Swift, Ruby, Java, etc.
   - package manager, lockfile, workspace root, config files, and existing scripts.
2. Prefer existing repo tooling:
   - package scripts, local binaries, editor config, existing language server config, typecheck/lint commands.
3. Verify availability:
   - check whether the language server or equivalent diagnostics command is already installed locally.
   - avoid global installs unless the user explicitly wants setup and the risk is clear.
4. Run targeted diagnostics:
   - edited files first when supported.
   - project diagnostics when file-level diagnostics are unreliable.
5. If LSP is unavailable, use the repo's closest validation path:
   - `tsc --noEmit`, `vue-tsc`, `svelte-check`, `ruff`, `mypy`, `pyright`, `go test`, `cargo check`, `swift build`, or project-native equivalents.
6. Report what was verified and what remains unverified.

## Installation Policy

Default to no new installs.

Safe without asking:

- Using already-installed repo-local binaries.
- Running existing package scripts.
- Reading config files.

Ask or explain before:

- Installing global language servers.
- Modifying editor config.
- Changing project dependencies.
- Running network-heavy package manager commands.

## Diagnostics Standard

Good diagnostics output should include:

- workspace root,
- language/tool used,
- files checked,
- command or MCP/tool used,
- errors/warnings relevant to the task,
- whether diagnostics are complete or partial,
- fallback used if LSP was unavailable.

## Guardrails

- Do not treat "no diagnostics tool found" as a pass.
- Do not ignore project-native typecheck/lint scripts in favor of invented commands.
- Do not leave watchers, language-server processes, or temp config files running without a cleanup receipt.
- Do not claim live/browser/runtime behavior from static diagnostics.

## Closeout

```text
LSP/diagnostics:
- Workspace:
- Tool/command:
- Scope:
- Result:
- Fallback:
- Cleanup:
```
