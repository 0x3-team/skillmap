# Checkpoint Lenses

Classify the checkpoint before audit. If the user names a lens, use it. If the user says "whole thing", decompose into independent lenses and consider workers.

| Lens | Use When | Primary Routes | Evidence Required |
| --- | --- | --- | --- |
| `whole-project` | "checkpoint everything", broad repo/product quality | `audit-orchestrator`, workers, `planning-orchestrator`, `implementation-orchestrator`, `production-readiness-gate` | repo anchor, audit report, plan, implementation receipts, full validation |
| `ui-ux` | UI, UX, visual quality, flows, responsive behavior | `frontend-design`, `audit-orchestrator`, browser tools, `background-browser-operator` | screenshots/browser checks, responsive states, accessibility, overflow, workflow evidence |
| `security` | auth, secrets, RLS, permissions, threat risk | `codex-security:security-scan`, `codex-security:deep-security-scan`, `codex-security:threat-model`, `codex-security:finding-discovery`, `codex-security:fix-finding`, `codex-security:validation`, `audit-orchestrator`, `production-readiness-gate` | file evidence, dependency/secrets checks, authz/authn behavior, blocked checks |
| `backend` | APIs, services, queues, workers, business logic | repo patterns, codegraph, backend tests, `audit-orchestrator` | API contracts, error handling, logs, tests, schema/data contracts |
| `data-integrity` | DB, migrations, reconciliation, generated data, progress/state | Supabase/Postgres/data skills, read-only rows, tests | migrations, row samples, constraints, RLS/policies, backup/rollback notes |
| `architecture-maintainability` | code structure, duplication, boundaries, long-term health | codegraph, repo docs, audit workers | dependency graph, duplication findings, boundary violations, refactor plan |
| `performance` | speed, memory, frontend perf, backend latency | `web-perf`, tests/benchmarks, logs | benchmark output, traces, bundle/perf metrics, regression thresholds |
| `production-readiness` | deploy, staging, launch, migration, release | `production-readiness-gate` | local/live/deployed/blocked matrix, deploy IDs, env vars, auth/live checks |
| `browser-live` | logged-in UI, admin panels, browser automation, extensions | `background-browser-operator`, browser tools, production gate | target, surface, mode, auth/session state, screenshot/DOM evidence, focus receipt |
| `testing-qa` | test quality, coverage, flaky tests, CI | test commands, CI logs, root-cause skill | failing/passing test evidence, coverage gaps, flake diagnosis |
| `docs-devex` | README, handoff, scripts, onboarding, ops docs | local docs, package scripts, release handoff | commands verified, docs accuracy, setup path, missing ops steps |

## Routing Rules

- UI/UX lens must include actual browser/UI evidence when feasible.
- Security lens must prove scope and verification path before changes. Use `codex-security:security-scan` for normal scoped checks, `codex-security:deep-security-scan` for broad/high-risk release scope, `codex-security:threat-model` for design or auth/data exposure questions, `codex-security:finding-discovery` or `codex-security:attack-path-analysis` for suspected exploitable paths, and `codex-security:fix-finding` plus `codex-security:validation` for remediation.
- Backend/data lenses must inspect contracts and persistence, not only route names.
- Production-readiness lens must separate local validation, live verification, pushed/deployed state, and blockers.
- Browser/live lens must use the background browser receipt when the user is studying or doing other work.
