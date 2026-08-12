# SkillMap project map

SkillMap is two related products in one repository:

- A private, local-first tool that helps developers inventory, curate, and route agent skills.
- A separate hosted trust catalog that can let people browse, save, submit, review, and publish skill metadata.

The key to understanding the codebase is that these products share contracts and release discipline, but they do **not** share a runtime. Local prompts and local skill bodies do not flow into the hosted system.

## Start with these two diagrams

- [Project orientation](graphs/project-orientation.mmd) — the whole repository in one readable view.
- [Production path](graphs/production-path.mmd) — the work between a good local source tree and a public alpha.

Use the more detailed diagrams in [the graphs index](graphs/README.md) only when you need a specific runtime or authority flow.

## How the project works

### Local product

1. An operator configures skill roots and runs `scan`.
2. SkillMap records qualified skill identities, detects risks and duplicates, then produces a review packet.
3. A reviewed policy produces an effective registry and SkillGraph.
4. CLI, dashboard, the passive hook, and local MCP all read that approved state to give deterministic recommendations.

The important implementation seam is the immutable workspace revision: commands write a new revision under a lock; readers use one verified, approved revision or fail closed. This is why the local product can stay private and deterministic.

### Hosted catalog

1. A signed-in publisher submits one exact public GitHub repository, commit, and `SKILL.md` path.
2. The Next.js app writes the account-owned intent through Supabase RLS.
3. A constrained worker fetches inert public source bytes, creates static-audit and provisional-grade receipts, and records them through service-only RPCs.
4. An operator completes consent, collision, and publication actions with dual control.
5. Supabase exposes only the bounded public metadata/evidence projection to the Next.js catalog.

This is a trust catalog, not a hosted copy of the local router. It deliberately does not execute submitted skills or ingest routine local workspace data.

## Repository structure

```text
src/
  cli.ts                 Command dispatcher and mutation wrapper
  commands/              CLI verbs: scan, curate, policy, graph, route, eval, hook, MCP
  core/                  Inventory, identity, policy, SkillGraph, routes, jobs, revisions
  services/              Shared use cases for CLI, connector, and MCP
  server/                Loopback connector, local security, dashboard backend
  mcp/                   Read-only stdio MCP adapter
  hosted/                Shared static audit and provisional grading logic

assets/local-app/v1/     Versioned static dashboard served only by the loopback connector
contracts/               Versioned JSON schemas, vectors, and generated type facades

apps/web/                Next.js hosted catalog, accounts, submissions, and public API
apps/worker/             Service-role queue, audit, review, lifecycle, and publication commands
supabase/                Migrations, seed data, and pgTAP authority/RLS tests

test/                    Root contracts, local runtime, privacy, migration, MCP, and release tests
apps/web/tests/          Hosted boundary and visual test coverage
ops/, .github/, .gitea/  CI, backup/recovery, and deployment-operation material
docs/                    Product rules, runbooks, architecture, and launch gates
```

## What is complete, and what is not

| Area | Source status | Evidence in this review | Still needed for production |
| --- | --- | --- | --- |
| Local CLI, state, policy, graph, and router | Implemented | Root typecheck and 34 contract tests passed | Real-user routing efficacy evidence and a release decision |
| Local dashboard, hook, and MCP | Implemented | Typecheck and contract surfaces passed | Targeted runtime/browser smoke after the next product change; package release |
| Hosted web surface | Implemented as a local candidate | Web typecheck, lint, fixture/boundary tests, and production build passed | Provisioned origin, Supabase, GitHub OAuth, and live workflow proof |
| Hosted database and worker authority | Implemented in migrations and worker commands | Static preflight passed the source-bound authority checks | Apply migrations remotely, schedule the worker, and prove queue/recovery behavior |
| Release operations | Runbooks and CI checks exist | Static preflight passed; no external infrastructure was touched | Backups, restore/replay, monitoring, incident ownership, rollback, and support intake |
| Public alpha | Not verified | No live deployment, OAuth, database, worker, or pilot was tested here | Complete the production path before opening signup or indexing |

### Deliberately outside this v1

Remote hosted MCP, remote skill loading/mirroring, R2/TUF distribution, team sync, billing, and current-letter behavioural grading are deferred product work. Do not make them prerequisites for a small hosted alpha; they belong after the current local and hosted flows are operating reliably.

## The practical production plan

1. Freeze an exact candidate and decide whether the local package ships independently as `0.1.0`.
2. Provision a private hosted environment: Supabase project, web host/domain, GitHub OAuth, least-privilege secrets, and a named operator.
3. Apply and verify migrations, then run the deployed catalog/account/submission/report flows against real authentication.
4. Operate the worker on a schedule and prove retries, leases, dead letters, dual-control publication, backup/restore, and rollback.
5. Load only a publisher-authorized initial corpus, then run a small invited pilot with support, accessibility, and routing-efficacy checks.
6. Make a recorded go/no-go decision before enabling public indexing or open signup.

The major risk is operational, not missing feature code: a locally validated hosted authority system is not yet a deployable service until those steps have real receipts.

## Design work worth doing after the operational gates

The local backend has grown into a large coordination surface: `src/server/skillmap-backend.ts` is 2,735 lines and `src/server/local-connector.ts` is 1,376 lines. After the first pilot, split the backend by user workflow (onboarding/workspaces, routing/activity, policy/sources, and jobs) behind the existing `LocalConnectorBackend` interface. Do not do that refactor before the live gates; it would add risk without proving the product.

For a deployment, set `NEXT_PUBLIC_SITE_URL`. The checked behavior is now fail-closed: hosted production paths require an explicit secure origin contract for `metadataBase`, while local candidate runs intentionally keep local metadata configuration behavior as a separate non-hosted mode.

## Evidence boundary for this map

Validated locally in the source checkout (T0.30):

- Root suite: 484 passing of 484 tests
- `npm run check:web` passed after fixture, typecheck, lint, and build
- Hosted boundary suite: 38 passing of 38 tests
- Privacy suite: 51 passing of 51 tests
- Release path suite: 60 passing of 60 tests
- Pinned Linux visual suite: 11 passing of 11, with zero diffs

Not verified here: remote deployment, live OAuth, Supabase project state, worker scheduling, monitoring, off-host backup/restore, rollback, public indexing, or an external pilot.

For deeper source detail, use [architecture](architecture.md), [hosted registry architecture](architecture/hosted-registry.md), and the [free public alpha runbook](operations/free-public-alpha-runbook.md).
