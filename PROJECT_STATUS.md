# SkillMap Project Status

Last reconciled against the local repository and GitHub on 2026-07-16 UTC.
This is the shortest source-of-truth map for maintainers and reviewers.

## Current truth

| Surface | Current state |
| --- | --- |
| Canonical source | `main` at `0eb57ac7c3aeda0c907435210a748a5ffb3a259e` |
| Accepted product boundary | Product candidate `33e66c4175676355c275db091eb876bae81e29cf`, squash merge `72ce471f378db36dfeb4faa31ec52c05e2e57654`, receipt descendant `0eb57ac7c3aeda0c907435210a748a5ffb3a259e` |
| Development package | `skillmap@0.1.0`; not published to npm and not represented by a semantic-version release tag |
| Hosted catalog and web | Source-integrated and locally validated; not provisioned, deployed, or verified live |
| Official MCP continuation | Candidate `fee340a2e4a86e13421696355fe9480e68285090` in draft [PR #21](https://github.com/0x3-team/skillmap/pull/21); locally validated, not merged or released |
| GitHub CI for PR #21 | Infrastructure-blocked before execution by the account billing/spending allowance; the failed jobs ran zero steps, so they are not code-test failures or acceptance evidence |
| Launch | `NO-GO`: no public deployment, open signup, npm release, live OAuth, public indexing, or public-user cohort is claimed |

## Start here

- [README](README.md) for the product, local quickstart, and safety model.
- [Architecture](docs/architecture.md) for the local runtime, SkillGraph, routing,
  connector, hosted boundary, and MCP shape.
- [Handoff](HANDOFF.md) for accepted product evidence and the operational backlog.
- [Changelog](CHANGELOG.md) for implemented product slices and their evidence scope.
- [MCP foundation plan](docs/plans/2026-07-15-skillmap-mcp-transport-discovery-foundation-implementation-plan.md)
  and the [candidate implementation ledger](https://github.com/0x3-team/skillmap/blob/fee340a2e4a86e13421696355fe9480e68285090/docs/plans/2026-07-15-skillmap-mcp-transport-discovery-foundation-implementation-plan-implementation-ledger.jsonl)
  for the active MCP continuation.
- [Private production rehearsal plan](docs/plans/2026-07-15-skillmap-private-production-rehearsal-implementation-plan.md)
  for the unimplemented Vercel, Supabase, and Cloudflare rehearsal path.
- [Release provenance](docs/release-provenance.md) for the package, tag, approval,
  and publication boundary.

## Source tags and version policy

The repository uses annotated source tags without pretending they are product
releases:

| Tag | Commit | Meaning |
| --- | --- | --- |
| `checkpoint/2026-07-08/personal-v1-candidate` | `2709937347cb4f556ceb0c123306f6db3df8f8af` | Historical personal-V1 source checkpoint |
| `checkpoint/2026-07-15/product-alpha-source` | `0eb57ac7c3aeda0c907435210a748a5ffb3a259e` | Latest accepted product-alpha source and receipt boundary |
| `candidate/2026-07-16/mcp-foundation` | `fee340a2e4a86e13421696355fe9480e68285090` | Active, locally validated, unmerged MCP candidate |
| `archive/local-heads/2026-07-16/hosted-library-foundation` | `c19ca669c177663a6e12d6fa042518e68e7c9c1b` | Exact superseded local head, including the previously uncommitted plans and safe project-tool configuration |
| `archive/local-heads/2026-07-16/hosted-library-foundation-review` | `999b44d7076ba25607c033154053ae2eafdca55a` | Exact superseded review lineage |

`checkpoint/*` identifies an accepted or historically useful source boundary.
`candidate/*` identifies a reviewed but unaccepted continuation. `archive/*`
exists only for recovery and archaeology; archive commits must not be merged or
treated as current. A future `vX.Y.Z[-prerelease]` tag is reserved for an
explicitly approved exact package release. There is intentionally no
`v0.1.0` tag or GitHub Release today.

## Complete local-head preservation map

GitHub retains merged pull-request source heads under `refs/pull/<number>/head`,
even after their normal feature branches are deleted. The audit compared local
heads with canonical branches and those advertised PR refs. Every local code
head was already on GitHub except the two lineages now covered by `archive/*`
tags.

| Local head | Exact GitHub preservation | State |
| --- | --- | --- |
| `main` at `a468324` | Ancestor of canonical `origin/main` | Stale local pointer; do not use as canonical |
| `codex/product-application` at `6f78c9f` | PR #1 head | Merged/superseded |
| `codex/organization-migration` at `61e24ac` | PR #3 head | Merged/superseded |
| `codex/stabilize-visual-diagnostics` at `e00bb86` | PR #4 head | Merged/superseded |
| `codex/hosted-library-seed-anchor` at `6e80296` | PR #5 head | Merged/superseded |
| `codex/ci-baseline-stability` at `8299f1e` | PR #6 head | Merged/superseded |
| `codex/hosted-library-foundation-pr` at `00e29a4` | PR #7 head | Merged/superseded |
| `codex/hosted-phase1-closeout` at `759572b` | PR #8 head | Merged/superseded |
| `codex/hosted-phase1-a11y-followup` at `1427e27` | PR #9 head | Merged/superseded |
| `codex/hosted-phase1-terminal-receipt` at `6876169` | PR #10 head | Merged/superseded |
| `codex/free-public-alpha-integration` at `6712929` | PR #11 head | Merged/superseded |
| `codex/operator-read-plane-release-truth` at `69e7d1e` | PR #12 head | Merged/superseded |
| `codex/operator-read-plane-release-ledger` at `5bbf2ce` | PR #13 head | Merged/superseded |
| `codex/launch-readiness-closeout` at `e6fc09e` | PR #14 head | Merged/superseded |
| `codex/completion-audit` at `918a501` | PR #15 head | Merged/superseded |
| `codex/completion-audit-receipt` at `4305132` | PR #16 head | Merged/superseded |
| `codex/launch-readiness-finalize` at `413d875` | PR #17 head | Merged/superseded |
| `codex/launch-readiness-receipt` at `db2d8ae` | PR #18 head | Merged/superseded |
| `codex/product-checkpoint` at `33e66c4` | PR #19 head | Merged/superseded |
| `codex/product-checkpoint-receipt` at `a8b140f` | PR #20 head | Merged/superseded |
| `codex/mcp-transport-discovery-foundation` at `fee340a` | Draft PR #21 head and `candidate/*` tag | Active, unmerged candidate |
| `codex/hosted-library-foundation` at `c19ca66` | `archive/local-heads/2026-07-16/hosted-library-foundation` | Superseded preservation head |
| `codex/hosted-library-foundation-review` at `999b44d` | `archive/local-heads/2026-07-16/hosted-library-foundation-review` | Superseded preservation head |

The historical remote branch
`migration/unknown--skillmap-2026-07-04` at `7a7218efde71abb2321055dc810274bfce1f4f95`
also remains directly present on GitHub. It is migration history, not current
product source.

## Intentional local-only boundary

“Everything on GitHub” means all safe, durable product code, documentation,
plans, configuration, and Git history. It does not mean publishing sensitive or
generated runtime state.

- `.skillmap/**` remains ignored and local. Its 48 owner-only files include raw
  prompt/body-like fields, local paths, hook backups, evaluations, and private
  validation receipts. Redacted conclusions are recorded in tracked ledgers and
  this status page instead.
- `.chunk/sidecar.json` and `.chunk/sidecar.*.json` remain ignored transient
  process state. `.chunk/config.json` is tracked intentionally.
- Dependency folders, build output, browser reports, tarballs, environment
  files, and provider credentials remain ignored and reproducible.
- `.claude/settings.json` and `.codex/hooks.json` are tracked project automation
  policies. They run repository-relative install/test/validation commands and
  contain no credentials; contributors should still review executable hook
  policy before enabling it.

The preservation audit found no high-confidence credential canaries in the
newly tracked files or the previously GitHub-absent histories. The repository is
currently private. Before making archive history public, re-review historical
operations material for internal hostnames, private network addresses, and
synthetic identity fixtures.
