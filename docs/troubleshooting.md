# Troubleshooting

## Status says fixture roots are present

You scanned test fixtures. Re-run scan against real roots only:

```bash
skillmap scan
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
```

Risky updates require `--allow-risky` after manual review. Local modifications are not overwritten automatically.

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
