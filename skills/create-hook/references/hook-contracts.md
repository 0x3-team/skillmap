# Codex Hook Contracts

This reference summarizes current Codex hook behavior for authoring hook scripts. Use the official Codex Hooks docs as the release source when behavior seems to have changed.

## Loading And Trust

- Hooks are enabled by default. Use `[features] hooks = false` only to disable them.
- `hooks` is the canonical feature key. `codex_hooks` is a deprecated alias.
- Codex loads hooks from active config layers as `hooks.json` or inline `[hooks]` tables in `config.toml`.
- Useful locations: `~/.codex/hooks.json`, `~/.codex/config.toml`, `<repo>/.codex/hooks.json`, `<repo>/.codex/config.toml`.
- If a single layer has both `hooks.json` and inline `[hooks]`, Codex loads both and warns. Prefer one representation per layer.
- Project-local hooks load only when the project `.codex/` layer is trusted.
- Non-managed command hooks must be reviewed and trusted through `/hooks`. Trust is tied to the hook definition hash.
- Matching hooks from multiple files all run. Multiple matching command hooks for the same event are launched concurrently.

## Supported Handler Shape

Only `type: "command"` handlers run today. `prompt` and `agent` handlers are parsed but skipped. `async: true` is parsed but skipped.

Common handler fields:

```json
{
  "type": "command",
  "command": "/usr/bin/python3 \"$(git rev-parse --show-toplevel)/.codex/hooks/example.py\"",
  "timeout": 30,
  "statusMessage": "Checking command"
}
```

`timeout` is in seconds. If omitted, Codex uses `600` seconds.

## Matcher Behavior

Use `"*"`, `""`, or omit `matcher` to match every supported occurrence.

| Event | Matcher filters |
| --- | --- |
| `SessionStart` | `source`: `startup`, `resume`, `clear`, `compact` |
| `SubagentStart` | `agent_type` |
| `PreToolUse` | `tool_name`; supports `Bash`, `apply_patch`, `Edit`, `Write`, and MCP tool names |
| `PermissionRequest` | `tool_name`; supports `Bash`, `apply_patch`, `Edit`, `Write`, and MCP tool names |
| `PostToolUse` | `tool_name`; supports `Bash`, `apply_patch`, `Edit`, `Write`, and MCP tool names |
| `PreCompact` | `trigger`: `manual`, `auto` |
| `PostCompact` | `trigger`: `manual`, `auto` |
| `UserPromptSubmit` | not supported; matcher is ignored |
| `SubagentStop` | `agent_type` |
| `Stop` | not supported; matcher is ignored |

## Common Input Fields

Every command hook receives one JSON object on stdin.

Common fields include:

- `session_id`
- `transcript_path`
- `cwd`
- `hook_event_name`
- `model`
- `turn_id` for turn-scoped hooks
- `permission_mode` for `SessionStart`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `UserPromptSubmit`, `SubagentStart`, `SubagentStop`, and `Stop`

Do not treat `transcript_path` format as stable.

## Event Output Notes

### SessionStart

Plain stdout is added as developer context. JSON can return:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "Load repository conventions before editing."
  }
}
```

### PreToolUse

Intercepts supported Bash, `apply_patch`, and MCP calls, but it is a guardrail rather than a complete enforcement boundary. It does not intercept all shell paths or web search.

Plain stdout is ignored.

To deny a supported tool call:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Destructive command blocked by hook."
  }
}
```

To add context without blocking:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "additionalContext": "The pending command touches generated files."
  }
}
```

To rewrite a supported call:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "updatedInput": {
      "command": "echo rewritten"
    }
  }
}
```

Only return `updatedInput` with `permissionDecision: "allow"`.

### PermissionRequest

Runs when Codex is about to ask for approval. It can allow, deny, or decline to decide.

Allow:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "allow"
    }
  }
}
```

Deny:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "deny",
      "message": "Blocked by repository policy."
    }
  }
}
```

If multiple hooks decide, any deny wins.

### PostToolUse

Runs after supported tools produce output, including non-zero Bash exits. It cannot undo side effects.

Plain stdout is ignored. JSON can include `systemMessage`, `continue: false`, and `stopReason`.

### UserPromptSubmit

Plain stdout is added as developer context. JSON can return:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "Ask for a clearer reproduction before editing files."
  }
}
```

To block the prompt:

```json
{
  "decision": "block",
  "reason": "Ask for confirmation before doing that."
}
```

Exit code `2` with a reason on stderr also blocks.

### Stop

`Stop` expects JSON on stdout when it exits `0`; plain text output is invalid.

To keep Codex going:

```json
{
  "decision": "block",
  "reason": "Run one more pass over the failing tests."
}
```

For `Stop`, `decision: "block"` does not reject the turn. It creates a continuation prompt using `reason`.

### SubagentStart And SubagentStop

`SubagentStart` can add context for the subagent. `continue: false` does not stop the subagent from starting.

`SubagentStop` expects JSON on stdout when it exits `0`. To continue the subagent flow, return `decision: "block"` with a reason.

### PreCompact And PostCompact

`PreCompact` runs before compaction and can stop compaction with `continue: false`.

`PostCompact` runs after compaction and can stop the flow with `continue: false`.
