# SkillMap

SkillMap is a local-first SkillOps CLI for people with too many agent skills. It scans installed skill trees with qualified identity, doctors the library for ambiguity and risk, prepares native-agent curation, applies reversible policy with canonical duplicate decisions, builds/query-explains a SkillGraph, routes prompts to the best skills, tracks external skill provenance, and can optionally install a passive Codex route-hint hook.

The repository now also contains a locally validated hosted trust-alpha candidate: a Supabase-backed public catalog, version-bound evidence contracts, GitHub OAuth integration points, free saved-skill accounts, exact-commit submissions, a public-only inert audit worker, provisional grading, operator review/publication RPCs, account export/deletion, and metadata-only catalog publication. These paths are tested against local Supabase. Any remote alpha state must be proven by an exact-commit deployment receipt in the implementation ledger; this README does not claim public release or production readiness.

**Start here:** [PROJECT_STATUS.md](https://github.com/0x3-team/skillmap/blob/main/PROJECT_STATUS.md) is the concise map of the
canonical source, active MCP candidate, checkpoint/archive tags, deployment
truth, and preserved branch history.

**New to the codebase?** Read the [project map](docs/project-map.md) first. It
keeps the local product, hosted catalog, and production path separate so the
repository is easier to navigate.

| Surface | Current truth |
| --- | --- |
| Canonical source | Moving branch `main`; accepted product-source checkpoint `checkpoint/2026-07-15/product-alpha-source` at `0eb57ac7c3aeda0c907435210a748a5ffb3a259e` |
| Development package | `skillmap@0.1.0`; not published |
| Hosted product | Locally validated source; not provisioned or deployed |
| Official MCP | Candidate `fee340a2e4a86e13421696355fe9480e68285090` in draft [PR #21](https://github.com/0x3-team/skillmap/pull/21); not merged or released |
| Launch | `NO-GO`; no public users, package release, deployment, live OAuth, or indexing is claimed |

Status: experimental source alpha moving toward v1. The current development
build is useful for local inventory, doctoring, native-agent policy curation,
route-quality dogfooding, source provenance experiments, and controlled Codex
hook dry-runs. It does not mutate global skill roots or install Git hooks. The
optional passive Codex route-hint hook is installed only by its explicit install
command. This repository also tracks reviewed project-level Claude and Codex
validation hooks, which supported clients may enable after repository trust.

## Why this exists

Modern coding agents can use skills, hooks, MCP servers, plugins, and project instructions. Once a user has dozens or hundreds of skills, the hard problem becomes governance:

- What skills do I actually have?
- Which skills overlap or duplicate each other?
- Which skills are stale or downloaded from others?
- Which skills are risky because they include scripts?
- Which skill should be preferred for a given request?
- What tiny route hint should the agent see without loading everything?

SkillMap is the local quality layer for that workflow.

## Install

The package is not published from this worktree. For a reviewed local tarball
install on macOS or Linux:

```bash
npm ci
mkdir -p artifacts/package
npm pack --pack-destination artifacts/package
npm install -g ./artifacts/package/skillmap-0.1.0.tgz
skillmap --version
```

On Windows PowerShell:

```powershell
npm ci
New-Item -ItemType Directory -Force .\artifacts\package | Out-Null
npm pack --pack-destination .\artifacts\package
npm install -g .\artifacts\package\skillmap-0.1.0.tgz
skillmap --version
```

Or run from a local checkout:

```bash
npm install
npm run build
node dist/cli.js --help
node dist/cli.js --version
```

Keep the tarball that you installed. Exact update, package rollback, workspace
rollback, hook removal, and uninstall commands are in the
[first-run tutorial](docs/first-run.md#update-package-rollback-workspace-rollback-and-uninstall).

## Quickstart

```bash
skillmap init --root ~/.agents/skills --root ~/.codex/skills --dry-run
skillmap init --root ~/.agents/skills --root ~/.codex/skills
skillmap scan
skillmap status
skillmap doctor
skillmap doctor-pack --summary
skillmap curate codex --prepare
```

Or start the authenticated foreground local application from an initialized workspace:

```bash
skillmap dashboard
```

Open the one-time loopback URL printed by the command. The connector binds only to `127.0.0.1`, serves the versioned local UI and API from one origin, keeps prompts in memory, and stops when the foreground process exits.

Paste `.skillmap/curation/codex-prompt.md` into Codex or Claude and ask the native agent to produce:

- `.skillmap/proposals/policy.yml`
- `.skillmap/proposals/policy-rationale.md`

Then review and ingest:

```bash
skillmap curate codex --ingest .skillmap/proposals/policy.yml --rationale .skillmap/proposals/policy-rationale.md --model codex-sota --confirm
skillmap apply-policy --strict
skillmap status
skillmap graph build
skillmap graph explain "make this dashboard less generic and verify mobile"
skillmap route "make this dashboard less generic and verify mobile" --trace
skillmap eval --file .skillmap/real-evals.json --min-count 150 --min-top1 0.80 --min-top3 0.92 --max-avoid-hits 0 --save-report
```

Case count is not release evidence by itself. Release confidence requires an `eval-suite/v3` document with qualified skill IDs, per-case and dataset provenance, 100 implicit-natural cases, 25 multi-skill cases, 25 negative/near-miss cases, and a frozen holdout of at least 20% and 30 cases. The suite must bind an approval-recorded historical baseline `RevisionRef`; the isolated runner replays the exact frozen cases against both immutable effective registries, recomputes leakage and metrics, and requires top-1 at least 0.80, top-3 at least 0.92, and zero avoid hits. Importing a suite creates an unapproved revision and does not grant release authority. Eval v2, untyped, self-labeling, or description-copy suites remain candidate/demo evidence even when they score 100%.

## Source provenance and updates

Track skills downloaded from external repositories without overwriting local edits:

```bash
skillmap sources adopt writing-great-skills --repo mattpocock/skills --path skills/writing-great-skills
skillmap sources adopt my-local-skill --local --reason "Authored and maintained in this workspace."
skillmap sources list
skillmap sources check
skillmap sources diff writing-great-skills
skillmap sources update writing-great-skills --dry-run
```

`update` is preview-only in personal V1. SkillMap will not overwrite source skill files.

`sources check` reports coverage as `not-configured`, `not-applicable`, `partial`, or `covered` against inventory variants. An empty source registry for a non-empty inventory is `not-configured`, never clean or covered.

## Optional Codex hook

The hook is passive: it only injects a compact route hint from the local effective registry. It does not call an LLM, does not use the network, and does not execute skill scripts.

```bash
skillmap route --hook --prompt "make this dashboard less generic"
skillmap hook dry-run codex "make this dashboard less generic"
skillmap hook install codex --passive --dry-run
```

Hook install checks `skillmap status` first. Only install after readiness is `ready`; `--force` can acknowledge later evidence gates for a controlled test after review, but it cannot bypass exact approved-revision routing.

```bash
skillmap hook install codex --passive
skillmap hook uninstall codex
```

By default, hook install targets the current project at `.codex/hooks.json`. Use `--global` only when you deliberately want `~/.codex/hooks.json`, or `--config PATH` for a controlled test file.

## Core flow

```text
init -> scan -> status -> doctor -> doctor-pack -> curate -> policy migrate/review -> apply-policy -> graph -> sources/eval -> optional passive hook
```

- `init` writes `.skillmap/config.yml` with explicit personal roots and `.skillmap/real-evals.json`.
- `scan` records raw filesystem truth in `.skillmap/inventory.json`.
- `identity status/adopt-move` keeps path/root moves fail-closed with tombstones and revision-bound operator receipts.
- `status` reports a `readinessPhase`, every unresolved duplicate-name group, fixture roots, mismatched policy, stale artifacts, curation receipts, source coverage/freshness, and validated eval evidence.
- `doctor` reports duplicates, missing descriptions, scripts, broad triggers, and other hygiene issues.
- `doctor-pack` creates a bounded Markdown packet for Codex/Claude to curate.
- `curate` records user-confirmed native-agent policy provenance.
- `apply-policy` builds `.skillmap/effective.json` without editing source skills.
- `policy migrate/select-canonical/rollback` keeps the original v1 bytes and skill roots untouched while moving routing to exact skill IDs.
- default `export` is a verified allowlisted safe envelope; raw backup requires the explicit local-sensitive path.
- `graph` builds and explains the SkillGraph from the effective registry.
- `route` recommends skills from the effective graph with traceable reasons.
- `eval` measures route quality against prompt-to-skill cases.
- `sources` tracks external skill provenance and update status.
- `hook` can dry-run, install, or uninstall a passive Codex `UserPromptSubmit` hook with backups.
- `state` migrates legacy files into fsynced immutable revisions and provides explicit status, rollback, recovery, and projection repair.
- `dashboard` starts the capability-authenticated loopback UI for onboarding, live routing, redacted feedback/activity, and allowlisted maintenance jobs.

## Safety defaults

- The local CLI has no cloud dependency; hosted catalog routes fail visibly when Supabase is not configured.
- No hook install unless explicitly requested.
- No deletion of skill files.
- No broad home-folder scan outside configured skill roots.
- Script-bearing skills are flagged, not trusted or executed.
- Route and hook paths do not call an LLM or network service.
- Source update application is preview-only in personal V1.
- Hook installation backs up an existing `hooks.json` before modifying it and requires ready status unless forced.
- Legacy/malformed identity, unadopted moves, unresolved duplicate names, incomplete source coverage, and demo/smoke eval evidence prevent ready status. A blocked hook dry-run reports that it would refuse installation rather than presenting a success-looking install preview.

## Development

```bash
npm ci
npm run typecheck
npm test
npm pack --dry-run
```

The separate hosted/demo web surface lives in `apps/web` and requires Node 22 or newer:

```bash
cd apps/web
npm ci
npm run test:fixtures
npm run typecheck
npm run lint
npm run build
npm run dev
```

Run the real hosted-data spine locally from the repository root:

```bash
supabase start
supabase db reset --local
supabase db lint --local --level warning
supabase test db supabase/tests/hosted_catalog_rls.test.sql --local
```

Copy `apps/web/.env.example` to an ignored local environment file and fill it from `supabase status`. The web application exposes `/skills`, `/api/v1/skills`, GitHub OAuth callback routes, `/submit`, `/account`, `/account/submissions`, saved skills, account export, and self-deletion. Public catalog reads always use the anonymous no-store client; account writes use authenticated RLS. Operator audit, completion, requeue, publication, and lease recovery use separate service-role-only RPCs from `apps/worker`; the browser cannot mint receipts or publication state.

The required Gitea hosted-database lane recreates the database from zero, exercises local application-data backup/reset/replay digest parity, then runs schema lint, the full pgTAP suite, and generated API type parity against the restored candidate. The public API and authenticated save/unsave browser smokes are manually run local acceptance gates against a full disposable Supabase stack and a production Next.js server; they are not currently part of the rootless Gitea runner job. When `test:hosted-auth` runs, its local service-role key is scoped to the test process and is never inherited by the web server.

Before treating a clean commit as a local free-public-alpha candidate, run the exact-candidate preflight and retain its exclusive receipt path:

```bash
mkdir -p /tmp/skillmap-release-evidence
npm run preflight:public-alpha -- \
  --output /tmp/skillmap-release-evidence/exact-candidate.json
```

This command checks the tracked secret boundary plus the root, web, dependency, package, consumer-install, and release-path gates. The separate destructive-explicit recovery command and the browser/live gates remain in the [free public alpha operations runbook](docs/operations/free-public-alpha-runbook.md). The baseline source-integration receipt is already pushed and merged; any later Unreleased candidate requires its own source-integration receipt. A passing local receipt still records `NO_GO` for launch until deployment, live OAuth, encrypted off-host restore, initial-corpus, pilot, indexing, and policy gates are proven.

The Next.js surface supports both the real Supabase catalog/account spine and the clearly labeled fixture dashboard with optional verified redacted local snapshots. The packaged local application is instead served by `skillmap dashboard` from `assets/local-app/v1` and uses the same-origin loopback API for live routes, redacted feedback, approved-root onboarding, state migration/recovery, and allowlisted jobs. Billing, entitlements, team sync, private-source ingestion, package mirroring/loading, remote worker scheduling, and current-letter behavioral grading are not implemented or deployed. Browser-initiated mutation of local skill-root contents remains forbidden.

## Release state

This repository is private while the tool is being dogfooded. Treat the package as alpha until route quality is validated on a real curated policy and non-demo eval suite.

## V1 operator docs

- [Project handoff](HANDOFF.md)
- [Personal V1 runbook](docs/personal-v1-runbook.md)
- [First-run tutorial](docs/first-run.md)
- [Command reference](docs/commands.md)
- [Curation workflow](docs/curation.md)
- [SkillGraph and architecture](docs/architecture.md)
- [Hook usage](docs/hooks.md)
- [Host compatibility](docs/host-compatibility.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Threat model](docs/threat-model.md)
- [Security notes](docs/security.md)
- [Privacy and telemetry decision](docs/telemetry.md)
- [Local alpha support](docs/support.md)
- [UI acceptance matrix](docs/ui-acceptance-matrix.md)
- [Release provenance and approval strategy](docs/release-provenance.md)
- [External onboarding pilot runbook](docs/external-pilot-runbook.md)
- [Free public alpha implementation plan](docs/plans/2026-07-12-skillmap-free-public-launch-implementation-plan.md)
- [Free public alpha operations runbook](docs/operations/free-public-alpha-runbook.md)
- [Public alpha policy draft](docs/launch/public-alpha-policy-pack.md)
- [Go-to-market kit](docs/launch/free-public-alpha-go-to-market.md)
