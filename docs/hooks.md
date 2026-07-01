# Codex Hook Adapter

SkillMap supports a passive Codex `UserPromptSubmit` hook. The hook runs the local CLI and injects a compact skill-routing hint before the user prompt reaches the model.

## Safety model

The hook path is deterministic:

```text
Codex UserPromptSubmit JSON -> skillmap route --hook -> compact text hint
```

It does not:

- call an LLM
- call the network
- execute skill scripts
- rewrite the user prompt
- block prompts
- install itself without an explicit command

## Dry-run first

```bash
skillmap hook dry-run codex "make this UI less generic"
skillmap hook install codex --passive --dry-run
```

The install dry-run reports the target `hooks.json`, backup path, and exact command that would be inserted.

## Install targets

Default target:

```text
<current-project>/.codex/hooks.json
```

Global target:

```bash
skillmap hook install codex --passive --global
```

Custom target for tests:

```bash
skillmap hook install codex --passive --config /tmp/hooks.json
```

## Trust requirement

Codex requires non-managed command hooks to be reviewed and trusted before they run. After installing, open `/hooks` in Codex and review the SkillMap hook definition.

## Rollback

Every install or uninstall of an existing hook file writes a timestamped backup next to the target file.

```bash
skillmap hook uninstall codex
```

## Failure behavior

If no confident skill is found, hook mode emits no additional context. If `.skillmap/effective.json` is missing, SkillMap falls back to inventory plus `.skillmap/policy.yml` when available.
