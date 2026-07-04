# Dogfood Workflow

Use this workflow before calling a SkillMap build stable alpha.

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
./node_modules/.bin/skillmap status
```

Record:

- roots scanned
- total skills
- fixture/project/user/plugin root types
- invalid frontmatter
- script-bearing skills
- duplicate-name groups
- doctor findings
- doctor-pack byte size
- status warnings

## Native-agent curation

Prepare the Codex prompt first:

```bash
skillmap curate codex --prepare
```

Open `.skillmap/curation/codex-prompt.md` and `.skillmap/doctor-pack.summary.md` in Codex. Ask Codex to produce:

- `.skillmap/proposals/policy.yml`
- `.skillmap/proposals/policy-rationale.md`

Review and ingest before applying:

```bash
skillmap curate codex --ingest .skillmap/proposals/policy.yml --rationale .skillmap/proposals/policy-rationale.md --model "codex-sota" --dry-run
skillmap curate codex --ingest .skillmap/proposals/policy.yml --rationale .skillmap/proposals/policy-rationale.md --model "codex-sota" --confirm
skillmap apply-policy --policy .skillmap/policy.yml --dry-run
skillmap apply-policy --policy .skillmap/policy.yml
skillmap status
```

## Route evals

Create `.skillmap/real-evals.json` with 25-40 real prompts. Then run:

```bash
skillmap eval --file .skillmap/real-evals.json --min-count 25 --save-report
skillmap status
```

Stable-alpha thresholds:

- top-1 expected hit rate at least 75%
- top-3 expected hit rate at least 90%
- avoid hits equal 0
- confidence is `release`

A tiny eval suite can pass mechanically but still be only `demo` or `weak` confidence.
