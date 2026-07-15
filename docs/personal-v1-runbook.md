# Personal V1 Runbook

This runbook is the operator path for proving SkillMap personal V1 from a
current checkout. It supports V1-13, V1-14, and V1-15 from the readiness plan:
real-root dogfood, personal V1 docs, and the final evidence packet.

Do not use this runbook to claim public release, npm publication, global hook
install, or hosted dashboard readiness. The parent reviewer accepts or rejects
the final evidence packet.

## Evidence States

Use these exact labels in the evidence index:

| Label | Meaning |
| --- | --- |
| `validated locally` | A local command passed in this checkout and its output path or transcript is recorded. |
| `browser verified` | A real running browser route was inspected with the URL, viewport, and screenshot path recorded. |
| `package dry-run only` | `npm pack --dry-run` or `npm publish --dry-run` passed, but nothing was published. |
| `not published` | No npm publish, GitHub tag, or GitHub release was performed. |
| `not globally hooked` | No `--global` hook install was performed; hook proof used dry-run, project-local, or temporary config only. |
| `blocked` | A gate did not pass; include the command, exit state, and why no stronger claim is made. |

## Evidence Location

Use a local evidence folder:

```text
.skillmap/reports/personal-v1/
```

Start from the template:

```text
.skillmap/reports/personal-v1/evidence-index.md
```

Keep local evidence local. Do not publish raw `.skillmap` artifacts, raw skill
bodies, raw prompt sets, local absolute paths, hook secrets, or screenshots that
show unrelated private data.

## 1. Baseline

Record repo state before dogfood. Do not clean unrelated user work.

```bash
git status --short --branch
npm ci
npm run typecheck
npm test
```

For package evidence, dry-run only:

```bash
npm pack --dry-run
```

Record this as `package dry-run only`, not published.

## 2. Real-Root Dogfood

Use the real personal roots selected for this machine. The default personal V1
roots are:

```bash
node dist/cli.js init --root ~/.agents/skills --root ~/.codex/skills --json
node dist/cli.js scan --json
node dist/cli.js status --json
node dist/cli.js doctor --json
node dist/cli.js doctor --fix-plan
node dist/cli.js doctor-pack --summary --json
```

Record:

- configured roots
- roots scanned
- readiness phase
- total skills
- invalid frontmatter count
- script-bearing skill count
- duplicate-name groups
- doctor finding count
- doctor-pack summary path and byte size

If roots are missing or intentionally excluded, record the reason and mark the
affected gate `blocked` or `validated locally` only for the subset actually
checked.

## 3. Curation And Policy

Prepare a bounded curation packet:

```bash
node dist/cli.js curate codex --prepare --json
```

Use the native agent to produce:

```text
.skillmap/proposals/policy.yml
.skillmap/proposals/policy-rationale.md
```

Then ingest and build the effective registry:

```bash
node dist/cli.js curate codex --ingest .skillmap/proposals/policy.yml --rationale .skillmap/proposals/policy-rationale.md --model MODEL --dry-run --json
node dist/cli.js curate codex --ingest .skillmap/proposals/policy.yml --rationale .skillmap/proposals/policy-rationale.md --model MODEL --confirm --json
node dist/cli.js apply-policy --strict --json
node dist/cli.js graph build --json
node dist/cli.js status --json
```

Replace `MODEL` with the reviewed native-agent model. Record it as user-reported
unless provider verification exists.

Open the local Policies view after migration. It must show uncovered skills as
blocking rather than reporting an empty queue. For each item, create a proposal,
review the bound revision/digest, and choose accept, hold, or reject. A hold is
an intentional recorded non-resolution; it does not make readiness green.
After the queue is resolved, run the real policy dry-run and use **Apply reviewed
policy** as a separate approval step.

## 4. Source And Eval Gates

Classify every approved inventory variant explicitly, then check external source
state. Local-authored classifications require a reviewed reason; GitHub sources
require a repository, subtree, and ref. Use qualified IDs when display names are
ambiguous:

```bash
node dist/cli.js sources list --json
node dist/cli.js sources adopt --skill-id sk_ID --local --reason "Authored and maintained in this workspace." --json
node dist/cli.js sources adopt --skill-id sk_OTHER_ID --repo OWNER/REPOSITORY --path skills/example --ref main --json
node dist/cli.js sources check --json
node dist/cli.js apply-policy --strict --json
node dist/cli.js graph build --json
node dist/cli.js status --json
```

Review or hold non-clean source states before claiming readiness. Source updates
remain preview-only in personal V1.

Run real evals:

```bash
node dist/cli.js eval --file .skillmap/real-evals.json --min-count 150 --min-top1 0.80 --min-top3 0.92 --max-avoid-hits 0 --save-report --json
node dist/cli.js status --json
```

`.skillmap/real-evals.json` must be an `eval-suite/v3` authority with qualified
IDs, per-case provenance, canonical digests, and an approval-recorded
historical baseline revision. Import it as an unapproved revision, approve the
intended current routing state, and then run the isolated replay. Fixture or
eval-v2 output does not count toward personal V1 readiness.

## 5. Route Evidence

Capture at least one representative trace:

```bash
node dist/cli.js route "make this dashboard less generic and verify mobile" --trace --json
node dist/cli.js route --hook --prompt "make this dashboard less generic and verify mobile" --json
node dist/cli.js hook dry-run codex "make this dashboard less generic and verify mobile" --json
```

Record whether the route included conservative exclusions, whether hook text was
empty, and whether the hook output stayed compact.

## 6. Controlled Hook Smoke

Use a temporary hooks file. Do not use `--global` for personal V1 evidence.

Create the temporary file with one unrelated existing hook:

```bash
printf '%s\n' '{"hooks":{"UserPromptSubmit":[{"hooks":[{"type":"command","command":"printf existing-hook","timeout":1}]}]}}' > /tmp/skillmap-hooks.json
```

After readiness is acceptable, run:

```bash
node dist/cli.js hook install codex --passive --config /tmp/skillmap-hooks.json --dry-run --json
node dist/cli.js hook install codex --passive --config /tmp/skillmap-hooks.json --json
node dist/cli.js hook uninstall codex --config /tmp/skillmap-hooks.json --json
```

Record:

- install target is `/tmp/skillmap-hooks.json`
- no `--global` command was run
- unrelated existing hook remains after install
- SkillMap hook is removed after uninstall
- backup path exists when the target existed
- `/hooks` manual trust remains required for real Codex usage

If status is not ready, `hook install` should block unless `--force` is used.
Using `--force` against a temporary config can test merge/rollback mechanics, but
it does not prove readiness.

## 7. MCP Smoke

MCP is read-only in personal V1. Run these after `.skillmap/effective.json`,
`.skillmap/doctor.json`, and source status exist:

```bash
node dist/cli.js mcp manifest --json
node dist/cli.js mcp call route_prompt --prompt "make this dashboard less generic" --json
node dist/cli.js mcp call search_skills --query frontend --json
node dist/cli.js mcp call show_skill --skill-id "$SKILL_ID" --json
node dist/cli.js mcp call doctor_summary --json
node dist/cli.js mcp call source_status --json
```

Use the exact qualified ID returned by search. For protocol evidence, run the official SDK client against the real built child process:

```bash
npm run test:mcp:stdio
```

Record the test result and confirm the six fixed tools, string server version, revision receipts, structured/text equality, prompt-free route event, bounded frames, and clean close/reconnect behavior.

## 8. Browser Evidence

Start the packaged local application from the operator workspace and record the
actual one-time loopback URL and port:

```bash
node dist/cli.js dashboard
```

Complete onboarding, policy preview/apply, source review, eval review/import,
two live Route Lab prompts, structured feedback, Activity, revision history,
and a clean foreground shutdown. Record the current revision before and after
each mutation; do not treat fixture data as personal readiness.

The automated embedded-app evidence ladder is:

```bash
npm run test:cross-browser
npm run test:a11y
npm run test:visual
npm run test:perf
```

Record screenshots for:

- 1440x1000
- 1024x768
- 390x844
- 320x740

The separate `apps/web` Next.js surface is a public/docs and explicitly labeled
fixture/snapshot mirror. Its build is required, but it is not the live personal
workspace application and cannot substitute for the loopback workflow above.

## 9. Final Evidence Packet

Fill the evidence index and include:

- baseline git state
- exact commands run
- command output paths or transcripts
- final `status --json`
- eval report summary
- source state summary
- route trace summary
- hook smoke summary
- MCP transcript summary
- browser URL and screenshots if included
- package dry-run contents if run
- cleanup performed

The final claim must state:

- validated locally: yes/no, with evidence path
- browser verified: yes/no, with evidence path
- package dry-run only: yes/no
- not published: yes
- not globally hooked: yes
