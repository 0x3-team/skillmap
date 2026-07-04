# Commands

## `skillmap init`

Creates starter `.skillmap` files. Use `--dry-run` first.

## `skillmap scan`

Scans configured skill roots and writes `.skillmap/inventory.json`.

Default roots:

- `~/.agents/skills`
- `~/.codex/skills`
- `~/.claude/skills`
- project-local `.agents/skills`
- project-local `.codex/skills`
- project-local `.claude/skills`

Useful flags:

```bash
skillmap scan --root ~/.agents/skills --json
skillmap scan --fixtures test/fixtures/basic --json
```

## `skillmap status`

Summarizes the active SkillMap state and warns about unsafe or misleading states.

```bash
skillmap status
skillmap status --json
```

It reports inventory roots, fixture/project/user root types, policy matches, unmatched policy entries, effective-registry staleness, curation provenance, and eval confidence.

## `skillmap doctor`

Analyzes the current inventory and writes doctor reports under `.skillmap`.

```bash
skillmap doctor
skillmap doctor --json
```

## `skillmap doctor-pack`

Creates a native-agent curation packet for Codex or Claude.

```bash
skillmap doctor-pack
skillmap doctor-pack --summary
skillmap doctor-pack --max-skills 80
```

The pack includes a recommended curation prompt, duplicate groups, script-bearing skills, high-priority findings, and a policy skeleton. `--summary` omits the full catalog for large skill libraries.

## `skillmap curate`

Prepares and records manual native-agent curation. This keeps the expensive judgment step in Codex/Claude and keeps runtime routing deterministic.

```bash
skillmap curate codex --prepare
skillmap curate codex --ingest .skillmap/proposals/policy.yml --rationale .skillmap/proposals/policy-rationale.md --model "codex-sota" --dry-run
skillmap curate codex --ingest .skillmap/proposals/policy.yml --rationale .skillmap/proposals/policy-rationale.md --model "codex-sota" --confirm
```

`--model` is user-reported unless a future provider integration verifies it. SkillMap records this honestly in `.skillmap/curation/receipt.json`.

## `skillmap apply-policy`

Applies a reviewed policy to create an effective registry and graph. It does not edit source skills.

```bash
skillmap apply-policy --policy .skillmap/policy.yml --dry-run
skillmap apply-policy --policy .skillmap/policy.yml
skillmap apply-policy --policy .skillmap/policy.yml --strict
```

Default mode warns about fixture roots and unmatched policy entries. `--strict` fails on those problems unless fixture warnings are explicitly allowed with `--allow-fixtures`.

## `skillmap graph`

Renders raw or effective graph data.

```bash
skillmap graph
skillmap graph --effective
```

## `skillmap route`

Routes a prompt against the effective registry and emits traceable recommendations.

```bash
skillmap route "review this PR for auth bugs" --trace
skillmap route --hook --prompt "review this PR for auth bugs"
```

`--hook` emits compact text suitable for Codex `UserPromptSubmit` additional context. It reads the Codex hook JSON event from stdin when no `--prompt` is provided. Hook mode intentionally suppresses status warning chatter so it remains compact.

## `skillmap eval`

Runs prompt-to-skill route evals from a JSON eval file.

```bash
skillmap eval --file .skillmap/real-evals.json
skillmap eval --file .skillmap/real-evals.json --min-count 25 --save-report
skillmap eval --file .skillmap/real-evals.json --json
```

The command reports top-1 rate, top-3 rate, avoid hits, pass status, warnings, and confidence. Fewer than 5 evals is demo confidence. The stable-alpha target is 25-40 real prompts.

## `skillmap hook`

Dry-runs or manages a passive Codex hook.

```bash
skillmap hook dry-run codex "make this UI less generic"
skillmap hook install codex --passive --dry-run
skillmap hook install codex --passive
skillmap hook uninstall codex --dry-run
skillmap hook uninstall codex
```

Defaults to project-local `.codex/hooks.json`. Use `--global` for `~/.codex/hooks.json` only after deliberate review. Use `--config PATH` for a controlled config file.
