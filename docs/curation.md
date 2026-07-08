# Native-Agent Curation

SkillMap keeps runtime routing deterministic. Use Codex or Claude for offline semantic judgment, not every-prompt routing.

## Flow

```bash
skillmap scan
skillmap doctor
skillmap doctor-pack --summary
skillmap curate codex --prepare
```

Paste `.skillmap/curation/codex-prompt.md` into a native Codex or Claude chat. Ask it to return:

- `.skillmap/proposals/policy.yml`
- `.skillmap/proposals/policy-rationale.md`

Then ingest:

```bash
skillmap curate codex --ingest .skillmap/proposals/policy.yml --rationale .skillmap/proposals/policy-rationale.md --model codex-sota --confirm
skillmap apply-policy --strict
skillmap status
```

## Provenance limit

SkillMap records the host, user-reported model label, input artifact hashes, output artifact hashes, and timestamp. It does not verify provider-side model identity unless a future provider integration is added.
