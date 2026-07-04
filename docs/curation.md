# Native-Agent Curation

SkillMap deliberately separates high-judgment curation from deterministic runtime routing.

Use Codex or Claude for:

- duplicate resolution
- family classification
- risky script-bearing review
- canonical default selection
- policy rationale
- eval prompt suggestions
- description rewrite proposals

Use SkillMap for:

- scanning local files
- status checks
- policy validation
- effective graph generation
- route/eval execution
- passive hook output

## Codex workflow

```bash
skillmap scan
skillmap status
skillmap doctor
skillmap doctor-pack --summary
skillmap curate codex --prepare
```

Open these files in Codex:

```text
.skillmap/curation/codex-prompt.md
.skillmap/doctor-pack.summary.md
```

Ask Codex to create:

```text
.skillmap/proposals/policy.yml
.skillmap/proposals/policy-rationale.md
```

Then ingest:

```bash
skillmap curate codex --ingest .skillmap/proposals/policy.yml --rationale .skillmap/proposals/policy-rationale.md --model "codex-sota" --dry-run
skillmap curate codex --ingest .skillmap/proposals/policy.yml --rationale .skillmap/proposals/policy-rationale.md --model "codex-sota" --confirm
```

## Provenance limits

`--model` is user-reported. SkillMap records it as provenance, but does not verify provider identity unless a future provider integration is added. The runtime route and hook path never call an LLM.
