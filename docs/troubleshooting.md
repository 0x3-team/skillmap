# Troubleshooting

## Status says fixture roots are present

You scanned test fixtures. Re-run scan against real roots only:

```bash
skillmap scan --root ~/.agents/skills --root ~/.codex/skills
```

Use `--fixtures` only for tests.

## Missing curation receipt

Run:

```bash
skillmap curate codex --prepare
skillmap curate codex --ingest .skillmap/proposals/policy.yml --rationale .skillmap/proposals/policy-rationale.md --model codex-gpt-5 --confirm
```

## Unmatched policy entries

A policy key does not match the current inventory. Re-run scan, review `.skillmap/policy.yml`, then run:

```bash
skillmap apply-policy --strict
```

## Stale effective registry or SkillGraph

Run:

```bash
skillmap apply-policy --strict
skillmap graph build
```

## Source update conflicts

Use diff first:

```bash
skillmap sources diff <skill>
skillmap sources update <skill> --dry-run
skillmap sources review <skill> --decision hold --reason "Reviewed current upstream state."
```

`sources update` is preview-only in personal V1. It cannot overwrite a skill, even with `--confirm`. Use `diff` and `review` to record a manual decision.

## Hook install is blocked

Run:

```bash
skillmap status
```

Hook install requires status `ok` and readiness phase `ready`. For a controlled temporary hook test, `--force` can acknowledge later evidence warnings after review, but it still requires an exact approved routing revision and cannot turn stale or unapproved state into routing authority.

## GitHub source checks return 429

GitHub raw rate-limited the check. Re-run later or use authenticated/manual source review. SkillMap reports this as `unknown` rather than pretending freshness is known.

## Hook output is missing or too broad

Run the route directly:

```bash
skillmap route --trace "your prompt"
skillmap hook dry-run codex "your prompt"
```

If route quality is weak, refine policy aliases/preferred_for and re-run eval.

## npm cache ownership errors

If npm reports root-owned files in `~/.npm`, use a temporary cache for validation:

```bash
npm --cache /private/tmp/skillmap-npm-cache pack --dry-run
```
