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

The install dry-run reports the target `hooks.json`, backup path, exact command that would be inserted, and readiness verdict. When readiness is not green it returns `blocked: true`, `wouldInstall: false`, and `changed: false`, and says it would refuse installation.

## Readiness preflight

`skillmap hook install codex --passive` reads `skillmap status` first. It writes nothing unless status is `ok` and `readinessPhase` is `ready`. Unresolved duplicate names, incomplete source coverage, legacy/demo eval evidence, or stale eval digests therefore block installation.

If you are testing against a temporary hooks file or deliberately overriding after manual review, pass `--force`:

```bash
skillmap hook install codex --passive --config /tmp/hooks.json --force
```

Force is an explicit operator override for later evidence gates: the result keeps `readiness.allowed: false` and reports `forced: true`; it does not make the workspace ready and cannot bypass the exact approved-revision routing boundary.

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

## Controlled smoke checklist

Use a temporary hooks file when producing personal V1 evidence. Do not use
`--global`.

```bash
printf '%s\n' '{"hooks":{"UserPromptSubmit":[{"hooks":[{"type":"command","command":"printf existing-hook","timeout":1}]}]}}' > /tmp/skillmap-hooks.json
skillmap hook install codex --passive --config /tmp/skillmap-hooks.json --dry-run --json
skillmap hook install codex --passive --config /tmp/skillmap-hooks.json --json
skillmap hook uninstall codex --config /tmp/skillmap-hooks.json --json
```

The evidence should show that the unrelated existing hook remains after install,
only the SkillMap hook is removed after uninstall, and the final claim is
`not globally hooked`.

## Failure behavior

If no confident skill is found, hook mode emits no additional context. If `.skillmap/effective.json` is missing, SkillMap falls back to inventory plus `.skillmap/policy.yml` when available.
