# Dogfood Workflow

Use this workflow before calling a SkillMap build stable alpha or v1-ready.

## Clean install

```bash
npm pack
tmpdir=$(mktemp -d /tmp/skillmap-consumer-XXXXXX)
cd "$tmpdir"
npm init -y
npm install /path/to/skillmap-0.1.0.tgz
./node_modules/.bin/skillmap --help
```

## Real-root scan

```bash
./node_modules/.bin/skillmap scan --json
./node_modules/.bin/skillmap status --json
./node_modules/.bin/skillmap doctor --json
./node_modules/.bin/skillmap doctor-pack --summary --json
```

Record roots scanned, total skills, invalid frontmatter, script-bearing skills, duplicate-name groups, doctor findings, status warnings, and doctor-pack byte size.

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
skillmap sources check
skillmap status
```

Do not apply external updates during dogfood unless a dedicated update-safety pass has reviewed the diff.

## Route evals

Create `.skillmap/real-evals.json` with at least 25 real prompts for alpha and at least 150 for v1 release. Then run:

```bash
skillmap eval --file .skillmap/real-evals.json --save-report
```

Stable-alpha thresholds:

- top-1 expected hit rate at least 75%
- top-3 expected hit rate at least 90%
- avoid hits equal 0

V1 target:

- at least 150 evals
- top-1 expected hit rate at least 80%
- top-3 expected hit rate at least 92%
- avoid hits equal 0 for blocked/high-risk skills
