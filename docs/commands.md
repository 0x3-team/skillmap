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

## `skillmap doctor`

Analyzes the current inventory and writes doctor reports under `.skillmap`.

## `skillmap doctor-pack`

Creates `.skillmap/doctor-pack.md` for native Codex or Claude curation.

## `skillmap apply-policy`

Applies a reviewed policy to create an effective registry and graph. It does not edit source skills.

## `skillmap route`

Routes a prompt against the effective registry and emits traceable recommendations.

## `skillmap eval`

Runs prompt-to-skill route evals from a JSON eval file.
