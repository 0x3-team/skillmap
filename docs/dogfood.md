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
./node_modules/.bin/skillmap doctor --json
./node_modules/.bin/skillmap doctor-pack --summary --json
./node_modules/.bin/skillmap doctor-pack --max-skills 120 --json
```

Record:

- roots scanned
- total skills
- invalid frontmatter
- script-bearing skills
- duplicate-name groups
- doctor findings
- doctor-pack byte size

## Native-agent curation

Open `.skillmap/doctor-pack.summary.md` first. Ask Codex or Claude to produce:

- `.skillmap/policy.yml`
- `.skillmap/policy-rationale.md`

Review before applying:

```bash
skillmap apply-policy --policy .skillmap/policy.yml --dry-run
skillmap apply-policy --policy .skillmap/policy.yml
```

## Route evals

Create `.skillmap/real-evals.json` with 25-40 real prompts. Then run:

```bash
skillmap eval --file .skillmap/real-evals.json
```

Stable-alpha thresholds:

- top-1 expected hit rate at least 75%
- top-3 expected hit rate at least 90%
- avoid hits equal 0
