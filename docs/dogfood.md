# Dogfood Workflow

Use this workflow before calling a SkillMap build stable alpha or v1-ready.

## Clean install

```bash
repo_root=$(pwd)
npm pack
tmpdir=$(mktemp -d /tmp/skillmap-consumer-XXXXXX)
cd "$tmpdir"
npm init -y
npm install /path/to/skillmap-0.1.0.tgz
./node_modules/.bin/skillmap --help
```

## Real-root scan

```bash
./node_modules/.bin/skillmap init --root ~/.agents/skills --root ~/.codex/skills --json
./node_modules/.bin/skillmap scan --json
./node_modules/.bin/skillmap status --json
./node_modules/.bin/skillmap doctor --json
./node_modules/.bin/skillmap doctor-pack --summary --json
```

Record configured roots, roots scanned, readiness phase, total skills, invalid frontmatter, script-bearing skills, duplicate-name groups, doctor findings, status warnings, and doctor-pack byte size.

## Native-agent curation

```bash
skillmap curate codex --prepare
```

Open `.skillmap/curation/codex-prompt.md` in Codex or Claude. Ask it to produce:

- `.skillmap/proposals/policy.yml`
- `.skillmap/proposals/policy-rationale.md`

Review and ingest:

```bash
skillmap curate codex --ingest .skillmap/proposals/policy.yml --rationale .skillmap/proposals/policy-rationale.md --model codex-sota --confirm
skillmap apply-policy --policy .skillmap/policy.yml --strict
skillmap status
```

## SkillGraph

```bash
skillmap graph build
skillmap graph explain "make this dashboard less generic and verify mobile"
skillmap graph duplicates
skillmap graph conflicts
```

## Source provenance

```bash
skillmap sources list
skillmap sources adopt writing-great-skills --repo mattpocock/skills --path skills/writing-great-skills
skillmap sources adopt my-local-skill --local --reason "Authored and maintained in this workspace."
skillmap sources check
skillmap status
```

Do not apply external updates during dogfood unless a dedicated update-safety pass has reviewed the diff.

## Route evals

Create an `eval-suite/v3` `.skillmap/real-evals.json` with qualified skill IDs, complete dataset and per-case provenance, canonical digests, and an approval-recorded historical baseline `RevisionRef`. Every case must have one `primaryCaseType` and a `train` or frozen `holdout` membership. Review/import it in the local app or with the CLI, explicitly approve the intended current routing revision, then run:

```bash
skillmap eval --file .skillmap/real-evals.json --min-count 150 --min-top1 0.80 --min-top3 0.92 --max-avoid-hits 0 --save-report
```

Release-counted composition and evidence:

- at least 100 implicit-natural cases
- at least 25 multi-skill cases, each with two or more expected skills
- at least 25 negative/near-miss cases with explicit expected/avoid semantics
- at least 20% and never fewer than 30 frozen holdout cases
- no expected display-name, exact-alias, or copied-description leakage in implicit/multi prompts
- complete author/reviewer/source/time/deduplication/holdout provenance, including per-case label receipts
- canonical frozen-case, dataset, payload, exact-effective, and semantic-effective digests still match
- the selected historical baseline has a durable routing-approval receipt and predates the current approved revision
- deterministic replay of the same frozen cases against both immutable effective registries proves non-regression and an approved improvement; a perfect baseline requires advisory-size improvement without a safety regression
- top-1 expected hit rate at least 80%, top-3 at least 92%, and avoid hits equal 0 on credible release-counted evidence

Explicit cases remain useful regressions but are excluded from release top-1/top-3 scoring. Eval v2, fixture, untyped, self-labeling, synthetic-provenance, or description-copy suites remain candidate/demo evidence even at 150 cases and 100% apparent accuracy. Import success alone never approves routing or release evidence.

## Evidence packet

For personal V1, save a human-readable evidence index under:

```text
.skillmap/reports/personal-v1/evidence-index.md
```

Use the evidence states from [Personal V1 Runbook](personal-v1-runbook.md):

- `validated locally`
- `browser verified`
- `package dry-run only`
- `not published`
- `not globally hooked`
- `blocked`

The evidence packet must distinguish package dry-run from publication. A passing
`npm pack --dry-run` or `npm publish --dry-run` is not an npm publish, GitHub
tag, or GitHub release.

## Hook and MCP smoke

Hook evidence must use a temporary or project-local hooks file. Do not use
`--global` for personal V1 evidence.

```bash
printf '%s\n' '{"hooks":{"UserPromptSubmit":[{"hooks":[{"type":"command","command":"printf existing-hook","timeout":1}]}]}}' > /tmp/skillmap-hooks.json
skillmap hook install codex --passive --config /tmp/skillmap-hooks.json --dry-run --json
skillmap hook install codex --passive --config /tmp/skillmap-hooks.json --json
skillmap hook uninstall codex --config /tmp/skillmap-hooks.json --json
```

MCP evidence must show read-only tools:

```bash
skillmap mcp manifest --json
skillmap mcp call route_prompt --prompt "make this dashboard less generic" --json
skillmap mcp call search_skills --query frontend --json
SKILL_ID='<qualified-skill-id-from-search_skills>'
skillmap mcp call show_skill --skill-id "$SKILL_ID" --json
skillmap mcp call doctor_summary --json
skillmap mcp call source_status --json
npm --prefix "$repo_root" run test:mcp:stdio
```

Replace the `SKILL_ID` placeholder with a qualified ID returned by `search_skills`; display names are not accepted as identity. The stdio test uses the official SDK client and covers initialize, initialized notification handling, list, all six calls, close, reconnect, concurrency isolation, and the 64 KiB frame limit.
