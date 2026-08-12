# SkillMap live owner-pilot implementation plan

**Status:** goal-aligned on 2026-07-23 from the recovered Zcode/GLM 5.2 audit plan (`sess_601160a2-9f7d-427e-8e08-52c1c8074e86`) and the repository’s hosted deployment and pilot runbooks.

## Decision

The milestone is not “finish every audit task,” “publish SkillMap,” or “invite a public cohort.” The milestone is:

> Deploy the real hosted SkillMap privately on HTTPS, backed by a remote Supabase project and the real remotely scheduled worker, so the owner can use the complete participant and operator workflow personally, observe the system, recover or roll it back, and decide what to fix next.

The recovered audit contained 32 findings and 113 atomic tasks. Those findings remain in the disposition register, but they are not the execution order. This document is the authoritative implementation sequence for the live owner-pilot milestone. The older Personal V1 plan remains the authority for local-only CLI/dogfood work and must not be mistaken for a hosted deployment plan.

An external five-person pilot is a later promotion gate. It is deliberately not part of this milestone’s definition of done.

## Current evidence and boundary

- The repository describes the hosted catalog as locally validated only; it does **not** claim a remote deployment, live OAuth, or production readiness.
- The composed hosted gates use a disposable local Supabase stack and `127.0.0.1`. They prove local contracts, not a deployed system.
- The current worktree is deliberately dirty. The web build references `apps/web/scripts/check-hosted-release-config.mts`, which is present but untracked, and visual baselines are modified. A deployable candidate must bind every build dependency and reviewed baseline in an exact commit.
- Hook runs have shown intermittent package-resolution failures after `npm ci`; a later run reported 482 passed, 0 failed, and 1 cancelled. The root suite is not repeatable evidence until clean isolated runs complete without failures or cancellations.
- No remote Supabase project, chosen web or worker host, production OAuth callback, enforced owner-only access boundary, remote worker schedule, encrypted off-host restore receipt, rollback receipt, or live owner-pilot receipt has been verified.

## Scope

### In scope

- One private, owner-operated HTTPS deployment.
- A dedicated remote Supabase project created from reviewed migrations.
- Real GitHub OAuth at the deployed callback.
- Enforced access restriction for the owner-pilot; `noindex` alone is not access control.
- A remotely hosted and scheduled worker using least-privilege secrets.
- Participant, submission, worker, review, publication, report, lifecycle, export, and deletion paths exercised against remote services.
- Encrypted off-host backup, isolated restore rehearsal, observability, incident stop controls, and web rollback.
- A self-pilot evidence receipt and an explicit owner go/no-go decision.

### Out of scope for this milestone

- External participant recruitment.
- Public indexing, open signup, public launch, public-alpha promotion, npm publication, billing, teams, or package release.
- Broad local CLI, fixture dashboard, helper, token, or design-system refactors that do not unblock the live owner workflow.
- Claiming operational dual control by pretending one person is two independent humans.
- Claiming live readiness from local Docker, local Supabase, screenshots, a pushed commit, or CI alone.

## Definition of done

The live owner-pilot milestone is complete only when the implementation ledger contains direct evidence for every item below:

1. **Exact candidate:** one clean Git commit passes the complete release gate twice from fresh isolated installs with the hook’s Node runtime, with no failures or cancellations.
2. **Approved topology:** the web host, worker host/scheduler, private hostname, Supabase project/region, provider plans and limits, secret owners, log surfaces, rollback target, and cost boundary are explicitly recorded.
3. **Remote data authority:** the remote Supabase project contains exactly the reviewed migrations and generated API types; remote-safe schema, grant, and RLS checks pass.
4. **Recoverability:** an encrypted schema-and-data backup is stored off-host and restored into an isolated disposable target. Only the receipt is redacted; the recoverable backup is not replaced by a redacted/schema-only artifact.
5. **Private deployment:** the exact candidate is deployed over HTTPS in `private-alpha`, indexing is disabled, the service-role key is absent from the web runtime, and an unapproved identity cannot reach the owner-pilot surface.
6. **Real authentication:** the owner can complete GitHub OAuth, sign out, and sign back in at the deployed origin using a non-operator participant identity.
7. **Real authority path:** the remotely scheduled worker processes one controlled exact-source submission exactly once; operator review/publication mechanics, report handling, and lifecycle behavior use remote data and leave auditable receipts.
8. **Owner self-pilot:** the owner completes browse, evidence inspection, save/unsave, submit/status, export, and deletion on desktop and a 390px mobile viewport and records friction, defects, and observed behavior.
9. **Operational proof:** a controlled worker failure produces a useful alert/log trail; web rollback and post-rollback smoke pass; test accounts, temporary rows, credentials, and unencrypted backups are cleaned up.
10. **Honest decision:** the owner records `continue owner pilot`, `fix and repeat`, or `stop`. Completion does not authorize external invitations, public indexing, or public launch.

## Evidence ledger

Create the execution ledger when implementation begins at:

`docs/plans/2026-07-22-skillmap-comprehensive-audit-remediation-implementation-ledger.jsonl`

Each entry must record the phase/task ID, UTC timestamp, exact commit, environment, command or action, result, non-secret artifact/receipt reference, evidence level (`local`, `CI`, `deployed`, `remote-authenticated`, or `unverified`), and blocker/next action. Never store credentials, OAuth metadata, database passwords, raw user data, raw submitted skill bodies, or private filesystem paths in the ledger.

## Orca supervised execution contract

This plan is designed for a **manual supervised Orca loop**, not an unattended `orca orchestration run` over the whole graph. Orca marks a dispatch completed when a valid `worker_done` arrives; that means the worker stopped, not that the coordinator accepted the work. The coordinator must review and approve each microtask before creating any dependent task.

### Runtime mapping

- The stable keys in this document (`T0.01`, `T1.01`, and so on) are plan keys. Orca creates runtime UUID task and dispatch IDs.
- Record the mapping from plan key to Orca task ID, dispatch ID, worker handle, worktree, and review result in the implementation ledger.
- Create tasks wave by wave. Do not pre-create downstream tasks whose prerequisites have not been coordinator-approved.
- Use `orca orchestration task-create`, a recognized agent terminal, `dispatch --inject`, and `check --wait --types worker_done,escalation,decision_gate`.
- Verify runtime provenance with `task-list` and `dispatch-show` before describing work as orchestrated.
- Before the exact candidate is committed, edit tasks must use fresh terminals in the active worktree and must have exclusive file ownership. After the candidate is committed, independent read-only or disjoint-file tasks may use agent-first isolated worktrees.
- Credential-bearing provider changes, commits, merges, destructive cleanup, billing/plan choices, and owner experience tasks stay with the coordinator or owner. A weaker worker may prepare or verify them but must not make the decision.

### Task-spec wrapper

When dispatching one row from the microtask DAG, send the row plus this contract:

```text
PLAN KEY: <Tn.nn>
REPO: <repo-root>
DEPENDENCIES: Only begin after the coordinator says every listed dependency is approved.
ALLOWED SCOPE: Read and write only the files/surfaces named in this task. Preserve all unrelated dirty-worktree changes.
ONE OUTCOME: Complete only the atomic action in this task. Do not fix adjacent findings, refactor neighboring code, commit, deploy, create accounts, rotate secrets, or change provider settings unless this exact task says so.
INSPECT FIRST: Read the named source, nearby tests, and applicable local instructions before editing. Do not invent commands, files, tables, routes, env vars, or provider behavior.
VERIFY: Run the exact bounded check named in the task. If it cannot run, report the blocker and do not claim success.
SECRETS: Never print or store credentials, OAuth metadata, private account identifiers, raw user data, raw skill bodies, or private filesystem paths in reports or the ledger.
BLOCKING QUESTIONS: Use Orca ask when a missing decision would change the implementation. Do not guess.
COMPLETION: Send worker_done exactly once with a three-sentence summary and payload containing taskId, dispatchId, filesModified, and reportPath when present. Then stop and wait.
```

### Worker report contract

Every worker response must contain:

1. plan key and result: `done`, `blocked`, or `failed`;
2. files/surfaces inspected;
3. files/surfaces changed;
4. commands/checks run and their exit/result;
5. one line for every success criterion: `PASS`, `FAIL`, or `BLOCKED`, with evidence;
6. risks, assumptions, and remaining work;
7. confirmation that no unrelated files, secrets, credentials, remote resources, commits, or deployments were changed.

### Coordinator review loop

After each `worker_done`, the coordinator independently inspects the diff or remote evidence and records exactly one ledger review result:

- `APPROVED`: scope is clean, every criterion has direct evidence, and the coordinator reran or independently checked the bounded verification. Only then may dependent tasks be created.
- `REVISION_REQUESTED`: create a child revision task named `<plan-key>-R1` or `-R2` containing only the failed criteria and exact feedback. Prefer the same worker for the first bounded revision.
- `SELF_FIX`: the coordinator may make an obvious low-risk repair only when it is small, local, does not touch auth/data/migrations/deployment/secrets, and the user has authorized implementation. Rerun the original verification and record the coordinator-owned diff.
- `TAKEOVER`: the coordinator rewrites the task when two bounded revisions fail, the worker invents interfaces or evidence, the change crosses ownership boundaries, or the risk requires stronger judgment.
- `BLOCKED`: create a decision gate or ask the owner when credentials, provider choice, billing, legal/policy approval, a second human, or destructive authority is required.

Do not accept “tests pass” without the exact command and result. Do not accept a source edit as browser, remote, authenticated, restore, rollback, or deployment proof.

## Outcome workstreams (reference only)

The parent outcomes below explain why the work exists. **Do not dispatch a parent `P` item to a worker.** Dispatch only one `T` microtask from the DAG that follows.

### Phase 0 — produce a trustworthy exact candidate

**Goal:** establish a reproducible, committed candidate before creating or changing remote resources.

- **Parent P0.1 — Reproduce and close the root-test instability.** Run the root suite twice from fresh isolated dependency trees using the same Node runtime as the hook. Capture the exact child process, module path, environment, and concurrent install state if resolution fails. A single green run is not closure.
  - Acceptance: two clean runs complete with no failures or cancellations, or a deterministic root cause is fixed with a focused regression test and then both clean runs pass.

- **Parent P0.2 — Make the hosted build dependency set atomic.** Review `check-hosted-release-config.mts`, `local-supabase-psql.mjs`, their callers, boundary tests, package scripts, and TypeScript configuration as one candidate slice. A tracked build must never refer to an untracked script.
  - Covers: C1.
  - Acceptance: a clean checkout runs `npm --prefix apps/web run build` and `npm --prefix apps/web run test:hosted-boundaries`.

- **Parent P0.3 — Repair the release gate before relying on it.** Ensure `test:release-path` executes every release-path test and verifies real Git ancestry when objects are present, with a visible justified skip only for a genuinely shallow clone.
  - Covers: C3, C4; C2 remains conditional on a later package release.
  - Acceptance: `npm run test:release-path` passes and reports whether ancestry was verified or skipped and why.

- **Parent P0.4 — Resolve visual-baseline ownership.** Identify the UI changes that produced the modified baselines, review them on the pinned Linux renderer, and bind the source UI and accepted baselines in the same commit. Preserve unrelated owner work.
  - Covers: C5.
  - Acceptance: the visual gate passes against a named baseline commit with no unexplained image drift.

- **Parent P0.5 — Apply the narrow deployment security fix.** Centralize the flash-cookie origin decision and make report/account-deletion cookies fail closed when the hosted origin is missing or invalid.
  - Covers: B1.
  - Acceptance: focused coverage proves private HTTPS cookies are `Secure`, `HttpOnly`, and appropriately `SameSite`; invalid hosted configuration cannot produce an insecure cookie.

- **Parent P0.6 — Correct only execution-critical documentation.** Remove the portable-runbook dependency on `rg`, align the documented Node runtime with the web package, and document the difference between technical dual-control testing and operational separation by two humans.
  - Covers: C6, D2, D6.
  - Acceptance: a fresh operator can execute the runbook with standard tools and cannot mistake two credentials held by one person for real operational dual control.

- **Parent P0.7 — Freeze the exact candidate and create the ledger.** Review the complete diff, separate unrelated dirty-worktree material, commit the coherent hosted candidate, and create the implementation ledger without secrets.
  - Acceptance: the candidate SHA is immutable and passes the root, web, hosted-boundary, visual, privacy, and release-path gates required by the repository.
  - Stop: do not provision Supabase, OAuth, web hosting, or a worker from an uncommitted or irreproducible tree.

### Phase 1 — approve the live topology and safety boundaries

**Goal:** decide exactly where the system runs and how it remains private before provisioning it.

- **Parent P1.1 — Record the provider topology.** Choose and approve the web provider, worker/scheduler provider, private hostname, Supabase organization/project/region, provider plans and limits, expected idle/pause behavior, deployment command, rollback command, health/log surfaces, and cost ceiling.
  - Acceptance: the decision record names every remote component and owner; no placeholder such as `APPROVED_REGION` or `<provider>` remains.
  - Stop: if no reviewed plan-compatible host exists, keep the milestone blocked rather than silently selecting a paid or incompatible service.

- **Parent P1.2 — Choose enforceable owner-only access.** Select an access gate that denies unapproved users before or during authentication, define the approved owner identities, and document recovery/break-glass behavior. Private metadata and `noindex` are additional controls, not substitutes.
  - Acceptance: the chosen mechanism has a testable allow and deny path and does not expose service credentials to the browser.

- **Parent P1.3 — Define identities and authority.** Name the owner participant identity, disposable isolation-test identities, worker runtime identity, operator test identities, secret custodians, and whether a second human is available for real dual control.
  - Acceptance: roles are distinct and least-privilege. If one human uses two test operator identities to exercise software mechanics, the ledger must label the result `single-human technical rehearsal`; it cannot authorize external users or real participant publication.

- **Parent P1.4 — Define owner-pilot data and incident rules.** Record owner-pilot retention, deletion timing, off-host backup destination, log retention/redaction, support route, incident owner, stop conditions, and test-data cleanup.
  - Acceptance: the owner knows how to stop sign-in, stop the worker, disable the deployment, rotate credentials, restore data, and delete pilot data.

- **Parent P1.5 — Freeze the environment and secret matrix.** List every public and secret variable by component. The web receives only reviewed public configuration; worker/database/operator secrets remain server-side in their approved stores.
  - Acceptance: previews remain unconfigured unless they have a separate Supabase project; no production secret enters the repository, shell history, build output, browser bundle, ledger, screenshot, or public log.

### Phase 2 — provision remote Supabase, web, access, OAuth, and recovery

**Goal:** create the real private deployment from the exact Phase 0 candidate.

- **Parent P2.1 — Provision remote Supabase from migrations.** Create the dedicated owner-pilot project, link the exact clean checkout, inspect the linked migration list, dry-run and apply reviewed migrations, regenerate API types, and verify type parity.
  - Acceptance: project identifier, migration versions, generated-type digest, exposed schema, grants, and remote-safe RLS results are recorded without credentials; local `supabase/seed.sql` is not applied remotely.

- **Parent P2.2 — Deploy the immutable web candidate.** Deploy the Phase 0 SHA with `SKILLMAP_RELEASE_STAGE=private-alpha`, private indexing, the exact site origin, and the remote public Supabase configuration.
  - Acceptance: provider deployment ID, HTTPS origin, timestamp, commit SHA, environment, plan/limits, health result, and rollback target are recorded and independently match.

- **Parent P2.3 — Configure GitHub OAuth and the owner-only gate.** Configure the exact GitHub-to-Supabase callback, application callback, permitted origin, provider settings, and approved owner access path.
  - Acceptance: the approved non-operator identity signs in/out successfully; an unapproved identity is denied; email/password, magic-link, anonymous, and unintended redirect paths remain disabled as required by the runbook.

- **Parent P2.4 — Prove remote database isolation.** Exercise anonymous, authenticated, cross-account, and service-role boundaries against the remote project using disposable records.
  - Acceptance: only the `api` schema is exposed; private/lifecycle rows remain inaccessible to browser roles; two participant identities cannot read or mutate one another’s rows; all disposable rows are removed.

- **Parent P2.5 — Prove encrypted off-host recovery.** Create an encrypted schema-and-data backup outside the repository, copy it off-host, restore it into an isolated disposable target, and verify migrations, expected row counts/digests, RLS, and database integrity.
  - Acceptance: the ledger contains only checksum, timestamp, inventory, restore target class, verification result, cleanup, and recovery owner. Unencrypted temporary material is deleted.

### Phase 3 — deploy and operate the real worker path

**Goal:** ensure asynchronous work is processed remotely, safely, observably, and reversibly.

- **Parent P3.1 — Package and deploy the worker from the exact candidate.** Run the worker from the same reviewed SHA using the Phase 1 host and runtime identity. Define the executable command, working directory/artifact, Node runtime, secret injection, network boundary, and deploy/rollback method.
  - Acceptance: the remote runtime reports the expected candidate version without printing secrets, and the web runtime has no worker/service-role credential.

- **Parent P3.2 — Configure the schedule and concurrency boundary.** Define cadence/trigger, singleton/concurrency behavior, claim lease, idempotency, provider-budget deferral, retry, dead-letter, pause/resume, and safe shutdown.
  - Acceptance: the schedule is inspectable, can be disabled immediately, and cannot process the same controlled queue item twice.

- **Parent P3.3 — Establish operational observability.** Capture deploy, auth, API, database, worker failure, queue-age, retry/dead-letter, and scheduler signals. Name the recipient and first response for each.
  - Acceptance: a harmless forced worker failure produces the expected alert and bounded log trail; recovery is demonstrated without exposing submitted content or credentials.

- **Parent P3.4 — Process and clean up a synthetic remote item.** Submit one harmless exact public-source test item through the supported API, let the remote schedule claim and process it, inspect its audit/grade receipt, and remove all synthetic data through supported lifecycle actions.
  - Acceptance: the item reaches the expected terminal state exactly once, every state transition is auditable, provider-limit handling is safe, and zero synthetic residue remains.

- **Parent P3.5 — Rehearse web and worker rollback.** Roll the private web deployment and worker back to recorded known-good revisions, verify migration compatibility, then run a bounded post-rollback smoke.
  - Acceptance: rollback timestamp, exact targets, worker state, queue safety, health results, and recovery decision are recorded.

### Phase 4 — run the owner self-pilot on the live system

**Goal:** let the owner personally experience the real product and decide what must change before anyone else is invited.

- **Parent P4.1 — Verify the signed-out and access boundaries.** From outside the authenticated session, verify the owner-only gate, private no-index headers/metadata, bounded catalog/API projection, expected unavailable/error states, security headers, and absence of secrets or local paths.
  - Acceptance: the approved access route works; an unapproved identity cannot enter; anonymous/public projections reveal only intended bounded data.

- **Parent P4.2 — Complete the participant workflow as the owner.** Using the approved non-operator GitHub identity, sign in, browse/search, inspect source/audit/grade evidence, save and unsave, submit one exact immutable public source for the authority-path test, create and withdraw a separate queued test submission, view both statuses, export account data, and sign out/in. Keep the account and authority-path submission until P4.3 completes.
  - Acceptance: every step runs against the deployed origin and remote Supabase on desktop and a 390px mobile viewport; screenshots/status summaries and observed friction are recorded without private data.

- **Parent P4.3 — Follow the submission through the real authority path.** Allow the remote worker to process the controlled owner submission; inspect it through supported operator read paths; exercise authorization, collision/license checks, approval/execution, safe test publication, report handling, quarantine/revocation/restore behavior, and public evidence projections.
  - Acceptance: receipt-bound audit/grade/public states match the exact submitted version, scripts are never executed, and browser roles cannot mint or mutate operator evidence.
  - Boundary: if one human operates both test credentials, this proves only the technical workflow. Retaining a real participant listing or inviting others still requires two distinct human operators.

- **Parent P4.4 — Exercise privacy, abuse, and failure behavior.** Test invalid coordinates, malformed inputs, duplicate/cooldown handling, rate limits, cross-account access with disposable isolation-test identities, unauthorized operator calls, expired authorization, safe logs/errors, and finally account deletion plus derived-data cleanup.
  - Acceptance: failures are bounded and recoverable, no cross-account/private data is exposed, the owner-pilot account and covered derived data are removed, and cookies plus security headers remain correct on the real origin.

- **Parent P4.5 — Record the owner-pilot release receipt.** Attach non-secret deployment/migration/worker identifiers, screenshots, HTTP/status summaries, timestamps, cleanup confirmation, defects, accepted limitations, and evidence levels.
  - Acceptance: every definition-of-done item maps to current evidence or an explicit blocker; no item is inferred from local or CI proof.

- **Parent P4.6 — Hold the owner go/no-go review.** Choose `continue owner pilot`, `fix and repeat`, or `stop`. Turn observed defects into a small evidence-ranked implementation slice and rerun only affected local and live gates before repeating the owner pilot.
  - Acceptance: the decision, rationale, blockers, next slice, and live re-verification requirements are recorded.

### Phase 5 — optional later promotion to an external private pilot

**Goal:** preserve a safe path to outside participants without making it part of the owner-pilot milestone.

- **Parent P5.1 — Satisfy external-participant prerequisites.** Require two distinct human operators, approved retention/policy version, consent/privacy wording, age/geography boundary, reachable support/security/appeal routes, named incident owner, encrypted restore, rollback, and enforced invite-only access.

- **Parent P5.2 — Use the existing five-seat workflow matrix.** Recruit exactly three skill users and two authorized public-skill authors only after P5.1. Assign browse/evidence, save/return, grade interpretation, submission/status, and author publication follow-through before each session.

- **Parent P5.3 — Apply the existing pass rule.** Pass only with at least four of five uncoached completions, uncoached coverage of every mandatory workflow, and no unresolved P0/P1, privacy, auth, data-integrity, trust, restore, rollback, or policy failure.

- **Parent P5.4 — Keep public promotion separate.** External private-pilot success permits a new public-launch review; it does not authorize indexing, open signup, announcement, npm publication, or public alpha.

## Dispatchable microtask DAG

Only the `T` tasks below are dispatchable. “Write ledger” always means a redacted evidence entry; it never authorizes source edits. A task marked `coordinator` or `owner` is deliberately not delegated to a weaker worker.

### Phase 0 microtasks — exact candidate

- [ ] **T0.01 — Capture the repository anchor.**
  - Depends / owner / scope: none; worker; read-only `git status`, branch, HEAD, Node/npm paths and versions; write one ledger report.
  - Action: record the exact dirty state and toolchain without installing, editing, staging, cleaning, or committing.
  - Success: report contains branch, HEAD, all changed/untracked paths, `node` and `npm` resolutions/versions, and explicitly says no files changed.

- [ ] **T0.02 — Capture the hook runtime.**
  - Depends / owner / scope: T0.01 approved; worker; read `.codex/hooks.json` and resolved executable metadata only; write one redacted report.
  - Action: identify the exact Node executable and command sequence used by the stop hook without exposing unrelated hook content.
  - Success: hook Node path/version and install/test commands are recorded and match a live `command -v`/version check.

- [ ] **T0.03 — Map package-resolution entry points.**
  - Depends / owner / scope: T0.01; worker; read `package.json`, lockfile, `scripts/run-root-tests.mjs`, and child-process helpers in `test/`; no source writes.
  - Action: identify which process installs dependencies, which executable launches tests, and which tests spawn `dist/cli.js`.
  - Success: report names the exact files/functions and explains the install-to-child-process path with no proposed fix.

- [ ] **T0.04 — Define the isolated-run recipe.**
  - Depends / owner / scope: T0.02 and T0.03; worker; read-only repo plus temporary-directory design; write report only.
  - Action: write exact steps for a fresh isolated copy/install using the hook Node runtime, a unique temp path, and no shared `node_modules`.
  - Success: recipe names source revision capture, copy/checkout method, install command, test command, environment capture, cleanup, and a rule forbidding mutation of the working checkout.

- [ ] **T0.05 — Execute isolated root run A.**
  - Depends / owner / scope: T0.04; worker; temporary isolated tree only; write redacted result artifact.
  - Action: run the approved install and full root test once with the hook runtime.
  - Success: receipt records temp-tree identity, Node/npm versions, command, exit code, pass/fail/cancel totals, duration, and first causal error if nonzero.

- [ ] **T0.06 — Execute isolated root run B.**
  - Depends / owner / scope: T0.05 reviewed; different fresh temporary tree; write redacted result artifact.
  - Action: repeat the identical recipe without reusing run A dependencies or build output.
  - Success: receipt has the same fields as T0.05 and proves a distinct dependency tree was used.

- [ ] **T0.07 — Classify isolated-run reproducibility.**
  - Depends / owner / scope: T0.05 and T0.06; coordinator review; no edits.
  - Action: compare both receipts and choose `repeatable-green`, `repeatable-failure`, or `intermittent-failure`.
  - Success: classification cites exact matching/diverging evidence and selects either T0.12 or the conditional failure path T0.08.

- [ ] **T0.08 — Create the smallest failing reproducer.**
  - Depends / owner / scope: T0.07 reports a failure; worker; read failing test/helper and package metadata; write only a temp reproducer or one focused test fixture approved by coordinator.
  - Action: reduce the module-resolution failure to the smallest child-process command that fails under the hook runtime.
  - Success: one bounded command fails for the same causal reason without running the full suite; otherwise task is `BLOCKED` with attempts recorded.

- [ ] **T0.09 — Add a regression test for the reproduced failure.**
  - Depends / owner / scope: T0.08; worker/edit; write one existing nearest test file or one narrowly named new test file; no production fix.
  - Action: encode the reproducer as a test that fails before the fix.
  - Success: focused test fails with the expected package-resolution assertion and unrelated focused tests remain unchanged.

- [ ] **T0.10 — Implement the narrow package-resolution fix.**
  - Depends / owner / scope: T0.09; worker/edit; only the exact runner/helper/package metadata identified by T0.08; no refactors.
  - Action: fix the deterministic cause while preserving the hook runtime and child CLI behavior.
  - Success: the new regression test passes, the prior causal command passes, and the diff contains no unrelated dependency upgrades or test weakening.

- [ ] **T0.11 — Reverify the resolution fix twice.**
  - Depends / owner / scope: T0.10; worker; two new isolated temp trees; no source edits.
  - Action: repeat T0.05 and T0.06 against the fixed candidate.
  - Success: both full runs finish with zero failures and zero cancellations; receipts supersede the failed runs.

- [ ] **T0.12 — Inventory hosted build dependencies.**
  - Depends / owner / scope: T0.07 `repeatable-green` or T0.11; worker; read `apps/web/package.json`, `tsconfig.json`, hosted scripts/tests, and git status; report only.
  - Action: list every tracked or untracked file referenced by the hosted build and hosted boundary tests.
  - Success: report identifies `check-hosted-release-config.mts`, `local-supabase-psql.mjs`, every caller, and any missing/untracked dependency with exact paths.

- [ ] **T0.13 — Add the missing-build-dependency boundary test.**
  - Depends / owner / scope: T0.12; worker/edit; `apps/web/tests/hosted-boundaries.test.mjs` only unless coordinator approves one fixture.
  - Action: add or tighten one test proving the package/build scripts reference existing candidate files.
  - Success: test fails when the required script is absent/misnamed and passes with the current intended file set.

- [ ] **T0.14 — Integrate the hosted build files atomically.**
  - Depends / owner / scope: T0.13; worker/edit; only `apps/web/package.json`, `apps/web/tsconfig.json`, named hosted scripts, and directly coupled test imports.
  - Action: make paths, script names, and TypeScript inclusion agree; do not alter hosted behavior beyond build integration.
  - Success: every referenced file exists in the candidate scope, no tracked script imports an untracked dependency, and T0.13 passes.

- [ ] **T0.15 — Verify the clean web build boundary.**
  - Depends / owner / scope: T0.14; worker; clean isolated candidate; no edits.
  - Action: run `npm --prefix apps/web run build` and `npm --prefix apps/web run test:hosted-boundaries`.
  - Success: both commands exit zero; receipt includes exact commands, versions, and no hosted production secret.

- [ ] **T0.16 — Inventory release-path tests.**
  - Depends / owner / scope: T0.01; worker; read `package.json`, `test/release-*.mjs`, `test/package-candidate-verifier.mjs`, and related scripts; report only.
  - Action: compare existing release-related test files with the `test:release-path` script.
  - Success: report lists included and omitted release tests and explains each omission without editing files.

- [ ] **T0.17 — Make `test:release-path` complete.**
  - Depends / owner / scope: T0.16; worker/edit; root `package.json` script only unless a filename correction is required.
  - Action: add the omitted release-path tests that are genuinely part of candidate/release truth.
  - Success: script names every required existing test exactly once and JSON remains valid.

- [ ] **T0.18 — Add an ancestry behavior test.**
  - Depends / owner / scope: T0.16; worker/edit; nearest release candidate/binding test only; no implementation change.
  - Action: create a temporary Git graph test proving accepted ancestry and rejected unrelated/text-only SHA evidence; include a shallow-clone case if supported.
  - Success: new test fails against the current insufficient verifier for the intended reason and does not depend on network access.

- [ ] **T0.19 — Implement real ancestry verification.**
  - Depends / owner / scope: T0.18; worker/edit; exact release verifier/helper and its test only.
  - Action: verify ancestry from Git objects when available and emit a precise shallow-clone skip reason otherwise.
  - Success: T0.18 passes; unrelated commits fail; a genuine shallow clone reports a bounded justified skip rather than a false pass.

- [ ] **T0.20 — Run the completed release-path gate.**
  - Depends / owner / scope: T0.17 and T0.19; worker; no edits.
  - Action: run `npm run test:release-path`.
  - Success: command exits zero and output states whether ancestry was verified or skipped with reason.

- [ ] **T0.21 — Map visual source changes to baselines.**
  - Depends / owner / scope: T0.01; worker/read; changed UI/CSS files, visual manifest, and modified PNG paths; write report only.
  - Action: identify which changed source surface is expected to affect each modified baseline.
  - Success: every modified baseline is mapped to a source change or marked unexplained; no image is accepted by assumption.

- [ ] **T0.22 — Reproduce visual baselines in the pinned renderer.**
  - Depends / owner / scope: T0.21; worker; approved pinned Linux visual environment; only generated comparison artifacts.
  - Action: run the repository visual gate without updating baselines.
  - Success: receipt records renderer identity and exact pass/diff set; generated artifacts remain outside source unless explicitly reviewed.

- [ ] **T0.23 — Decide baseline ownership.**
  - Depends / owner / scope: T0.21 and T0.22; coordinator/owner; may approve source-plus-baseline pair but must not silently overwrite.
  - Action: accept each explained diff, reject it, or assign a focused UI correction task.
  - Success: every modified PNG and manifest entry has a recorded owner decision; no unexplained baseline remains in the candidate.

- [ ] **T0.24 — Add failing cookie-origin tests.**
  - Depends / owner / scope: T0.01; worker/edit; `apps/web/tests/hosted-boundaries.test.mjs` and nearest existing cookie tests only.
  - Action: test report and account-deletion flash cookies for valid HTTPS, valid HTTP local use, missing origin, and malformed hosted origin.
  - Success: tests prove hosted missing/malformed configuration fails closed and fail before the production fix.

- [ ] **T0.25 — Centralize the cookie origin decision.**
  - Depends / owner / scope: T0.24; worker/edit; `apps/web/lib/supabase/config.ts` or the existing origin owner plus `report-actions.ts` and `data-actions.ts`; no unrelated cookie refactor.
  - Action: expose one fail-closed origin helper and make both flash-cookie writers use it.
  - Success: T0.24 passes; report and account-deletion cookies share the same decision; save-cookie semantics are unchanged unless explicitly covered.

- [ ] **T0.26 — Verify all hosted cookie boundaries.**
  - Depends / owner / scope: T0.25; worker; no edits.
  - Action: run the focused boundary tests and web typecheck.
  - Success: commands exit zero and assertions cover `Secure`, `HttpOnly`, and `SameSite` for affected cookies.

- [ ] **T0.27 — Remove the runbook’s `rg` requirement.**
  - Depends / owner / scope: T0.01; worker/docs edit; only the exact command block in `docs/operations/free-public-alpha-runbook.md`.
  - Action: replace the nonportable `rg` step with a standard-tool equivalent while preserving matching semantics.
  - Success: command can run on a clean standard macOS/Linux shell and the surrounding instructions remain accurate.

- [ ] **T0.28 — Align the deployment Node requirement.**
  - Depends / owner / scope: T0.01; worker/docs edit; `docs/operations/hosted-alpha-deploy.md`, `apps/web/package.json`, and directly conflicting README sentence only.
  - Action: make documentation state the actual reviewed engine floor/runtime without changing package engines.
  - Success: no deployment doc contradicts `apps/web` engine/runtime requirements.

- [ ] **T0.29 — Clarify technical versus human dual control.**
  - Depends / owner / scope: T0.01; worker/docs edit; hosted deployment/worker runbook wording only.
  - Action: state that one human using two test credentials proves mechanics only and cannot authorize real participant publication.
  - Success: both owner-pilot and external-pilot rules are explicit and consistent with worker credential separation.

- [ ] **T0.30 — Run the complete candidate validation ladder.**
  - Depends / owner / scope: T0.15, T0.20, T0.23, T0.26, T0.27, T0.28, and T0.29; worker; no edits.
  - Action: run the repository-required root, web, hosted-boundary, privacy, visual, and release-path checks from the coherent candidate.
  - Success: every required command exits zero with zero cancellations; receipt separates commands not run and why.

- [ ] **T0.31 — Review candidate scope and evidence.**
  - Depends / owner / scope: T0.30; coordinator; inspect full diff, untracked files, test receipts, and audit disposition; no automatic edits.
  - Action: confirm every changed file belongs to the live owner-pilot candidate and every P0 criterion has evidence.
  - Success: coordinator records `APPROVED`, or creates bounded revision tasks for every rejected file/criterion.

- [ ] **T0.32 — Freeze the exact candidate and initialize the ledger.**
  - Depends / owner / scope: T0.31 approved; coordinator/owner; Git commit and ledger creation only.
  - Action: commit the approved coherent candidate, record SHA/tree/branch/remotes without secrets, and initialize the plan-key-to-Orca-ID ledger.
  - Success: clean candidate SHA is immutable, independently resolvable, and no unrelated dirty owner files are included.

### Phase 1 microtasks — topology and safety decisions

- [ ] **T1.01 — Extract nonnegotiable provider requirements.**
  - Depends / owner / scope: T0.32; worker/read; hosted deploy/runbooks, package engines, worker README, Supabase config; report only.
  - Action: list required runtimes, schedules, secrets, callbacks, logs, backup, rollback, limits, and forbidden provider behaviors.
  - Success: each requirement cites a current repository file/section and contains no provider recommendation.

- [ ] **T1.02 — Research compatible web-host options.**
  - Depends / owner / scope: T1.01; worker/research; official current provider docs only; report only.
  - Action: compare at most three hosts against the T1.01 web requirements, plan limits, cost, private access, Node runtime, logs, and rollback.
  - Success: matrix marks pass/fail/unknown with official links and does not select or provision a provider.

- [ ] **T1.03 — Research compatible worker/scheduler options.**
  - Depends / owner / scope: T1.01; worker/research; official current provider docs only; report only.
  - Action: compare at most three server-side scheduled runtimes for Node, secret injection, singleton execution, pause/resume, logs, and rollback.
  - Success: matrix marks pass/fail/unknown and distinguishes the worker host from the web host.

- [ ] **T1.04 — Record Supabase organization, region, and plan constraints.**
  - Depends / owner / scope: T1.01; coordinator/owner read-only account inspection; no project creation.
  - Action: identify the approved organization, candidate region, plan limits, pause/backup behavior, and cost boundary.
  - Success: non-secret decision inputs are recorded; unavailable or paid-only requirements are explicit.

- [ ] **T1.05 — Resolve the provider topology gate.**
  - Depends / owner / scope: T1.02, T1.03, and T1.04; owner decision gate; write decision record only.
  - Action: choose web host, worker host/scheduler, Supabase org/region/plan, hostname approach, cost ceiling, and owners.
  - Success: no provider placeholder remains; rejected options and reasons are recorded; no resource is provisioned yet.

- [ ] **T1.06 — Enumerate owner-only access mechanisms.**
  - Depends / owner / scope: T1.05; worker/research; chosen host/Supabase official docs and local threat model; report only.
  - Action: describe at most three enforceable allow/deny mechanisms and their effect on OAuth callbacks, health checks, and anonymous catalog access.
  - Success: options include recovery/break-glass and prove that `noindex` is not treated as authentication.

- [ ] **T1.07 — Write the access allow/deny test plan.**
  - Depends / owner / scope: T1.06; worker/docs; plan/ledger decision attachment only.
  - Action: define one approved-identity path, one unapproved-identity path, signed-out behavior, callback behavior, and evidence to capture.
  - Success: every path has a binary expected result and can be tested without exposing credentials.

- [ ] **T1.08 — Resolve the owner-only access gate.**
  - Depends / owner / scope: T1.06 and T1.07; owner decision gate.
  - Action: select the access mechanism, approved identities, and recovery path.
  - Success: selection names the exact control owner and preserves GitHub OAuth callback reachability without opening the product.

- [ ] **T1.09 — Build the identity and role inventory.**
  - Depends / owner / scope: T1.08; coordinator/owner; write redacted role labels only.
  - Action: name role labels for owner participant, disposable isolation users, worker runtime, test approver, test executor, secret custodians, incident owner, and rollback owner.
  - Success: no credential or account identifier is stored; every privileged action has one accountable role.

- [ ] **T1.10 — Classify dual-control evidence.**
  - Depends / owner / scope: T1.09; owner decision gate.
  - Action: record whether two real humans are available; otherwise mark approval/execution as a single-human technical rehearsal.
  - Success: external invitation and real participant publication remain blocked when two humans are unavailable.

- [ ] **T1.11 — Decide owner-pilot retention and backup destination.**
  - Depends / owner / scope: T1.05 and T1.09; owner decision; no backup performed.
  - Action: choose pilot-data retention, log retention/redaction, encrypted off-host destination, encryption-key custodian, restore owner, and deletion deadline.
  - Success: every duration and owner is concrete, and secrets remain outside the plan/ledger.

- [ ] **T1.12 — Write the incident stop-action sheet.**
  - Depends / owner / scope: T1.05, T1.08, and T1.09; worker/docs; hosted operations doc or decision attachment only.
  - Action: list exact owner actions to stop sign-in, pause worker, disable web deployment, rotate each credential class, restore, and notify.
  - Success: each incident class has an owner, first action, verification, and resume gate.

- [ ] **T1.13 — Inventory runtime variables by component.**
  - Depends / owner / scope: T1.01; worker/read; `.env.example`, build preflight, Supabase clients, worker config, docs; report only.
  - Action: list exact variable names and classify each as web-public, web-server, worker-secret, database/operator, or local-test.
  - Success: every code-read variable appears once with its owning component; values are never read or printed.

- [ ] **T1.14 — Approve the secret and preview matrix.**
  - Depends / owner / scope: T1.13 and T1.05; coordinator/owner decision.
  - Action: assign storage/injection owner for every secret class and state which preview environments remain intentionally unconfigured.
  - Success: no server-only value is assigned to the web/browser; production credentials cannot enter an unisolated preview.

- [ ] **T1.15 — Approve the Phase 1 decision packet.**
  - Depends / owner / scope: T1.05, T1.08, T1.10, T1.11, T1.12, and T1.14; coordinator review.
  - Action: verify topology, access, identities, retention, incident, environment, cost, and stop decisions against the definition of done.
  - Success: packet is `APPROVED` with no placeholders, or remote provisioning remains blocked with exact unresolved decisions.

### Phase 2 microtasks — remote Supabase, web, access, OAuth, and recovery

- [ ] **T2.01 — Verify provider CLI/account readiness.**
  - Depends / owner / scope: T1.15; coordinator/read-only; chosen provider and Supabase status commands only; no resource changes.
  - Action: confirm required CLIs, authenticated accounts, selected organizations, and permission levels without printing tokens.
  - Success: each required provider is reachable under the intended owner and missing permission is recorded as a blocker.

- [ ] **T2.02 — Create the dedicated Supabase project.**
  - Depends / owner / scope: T2.01; owner/coordinator external change; chosen organization, project name, region, and plan only.
  - Action: create exactly one owner-pilot project and store its database password in the approved secret store.
  - Success: non-secret project reference, region, plan, creation time, and owner match T1.15; no credential appears in terminal output or ledger.

- [ ] **T2.03 — Link the exact clean candidate.**
  - Depends / owner / scope: T2.02; coordinator external/local config; exact T0.32 checkout and Supabase link state only.
  - Action: link the clean candidate to the new project without pushing config or migrations.
  - Success: `supabase migration list --linked` reaches the intended project; checked-in local-only `supabase/config.toml` is not pushed.

- [ ] **T2.04 — Compare local and remote migration lists.**
  - Depends / owner / scope: T2.03; worker/read-only linked metadata; report only.
  - Action: compare every local migration filename/version with linked remote history.
  - Success: report identifies exact pending/applied/unexpected versions; any unexpected remote migration blocks T2.05.

- [ ] **T2.05 — Dry-run the linked migration push.**
  - Depends / owner / scope: T2.04 clean; coordinator external read/preflight; no schema mutation.
  - Action: run the documented linked dry-run from the exact candidate.
  - Success: dry-run exits zero and proposes only reviewed pending migrations; receipt contains versions but no connection secret.

- [ ] **T2.06 — Apply the reviewed migrations.**
  - Depends / owner / scope: T2.05 approved; coordinator external mutation; linked Supabase migrations only.
  - Action: apply exactly the dry-run-approved migration set once.
  - Success: command exits zero; linked history contains every expected version once and no unreviewed version.

- [ ] **T2.07 — Generate and compare remote API types.**
  - Depends / owner / scope: T2.06; worker; generated temporary file outside repo and tracked `apps/web/lib/supabase/database.types.ts` comparison; no overwrite.
  - Action: generate linked `api` types to a temp path and compare byte-for-byte with the candidate artifact.
  - Success: comparison is identical; mismatch creates a focused regeneration/review task rather than overwriting source.

- [ ] **T2.08 — Verify exposed schemas and grants.**
  - Depends / owner / scope: T2.06; worker/read-only database metadata through approved connection; report only.
  - Action: confirm only intended PostgREST schemas and grants for `anon`, `authenticated`, and `service_role`.
  - Success: `private` is not exposed; grants match migrations; report contains object names/booleans, not connection details.

- [ ] **T2.09 — Run anonymous remote RLS checks.**
  - Depends / owner / scope: T2.08; worker/live verification; anonymous public client and disposable public-safe rows only.
  - Action: test allowed catalog reads and denied private/lifecycle reads.
  - Success: expected reads succeed, forbidden reads fail without data leakage, and disposable rows are identified for cleanup.

- [ ] **T2.10 — Run two-identity remote RLS checks.**
  - Depends / owner / scope: T2.08; coordinator/worker supervised; disposable synthetic auth identities and private rows only.
  - Action: create two isolated test identities through the approved server-side test path and attempt cross-account reads/writes.
  - Success: each identity can access only its own rows; all cross-account operations fail; no browser credential is granted service-role authority.

- [ ] **T2.11 — Clean remote RLS test data.**
  - Depends / owner / scope: T2.09 and T2.10; coordinator external mutation; exact disposable IDs from receipts only.
  - Action: remove the synthetic identities and rows through supported cleanup paths.
  - Success: zero matching test identities/rows remain and cleanup query contains no broad wildcard or unvalidated target.

- [ ] **T2.12 — Create the web project without production variables.**
  - Depends / owner / scope: T1.15 and T2.06; owner/coordinator external change; chosen web provider/project only.
  - Action: connect the approved repository/root directory and runtime but leave production and preview credentials unset.
  - Success: project exists under the correct owner, points to `apps/web`, uses the approved Node runtime, and has no Supabase secret.

- [ ] **T2.13 — Configure reviewed web variables.**
  - Depends / owner / scope: T2.12 and T1.14; coordinator external change; production environment only.
  - Action: set the exact site URL, public Supabase URL/key, private-alpha release/indexing values, and approved non-secret support setting.
  - Success: variable names match T1.14; no service-role/database/worker/operator secret is present; previews remain unconfigured.

- [ ] **T2.14 — Deploy the exact web candidate.**
  - Depends / owner / scope: T2.13; coordinator external deploy; exact T0.32 SHA only.
  - Action: invoke the recorded provider deployment command once.
  - Success: deployment completes with provider ID, HTTPS URL, timestamp, and reported commit equal to T0.32.

- [ ] **T2.15 — Verify deployed commit and health.**
  - Depends / owner / scope: T2.14; worker/read-only live HTTP/provider metadata.
  - Action: independently compare provider revision metadata to T0.32 and call the deployed health route.
  - Success: revision matches exactly; health returns the expected ready contract/status and no identifier or secret.

- [ ] **T2.16 — Verify private headers and indexing.**
  - Depends / owner / scope: T2.14; worker/read-only live HTTP.
  - Action: inspect `robots.txt`, page metadata, `X-Robots-Tag`, CSP, HSTS, nosniff, referrer, permissions, frame, cache, and `connect-src` behavior.
  - Success: private-alpha indexing is denied; only the exact Supabase origin is allowed where required; every expected header has a recorded value.

- [ ] **T2.17 — Create/configure the GitHub OAuth application.**
  - Depends / owner / scope: T2.14; owner external change; approved GitHub owner/app only.
  - Action: configure the exact homepage and Supabase provider callback with device flow disabled; store the client secret only in the approved secret store/Supabase path.
  - Success: non-secret app ID/name and callbacks are recorded; secret never enters repo, ledger, shell history, screenshots, or web provider.

- [ ] **T2.18 — Configure hosted Supabase Auth.**
  - Depends / owner / scope: T2.17; owner/coordinator external change; selected Supabase Auth settings only.
  - Action: set exact site/callback URLs, enable GitHub, and disable unintended anonymous, email/password, magic-link, and redirect paths per approved design.
  - Success: dashboard/config receipt matches T1.08 and deploy runbook; no local `config push` is used.

- [ ] **T2.19 — Verify the approved OAuth path.**
  - Depends / owner / scope: T2.18; owner/manual live browser; approved non-operator identity only.
  - Action: pass the access gate, sign in through GitHub, reach the callback, verify session/profile creation, sign out, and sign in again.
  - Success: every transition uses the deployed origin, callback normalizes correctly, and no operator privilege is present.

- [ ] **T2.20 — Verify the denied identity path.**
  - Depends / owner / scope: T2.18; coordinator/owner live verification; unapproved test identity or clean denied context only.
  - Action: attempt to enter/sign in through the exact deny path from T1.07.
  - Success: access is denied before protected product data is available; no profile/session is created; failure is bounded and recoverable.

- [ ] **T2.21 — Scan the deployed web secret boundary.**
  - Depends / owner / scope: T2.14 and T2.19; worker/read-only built assets, HTML, response headers, provider variable names/logs; no secret values.
  - Action: check for service-role markers, database URLs/passwords, OAuth secrets, private paths, and credential canaries.
  - Success: zero forbidden canaries appear; any hit blocks the phase and identifies the exact artifact without echoing the secret.

- [ ] **T2.22 — Create the encrypted backup input.**
  - Depends / owner / scope: T2.06 and T1.11; coordinator external read; root-only temporary directory outside repo.
  - Action: export the reviewed schema-and-data backup without writing plaintext into the project.
  - Success: dump completes; permissions are restricted; inventory and checksum exist; terminal/ledger omit connection details and data content.

- [ ] **T2.23 — Encrypt and transfer the backup off-host.**
  - Depends / owner / scope: T2.22; owner/coordinator; approved encryption tool/key and destination only.
  - Action: encrypt the dump, verify ciphertext checksum, transfer it to the approved off-host destination, and confirm presence.
  - Success: off-host encrypted object is verifiable; key remains with its custodian; no plaintext copy persists outside the controlled temp directory.

- [ ] **T2.24 — Restore and verify in isolation.**
  - Depends / owner / scope: T2.23; coordinator external mutation; disposable isolated restore target only.
  - Action: decrypt in a root-only temp location, restore, and verify migration history, expected row counts/digests, RLS, and database integrity.
  - Success: all checks pass on the isolated target and the receipt contains only bounded metadata/checksums.

- [ ] **T2.25 — Remove recovery-test residue.**
  - Depends / owner / scope: T2.24; coordinator destructive but bounded; exact disposable target and temporary plaintext files only.
  - Action: validate target IDs/paths, delete the disposable restore target, and remove plaintext backup material.
  - Success: encrypted off-host backup remains; disposable target and plaintext files are absent; no broad path or unresolved variable was used.

- [ ] **T2.26 — Approve the Phase 2 remote foundation.**
  - Depends / owner / scope: T2.07, T2.08, T2.11, T2.15, T2.16, T2.19, T2.20, T2.21, and T2.25; coordinator review.
  - Action: map evidence to remote data, private deployment, authentication, access, secret, and recovery criteria.
  - Success: phase is `APPROVED` with exact receipts or worker deployment stays blocked with bounded revisions.

### Phase 3 microtasks — remote worker and operations

- [ ] **T3.01 — Inventory worker runtime requirements.**
  - Depends / owner / scope: T2.26; worker/read; `apps/worker/package.json`, README, `process-once.mjs`, operation checks, root scripts, migrations/runbook; report only.
  - Action: list entry command, Node/package needs, required variable names, egress, working directory, version tuple, and forbidden web sharing.
  - Success: report cites exact sources and contains no secret values or deployment proposal.

- [ ] **T3.02 — Define the worker deployment artifact.**
  - Depends / owner / scope: T3.01 and T1.05; worker/docs/config edit only if an existing provider manifest location is approved; otherwise decision attachment.
  - Action: specify exact source SHA, install/build/start command, runtime, artifact/root, health/version proof, and rollback artifact.
  - Success: a fresh runtime can execute the documented command without relying on untracked/local-only files.

- [ ] **T3.03 — Configure worker secrets.**
  - Depends / owner / scope: T3.02 and T1.14; coordinator external change; worker production environment only.
  - Action: inject only approved server-side Supabase and operator/runtime values from the secret store.
  - Success: required variable names are present, values are not printed, and web/preview environments remain unchanged.

- [ ] **T3.04 — Deploy the worker artifact.**
  - Depends / owner / scope: T3.03; coordinator external deploy; exact T0.32 artifact only; schedule disabled.
  - Action: deploy the worker runtime without starting recurring processing.
  - Success: provider deployment ID/version matches T0.32, process can start in bounded check mode, and no queue item is claimed.

- [ ] **T3.05 — Verify worker/web credential separation.**
  - Depends / owner / scope: T3.04; worker/read-only provider metadata/config names and web asset scan.
  - Action: prove worker-only variables are absent from web runtime/build and public variables are sufficient for web.
  - Success: zero worker/service-role/operator secret names or values appear in the web surface; report does not reveal values.

- [ ] **T3.06 — Create the disabled schedule.**
  - Depends / owner / scope: T3.04; coordinator external change; one scheduler definition only.
  - Action: create the approved cadence/trigger in disabled state with the exact worker command.
  - Success: schedule definition, timezone, command, owner, and disabled state match T1.05.

- [ ] **T3.07 — Verify concurrency and idempotency configuration.**
  - Depends / owner / scope: T3.06; worker/read-only schedule/runtime and worker code.
  - Action: confirm singleton/concurrency policy, claim lease, operation UUID use, retry, provider deferral, and dead-letter boundaries.
  - Success: each boundary maps to code/config evidence; any missing provider singleton control creates a focused task before enablement.

- [ ] **T3.08 — Verify schedule pause and resume.**
  - Depends / owner / scope: T3.06; coordinator external change; schedule enabled/disabled state only, no queue data.
  - Action: enable, confirm next-run visibility without waiting for work, disable, and confirm no run remains scheduled.
  - Success: both transitions are observable and reversible; schedule ends disabled.

- [ ] **T3.09 — Verify worker log redaction.**
  - Depends / owner / scope: T3.04; worker/read-only bounded dry/check output and provider logs.
  - Action: run a non-mutating worker/operations check and scan logs for credentials, raw source, provider bodies, private IDs, and paths.
  - Success: logs contain only bounded operational fields; any leak blocks schedule enablement.

- [ ] **T3.10 — Configure worker alert routing.**
  - Depends / owner / scope: T3.09 and T1.12; coordinator external change; chosen alert rules/recipient only.
  - Action: create alerts for command failure, queue age, retry/dead-letter, scheduler failure, and database error.
  - Success: each alert has threshold, recipient, first action, and test method; no raw submitted content is included.

- [ ] **T3.11 — Submit one synthetic remote queue item.**
  - Depends / owner / scope: T3.07, T3.09, and T3.10; coordinator/live mutation; one reviewed harmless public source only.
  - Action: create exactly one queue item through the supported participant/API path and record its opaque test reference privately.
  - Success: one queued item exists with exact immutable coordinates and no second matching item.

- [ ] **T3.12 — Enable one scheduled processing window.**
  - Depends / owner / scope: T3.11; coordinator external schedule change; one bounded run window.
  - Action: enable the schedule, observe one invocation, then disable it after the controlled item leaves queued state.
  - Success: one invocation is recorded, schedule returns disabled, and no unrelated item is claimed.

- [ ] **T3.13 — Verify exactly-once terminal processing.**
  - Depends / owner / scope: T3.12; worker/read-only operator queue/receipt paths.
  - Action: inspect the synthetic submission, worker run, audit, grade, transition, claim, and operation receipts.
  - Success: item reaches the expected terminal/review state once; no duplicate worker run or publication exists; version tuple matches migrations.

- [ ] **T3.14 — Verify provider-deferral and retry boundaries.**
  - Depends / owner / scope: T3.13; worker/test or controlled live simulation approved by coordinator; no broad queue mutation.
  - Action: exercise read-only budget stop or a controlled retryable provider condition and inspect mutation/attempt behavior.
  - Success: pre-claim deferral does not mutate; post-claim deferral returns safely to queued without consuming an audit attempt; otherwise phase blocks.

- [ ] **T3.15 — Prove a controlled failure alert.**
  - Depends / owner / scope: T3.10; coordinator controlled failure; synthetic item/runtime only.
  - Action: induce one harmless known failure, verify nonzero/alert/log behavior, then remove the fault.
  - Success: intended alert reaches the named recipient, log is bounded/redacted, queue state is recoverable, and healthy check returns afterward.

- [ ] **T3.16 — Clean synthetic worker data.**
  - Depends / owner / scope: T3.13, T3.14, and T3.15; coordinator bounded mutation; exact synthetic IDs only.
  - Action: remove or terminalize test rows through supported lifecycle/cleanup paths and reconcile queue counts.
  - Success: zero synthetic items/receipts/users remain where cleanup contract requires; no manual SQL rewrite of authority rows.

- [ ] **T3.17 — Rehearse web rollback.**
  - Depends / owner / scope: T3.16; coordinator external deploy change; current and recorded prior immutable web revisions only.
  - Action: roll back to the known-good web revision and run health/private-header smoke.
  - Success: origin serves the prior revision with passing smoke and no environment/secret drift.

- [ ] **T3.18 — Rehearse worker rollback.**
  - Depends / owner / scope: T3.16; coordinator external deploy change; current and prior worker revisions; schedule disabled.
  - Action: roll the worker back, confirm version and migration compatibility, then restore the reviewed candidate with schedule still disabled.
  - Success: both revision transitions are recorded, no queue item is processed, and final worker version is the intended candidate.

- [ ] **T3.19 — Run the post-rollback operational smoke.**
  - Depends / owner / scope: T3.17 and T3.18; worker/read-only live health/operations checks.
  - Action: verify web health, private headers, worker version, schedule state, queue summary, and alert health.
  - Success: all checks pass, schedule remains disabled until owner pilot, and no test residue exists.

- [ ] **T3.20 — Approve the Phase 3 authority path.**
  - Depends / owner / scope: T3.05, T3.07, T3.09, T3.13, T3.14, T3.15, T3.16, and T3.19; coordinator review.
  - Action: map evidence to remote scheduling, exactly-once, secret separation, alert, cleanup, and rollback criteria.
  - Success: phase is `APPROVED`, or owner self-pilot remains blocked with exact revision tasks.

### Phase 4 microtasks — live owner self-pilot

- [ ] **T4.01 — Prepare the owner-pilot session sheet.**
  - Depends / owner / scope: T3.20; worker/docs; redacted session/evidence template only.
  - Action: list the exact deployed origin, candidate reference, allowed test identities by role label, workflow order, screenshots/status evidence, cleanup targets, and emergency stop actions.
  - Success: sheet contains no credentials/private identifiers and every T4 task has one evidence slot.

- [ ] **T4.02 — Verify approved signed-out entry.**
  - Depends / owner / scope: T4.01; owner/manual browser; approved access context, signed out.
  - Action: open the private origin without a product session and record the expected access-gate/catalog behavior.
  - Success: approved context reaches only the intended signed-out surface and no private/account data is visible.

- [ ] **T4.03 — Verify unapproved entry denial.**
  - Depends / owner / scope: T4.01; coordinator/owner; clean unapproved context only.
  - Action: attempt the exact deny path without reusing an approved access session.
  - Success: request is denied before protected product data or OAuth session creation; evidence contains no denied identity metadata.

- [ ] **T4.04 — Capture live private/security headers.**
  - Depends / owner / scope: T4.02; worker/read-only HTTP.
  - Action: capture robots/indexing, CSP, HSTS, nosniff, referrer, permissions, frame, cache, cookie, and `connect-src` results for representative routes.
  - Success: values match Phase 2 and any drift is an explicit blocker before login.

- [ ] **T4.05 — Complete owner GitHub sign-in and sign-out.**
  - Depends / owner / scope: T4.02 and T4.04; owner/manual browser; approved non-operator identity.
  - Action: sign in, confirm landing/account identity state without recording metadata, sign out, and confirm session cookies clear.
  - Success: callback stays on deployed origin, non-operator account is created, and sign-out removes authenticated access.

- [ ] **T4.06 — Test catalog browse and search.**
  - Depends / owner / scope: T4.05; owner/manual browser; `/skills` and one search only.
  - Action: find a relevant skill using the normal interface without operator tools.
  - Success: results use remote catalog data, query/navigation behave correctly, and fixture fallback is absent.

- [ ] **T4.07 — Inspect one skill’s trust evidence.**
  - Depends / owner / scope: T4.06; owner/manual browser; one detail, audit, and grade route.
  - Action: inspect source version, provenance, license, audit findings, and provisional grade boundary.
  - Success: displayed evidence is version-bound, bounded, letterless where provisional, and contains no internal/private fields.

- [ ] **T4.08 — Save one skill.**
  - Depends / owner / scope: T4.07; owner/manual browser; one save mutation.
  - Action: save the inspected skill and open the account saved projection.
  - Success: saved state persists after navigation/refresh and appears only in the owner account.

- [ ] **T4.09 — Unsave the skill.**
  - Depends / owner / scope: T4.08; owner/manual browser; one unsave mutation.
  - Action: remove the saved skill and revisit the saved projection.
  - Success: item disappears, mutation feedback is truthful, and catalog/public state is unchanged.

- [ ] **T4.10 — Submit the authority-path test source.**
  - Depends / owner / scope: T4.05; owner/manual browser; one reviewed public repository/full commit/canonical `SKILL.md` path.
  - Action: submit the exact immutable source intended to proceed through worker and operator processing.
  - Success: exactly one owner-visible queued submission is created with the expected safe coordinates/status.

- [ ] **T4.11 — Create and withdraw a separate queued submission.**
  - Depends / owner / scope: T4.10; owner/manual browser; a second harmless exact test coordinate only.
  - Action: create a distinct queued row, view it, withdraw it through the supported owner action, and leave T4.10 untouched.
  - Success: second row becomes `withdrawn`, first remains eligible for processing, and no public projection is created for the withdrawn row.

- [ ] **T4.12 — Verify owner submission status isolation.**
  - Depends / owner / scope: T4.10 and T4.11; owner/manual browser; account submissions routes only.
  - Action: inspect both rows and attempt no operator action.
  - Success: statuses are truthful, only owner-safe fields appear, and no other account’s submission is visible.

- [ ] **T4.13 — Export owner account data.**
  - Depends / owner / scope: T4.12; owner/manual browser; one account export.
  - Action: download/export the account data before worker processing and inspect only its schema/bounded fields.
  - Success: export contains the owner’s allowed profile/save/submission data, excludes another identity and server-only fields, and is stored temporarily outside the repo.

- [ ] **T4.14 — Verify session persistence and reauthentication.**
  - Depends / owner / scope: T4.13; owner/manual browser.
  - Action: sign out, confirm protected pages require authentication, sign back in, and reopen T4.10 status.
  - Success: session boundary is enforced and owner state persists after reauthentication.

- [ ] **T4.15 — Repeat the critical participant path at 390px.**
  - Depends / owner / scope: T4.14; owner/manual or supervised native browser; 390px viewport; no new submission.
  - Action: repeat sign-in state check, browse/search, detail/evidence, save/unsave, submissions view, and export entry point.
  - Success: no overlap/horizontal overflow/blocking control defect occurs and screenshots cover every critical screen.

- [ ] **T4.16 — Enable processing for the owner submission.**
  - Depends / owner / scope: T4.10, T4.15, and T3.20; coordinator external schedule change; exact T4.10 row only.
  - Action: enable one bounded worker window, observe claim of the intended row, then disable schedule after processing.
  - Success: intended row alone advances, schedule returns disabled, and one worker receipt is created.

- [ ] **T4.17 — Inspect the processed submission through operator reads.**
  - Depends / owner / scope: T4.16; coordinator/worker read-only service-role operator commands.
  - Action: run operations check, bounded queue list, and exact submission inspect without mutation.
  - Success: output is redacted/bounded, shows the expected audit/grade/worker state, and exposes no submitter/actor IDs, claim IDs, raw source, or private digests.

- [ ] **T4.18 — Verify license and collision prerequisites.**
  - Depends / owner / scope: T4.17; coordinator/operator review; exact source/license/collision target only.
  - Action: review immutable license evidence and collision state, then record the exact intended decisions without executing publication.
  - Success: decisions bind the exact repository/commit/path/version and unsupported/ambiguous evidence blocks the next task.

- [ ] **T4.19 — Exercise publisher authorization dual-control mechanics.**
  - Depends / owner / scope: T4.18; owner/coordinator; two approved test operator credentials; exact authorization envelope only.
  - Action: create approval with one test identity and execute the byte-identical action with the distinct test identity.
  - Success: approval is exact, short-lived, single-action, and executor-distinct; ledger labels single-human rehearsal when applicable.

- [ ] **T4.20 — Exercise collision review dual-control mechanics.**
  - Depends / owner / scope: T4.18 and T4.19; owner/coordinator; exact collision decision only.
  - Action: approve and execute the reviewed collision outcome with distinct test credentials.
  - Success: receipt binds the exact target/outcome/operation UUID and rejects altered or expired envelopes.

- [ ] **T4.21 — Publish the safe test listing.**
  - Depends / owner / scope: T4.19 and T4.20; owner/coordinator; exact T4.10 publication only.
  - Action: approve and execute publication through supported commands; do not edit database rows manually.
  - Success: one publication receipt and one current public pointer exist for the exact reviewed version; replay is idempotent.

- [ ] **T4.22 — Verify live public evidence projections.**
  - Depends / owner / scope: T4.21; worker/read-only live web/API.
  - Action: inspect catalog, detail, audit, and grade projections for the published test listing.
  - Success: all routes bind the exact version and expose only bounded metadata, safe reason codes, and valid provisional grading.

- [ ] **T4.23 — Exercise a no-action report.**
  - Depends / owner / scope: T4.22; coordinator/owner; disposable reporter identity and one report target.
  - Action: submit a suspicious-listing report, verify owner-only history, then dual-control a no-action disposition.
  - Success: catalog state remains unchanged, report receipt is immutable/idempotent, and other accounts cannot see reporter-private history.

- [ ] **T4.24 — Exercise confirmed report enforcement.**
  - Depends / owner / scope: T4.23; owner/coordinator; a separate disposable report/operation UUID on the same test listing.
  - Action: approve and execute a confirmed disposition that invokes the documented quarantine or revocation path.
  - Success: exact version is atomically hidden/changed, original enforcement outcome is retained for replay, and unrelated versions are untouched.

- [ ] **T4.25 — Exercise receipt-backed lifecycle restore.**
  - Depends / owner / scope: T4.24; owner/coordinator; exact test listing and supported restore command only.
  - Action: approve and execute the allowed restore action using prior receipts.
  - Success: lifecycle history is preserved, public projection returns only when policy allows, and restore is exact-target/idempotent.

- [ ] **T4.26 — Verify invalid and malformed submission handling.**
  - Depends / owner / scope: T4.14; worker/live browser/API with harmless invalid inputs; no valid row creation.
  - Action: try invalid commit, noncanonical path, malformed cursor/limit, and bounded unsafe input cases.
  - Success: inputs are rejected with safe errors, form values are preserved where intended, and no database row/secret leak occurs.

- [ ] **T4.27 — Verify duplicate and cooldown behavior.**
  - Depends / owner / scope: T4.14; worker/live; one already-used safe coordinate and test identity.
  - Action: repeat the exact request within the documented duplicate/cooldown boundary.
  - Success: response and mutation state match contract; no duplicate authority row is created.

- [ ] **T4.28 — Verify live rate limits.**
  - Depends / owner / scope: T4.04; worker/live bounded requests below a safe test ceiling.
  - Action: exercise the private-alpha catalog/API limiter without load testing or provider abuse.
  - Success: expected threshold returns bounded `429`/`Retry-After`; normal traffic recovers; no other user is affected.

- [ ] **T4.29 — Verify cross-account isolation.**
  - Depends / owner / scope: T4.12; coordinator/worker supervised; disposable isolation identity and exact owner row references only.
  - Action: attempt to read/mutate owner profile, saves, submissions, reports, and export through ordinary authenticated paths.
  - Success: all cross-account operations fail without disclosing row existence/content; disposable identity’s own data still works.

- [ ] **T4.30 — Verify unauthorized and expired operator actions.**
  - Depends / owner / scope: T4.19; coordinator/worker; exact test envelopes only.
  - Action: attempt an ordinary-user operator call, altered envelope, expired approval, same-identity execution, and replay with changed payload.
  - Success: every attempt fails before consequential mutation and returns bounded errors.

- [ ] **T4.31 — Review live logs and artifacts for leakage.**
  - Depends / owner / scope: T4.16 through T4.30; worker/read-only web/worker/provider logs, browser assets, screenshots, and receipts.
  - Action: scan for secret canaries, OAuth/account metadata, raw skill/license bodies, claim/private IDs, provider bodies, and private paths.
  - Success: zero forbidden material appears; any positive hit blocks cleanup/approval and is reported without reproducing the value.

- [ ] **T4.32 — Delete the owner-pilot account.**
  - Depends / owner / scope: T4.25 and T4.31 clean; owner/manual browser; exact owner-pilot account only.
  - Action: invoke self-deletion and confirm sign-out/cookie clearing.
  - Success: account becomes inaccessible, active session is cleared, and deletion returns the documented safe state.

- [ ] **T4.33 — Verify deletion and test-data cleanup.**
  - Depends / owner / scope: T4.32; coordinator read-only then bounded cleanup; exact test identities/rows/artifacts only.
  - Action: verify private rows and covered derived public projections are removed; clean remaining disposable isolation/report/test artifacts through supported paths.
  - Success: zero in-scope test accounts/rows remain, authorized retention exceptions are documented, and temporary export/screenshots with private data are securely removed.

- [ ] **T4.34 — Assemble the owner-pilot release receipt.**
  - Depends / owner / scope: T4.03 through T4.33; worker/docs; implementation ledger/evidence index only.
  - Action: map every definition-of-done item to exact local/CI/deployed/remote-authenticated/restore/rollback evidence or a blocker.
  - Success: receipt contains candidate/deploy/migration/worker references, timestamps, bounded screenshots/status summaries, cleanup, and no secrets/private data.

- [ ] **T4.35 — Triage observed owner-pilot defects.**
  - Depends / owner / scope: T4.34; coordinator review; issue/ledger entries only.
  - Action: classify each observed problem as P0, P1, accepted limitation, or post-pilot debt; define smallest fix and affected re-verification tasks.
  - Success: every defect has evidence, severity, owner, next action, and no vague “polish later” blocker.

- [ ] **T4.36 — Record the owner go/no-go decision.**
  - Depends / owner / scope: T4.35; owner decision gate.
  - Action: select `continue owner pilot`, `fix and repeat`, or `stop`; explicitly keep external invitations/indexing/public launch unauthorized.
  - Success: decision cites evidence, remaining risks, next bounded slice, and exact live gates that must be rerun.

### Phase 5 microtasks — optional external private pilot

- [ ] **T5.01 — Confirm two independent human operators.**
  - Depends / owner / scope: T4.36 chooses future external pilot; owner decision; role labels only.
  - Action: assign separate human approver and executor roles with separate credentials and backup coverage.
  - Success: no person holds both consequential roles for participant work; otherwise Phase 5 remains blocked.

- [ ] **T5.02 — Approve external-pilot policy and retention.**
  - Depends / owner / scope: T5.01; owner/legal-policy decision; versioned policy artifacts only.
  - Action: approve governing jurisdiction, age/geography, retention/deletion/legal hold, terms, acceptable use, privacy, takedown/appeal, and effective date.
  - Success: one exact policy version/URL/digest is approved and linked from submission/participant surfaces.

- [ ] **T5.03 — Verify public support and security intake.**
  - Depends / owner / scope: T5.02; owner/manual live web; support/security/appeal routes only.
  - Action: open each route signed out and test the intended intake/handoff without submitting sensitive content.
  - Success: routes are reachable, owned, and consistent with policy; no private-repository-only URL is treated as public support.

- [ ] **T5.04 — Reverify invitation and incident gates.**
  - Depends / owner / scope: T5.02 and T5.03; coordinator/live verification.
  - Action: rerun approved/unapproved access, OAuth, restore, rollback, alert, and stop-action checks against the exact external-pilot deployment.
  - Success: all pass with current evidence; any failure blocks recruitment.

- [ ] **T5.05 — Assign the five participant seats.**
  - Depends / owner / scope: T5.04; owner/manual; contact consent stored separately.
  - Action: assign User A browse/evidence, User B save/return, User C grade interpretation, Author A publication follow-through, and Author B submission/status.
  - Success: exactly five named privately contacted participants are mapped to roles before invitations; no open signup is used.

- [ ] **T5.06 — Run User A session.**
  - Depends / owner / scope: T5.05; owner/manual observation; one redacted session receipt.
  - Action: run the uncoached browse/evidence task and collect bounded structured feedback.
  - Success: completion/coaching/time/routes/failure codes are recorded without identity, query strings, raw prompts, or feedback text.

- [ ] **T5.07 — Run User B session.**
  - Depends / owner / scope: T5.05; owner/manual observation; one redacted session receipt.
  - Action: run the uncoached save/leave/return task.
  - Success: completion/coaching/time/routes/failure codes are recorded and saved-state behavior is directly observed.

- [ ] **T5.08 — Run User C session.**
  - Depends / owner / scope: T5.05; owner/manual observation; one redacted session receipt.
  - Action: run the uncoached grade/trust-boundary interpretation task.
  - Success: participant can or cannot distinguish provisional letterless evidence; bounded outcome is recorded without personal content.

- [ ] **T5.09 — Run Author A session and follow-through.**
  - Depends / owner / scope: T5.05 and T5.01; participant plus two operators; one authorized public source.
  - Action: observe uncoached submission, pause timing during normal dual-control processing, then observe uncoached published-evidence inspection.
  - Success: both segments share one opaque session ID and no row is manually edited or auto-passed.

- [ ] **T5.10 — Run Author B session.**
  - Depends / owner / scope: T5.05; owner/manual observation; one authorized public source.
  - Action: observe uncoached submission and queued/review/final status interpretation without cross-account access.
  - Success: bounded session receipt records completion/coaching/status understanding and no private source is submitted.

- [ ] **T5.11 — Aggregate the external-pilot result.**
  - Depends / owner / scope: T5.06 through T5.10; worker/read-only receipts; aggregate report only.
  - Action: calculate completed, uncoached, median active time, workflow coverage, bounded failures, and unresolved blockers.
  - Success: PASS only if at least four of five finish uncoached, all mandatory workflows have uncoached coverage, and no disqualifying blocker remains.

- [ ] **T5.12 — Record the external-pilot decision.**
  - Depends / owner / scope: T5.11; owner decision gate.
  - Action: choose `PASS`, `REPEAT`, or `NO-GO` using the existing runbook criteria.
  - Success: decision cites aggregate evidence and explicitly states that public indexing, open signup, announcement, npm publication, and public alpha still require a separate review.

## Finding disposition register

The statuses below are deliberately outcome-based. **Defer** means “valid engineering debt, but not required to prove the live owner-pilot workflow.” **Reject** means the audit premise is not supported by the current design.

| Findings | Disposition | Reason and next action |
| --- | --- | --- |
| A1, A2 | Defer, with a targeted contract check | The proposed shared-primitives refactor is broad and high-blast-radius. Before public/package release, add a focused digest/redaction equivalence test and fix only demonstrated divergence. Do not make private-alpha deployment wait on a 10-step consolidation. |
| A3 | Defer | Important local-state hardening; it is not on the remote hosted participant path. Revisit before a broader local CLI release. |
| A4 | Defer until measured | An ancestry traversal optimisation has no demonstrated user-facing bottleneck. Benchmark first. |
| A5 | Post-alpha quick fix | A read command publishing a revision is a real semantic bug, but it does not block hosted testing. Fix in the next local-core maintenance slice with an assertion that no revision is published. |
| A6 | Reject as an immediate deletion task | “Unreachable” status values may be an incomplete future-state contract, not dead code. Do not narrow public types without a complete status-contract review. |
| A7, A8, A9, A10, A11 | Defer | Low-risk readability/startup cleanup; batch later only with focused tests. |
| B1 | **Do now** | Deployment-facing cookie security; Phase 0. |
| B2 | Defer | A large dashboard refactor adds regression risk and does not advance the hosted user path. Split only when changing a proven dashboard defect. |
| B3 | Defer except B1’s origin helper | Helper deduplication is cosmetic here. Keep semantic variants local until a repeated change justifies a shared utility. |
| B4 | Measure, then defer/fix | Explicit auth ownership is good, but first measure whether it causes material duplicate calls on deployed pages. Avoid a many-page churn before evidence. |
| B5 | Owner-pilot triage | If the owner encounters the fixture dashboard during the live pilot, make the demo trace clearly labelled; otherwise do not prioritise it over hosted workflow evidence. |
| B6 | Defer | Token consistency is polish, not a private-alpha blocker. |
| B7 | Defer | Hash-tab synchronization is a local-dashboard deep-link improvement. Add it only if pilot evidence shows the dashboard is part of the user workflow. |
| B8 | **Reject as a defect** | The two `SkillActionPanel` renderings are intentional responsive variants. Do not refactor them merely to get one source rendering; retain a responsive/accessibility regression check instead. |
| C1 | **Do now** | An untracked script referenced by the candidate build configuration is a candidate-breaking integrity failure; Phase 0. |
| C2 | Conditional / defer | Keep the allowlist change with the next reviewed package/release commit, but private hosted testing does not publish a tarball. |
| C3, C4 | **Do now** | A release gate that omits tests or verifies only text is untrustworthy; Phase 0. |
| C5 | **Do now** | Baselines must be owned and committed with the UI they represent before release evidence can be trusted. |
| C6 | **Do now** | Small portability fix that unblocks new operators; Phase 0. |
| D1, D5 | Replace with one release-receipt task | Do not hard-code historical SHA/PR text from an old shallow clone. At deploy time, regenerate provenance from the exact commit, remote refs, and deployment receipt. |
| D2 | **Do now** | One-line operational clarity; Phase 0. |
| D3 | Owner cleanup, not implementation work | The untracked “ 2” files belong to the current dirty worktree. Delete/archive only with the owner’s confirmation; do not mix this into a release change. |
| D4 | Defer | Documentation completeness has no private-alpha impact. |
| D6 | **Do now** | A procedural dual-control residual is relevant as soon as real operators act; Phase 0. |
| D7 | Defer to release-security policy | Lockfiles plus `npm ci` already mitigate this. Review dependency diffs in the release process; do not churn versions or add a policy document solely for alpha. |

## Sequencing rules

- Do not provision or mutate a remote project until Phase 0 has a reproducible exact candidate.
- Do not deploy until Phase 1 has approved the web host, worker host, access gate, identities, secrets, limits, recovery owner, and stop controls.
- Do not enable GitHub OAuth until the owner-only access design is enforceable and its deny path is testable.
- Do not place a service-role, database, worker, operator, or backup secret in the web runtime.
- Do not begin the owner self-pilot until migrations/RLS, encrypted restore, remote worker scheduling, observability, and rollback have direct evidence.
- Do not treat a single-human two-credential rehearsal as operational dual control.
- Do not invite external participants until Phase 5 prerequisites pass; external recruitment is not required to complete this plan.
- Do not combine broad refactors with migration, deployment, or release-gate changes.
- Keep the current dirty worktree intact. Each Phase 0 commit must be narrowly scoped and independently reproducible.
- A local Supabase pass, CI pass, browser screenshot, pushed commit, deployment, remote-authenticated workflow, restore, and rollback are different evidence levels; record them separately.

## Stop conditions

Stop the current phase and record a blocker if any of the following occurs:

- the exact candidate cannot pass two isolated clean runs without failures or cancellations;
- an untracked/generated artifact is required to build or run the candidate;
- no approved provider topology or bounded-cost plan exists;
- an unapproved identity can enter the owner-pilot surface;
- the web bundle/runtime receives a service-role or other server-only credential;
- linked migrations, generated types, grants, or RLS differ from the reviewed candidate;
- two participant identities can access one another’s data;
- the encrypted backup cannot be restored and verified in isolation;
- the remote worker can double-process, cannot be paused, or leaks source/private data into logs;
- rollback cannot return web and worker services to the recorded known-good state;
- a secret, OAuth identifier, private path, raw skill body, or private user datum appears in the ledger, browser payload, screenshot, or public log.

## Suggested first implementation slice

Start the supervised Orca loop with **T0.01** only. After coordinator approval:

1. dispatch T0.02 and T0.03 as read-only tasks;
2. approve both, then dispatch T0.04;
3. run T0.05 and T0.06 sequentially, followed by coordinator classification T0.07;
4. if either run fails, follow only T0.08 through T0.11 before continuing;
5. after a repeatable green result, dispatch the remaining Phase 0 tasks in disjoint-file waves;
6. do not create any Phase 1 runtime task until T0.32 is coordinator-approved.

Never dispatch a parent `P` outcome. Never create all 141 tasks up front. The coordinator should create only currently approved-ready tasks so a `worker_done` cannot accidentally unlock unreviewed downstream work.
