---
name: create-hook
description: Codex hook authoring. Use when the user asks to create, update, audit, or verify Codex lifecycle hooks in global ~/.codex or project .codex scope, including hook scripts, hooks.json, matcher behavior, trust review, and smoke verification.
---

# Create Hook

Use this skill when the user wants Codex lifecycle hooks created, updated, audited, or verified. Keep the loop tight: inspect current hook state first, write the smallest deterministic hook, validate it locally, and call out any trust or live-trigger step that remains.

## Ground Rules

- Start read-only. Inspect existing hook sources before changing files.
- Treat hooks as behavior-changing automation. Blocking, rewriting, approval, prompt-shaping, or continuation hooks require explicit user intent.
- Prefer `hooks.json` for new hook config. If a layer already uses inline `[hooks]` in `config.toml`, preserve that representation instead of mixing formats unless the user asks to migrate.
- Use the current feature key: `[features] hooks = true`. Do not add `codex_hooks`; it is deprecated. Do not add any feature flag when hooks are already enabled or unspecified.
- Keep hook scripts deterministic, fast, and dependency-light. Default to Python stdlib, JSON stdin parsing, explicit timeout, and no network calls.
- Never log secrets, raw credentials, private keys, tokens, full prompts, raw transcripts, or unredacted tool payloads unless the user explicitly asks for a narrow local log and the script redacts sensitive values.
- Do not install watchers, cron jobs, daemons, background agents, or model calls inside hook runtime.

## Workflow

1. Audit the target.
   - Run `python3 <skill>/scripts/audit_hooks.py --scope global` for global hooks.
   - Run `python3 <skill>/scripts/audit_hooks.py --scope project --repo <repo-root>` for project hooks.
   - Read any reported `hooks.json`, inline `[hooks]`, hook script folder, and feature flag state.
   - Completion criterion: you know the active layer, existing hook representation, whether hooks are disabled, and whether a same-event or same-script hook already exists.

2. Determine scope.
   - If the user says `global`, use `~/.codex`.
   - If the user says `project`, resolve the repository root with `git rev-parse --show-toplevel` and use `<repo>/.codex`.
   - If scope is missing and the behavior is personal across repos, default to global only if that is clearly implied.
   - If scope is still ambiguous, ask: `Should this be global or project-scoped?`

3. Determine event and matcher.
   - If the event is missing or unclear, ask which hook event they want.
   - Supported events: `SessionStart`, `SubagentStart`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, `SubagentStop`, `Stop`.
   - Ask for a matcher only for events that honor matchers: `SessionStart`, `SubagentStart`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `SubagentStop`.
   - Do not ask for a matcher for `UserPromptSubmit` or `Stop`; Codex ignores matchers for those events.
   - If the user wants multiple events, keep them as separate matcher groups and scripts unless shared code clearly reduces duplication.

4. Determine behavior and risk.
   - Logging or context-only hooks: proceed after behavior is clear.
   - Blocking or denial hooks: confirm the exact deny condition and message.
   - `PermissionRequest` hooks: confirm whether the hook can allow, deny, or only log approval requests.
   - Rewriting hooks with `updatedInput`: confirm the exact rewrite and keep it narrow.
   - `Stop` or `SubagentStop` continuation hooks: confirm the stopping condition so they cannot create a noisy loop.
   - Completion criterion: the trigger, allowed side effects, output contract, and failure mode are explicit.

5. Write the hook config and script.
   - Global config path: `~/.codex/hooks.json`; scripts under `~/.codex/hooks/`.
   - Project config path: `<repo>/.codex/hooks.json`; scripts under `<repo>/.codex/hooks/`.
   - Use an explicit command path. For project hooks, prefer git-root resolution:
     `/usr/bin/python3 "$(git rev-parse --show-toplevel)/.codex/hooks/<script>.py"`.
   - For global hooks, prefer an absolute home path:
     `/usr/bin/python3 "$HOME/.codex/hooks/<script>.py"`.
   - Set `timeout` explicitly; use `10` seconds for simple log/context hooks and `30` seconds for validation hooks unless the user requests otherwise.
   - Use `statusMessage` only for short visible signals like `Checking Bash command` or `Recording hook event`.

6. Use the correct output contract.
   - Read `references/hook-contracts.md` before writing event-specific output.
   - For `PreToolUse` denial, prefer `hookSpecificOutput.permissionDecision = "deny"` with `permissionDecisionReason`.
   - For `PermissionRequest`, use `hookSpecificOutput.decision.behavior` with `allow` or `deny`.
   - For `UserPromptSubmit`, plain stdout or `hookSpecificOutput.additionalContext` becomes developer context.
   - For `Stop`, `decision: "block"` means "continue the turn with this reason", not "reject the final answer".

7. Validate locally.
   - Compile Python scripts with `python3 -m py_compile <script>`.
   - Parse `hooks.json` with `python3 -m json.tool <hooks.json>`.
   - Run the hook script with a minimal sample JSON payload for the chosen event.
   - Re-run the audit script and confirm the expected hook appears.
   - If project-scoped, confirm the repo is trusted or say that project hooks will not load until the project layer is trusted.

8. Verify Codex trust and runtime behavior.
   - Non-managed hooks must be reviewed and trusted in `/hooks`; changed hook definitions get a new hash.
   - Do not claim live hook execution until a trusted hook has actually fired.
   - If live triggering is not possible in the current session, close with: standalone validation passed, Codex trust/live trigger still pending.

## Practical Defaults

- Use `PreToolUse` for prevention before supported tool calls.
- Use `PermissionRequest` for approval-policy automation around escalation requests.
- Use `PostToolUse` for logging, review notes, formatting hints, or follow-up checks after supported tools.
- Use `UserPromptSubmit` for prompt shaping or context injection.
- Use `SessionStart` for startup context.
- Use `PreCompact` and `PostCompact` for compacting workflows.
- Use `Stop` only for narrow end-of-turn continuation checks.

## Closeout

Report these states explicitly:

- Scope and paths changed.
- Event, matcher, script command, and timeout.
- Validation performed.
- Whether Codex trust review is still required.
- Whether behavior was validated live or only standalone.
