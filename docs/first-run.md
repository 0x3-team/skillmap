# First-run tutorial

This tutorial keeps SkillMap local-first and deterministic.

## 1. Install

SkillMap is not yet published from this worktree. Build it locally or install a
reviewed tarball. Keep every tarball you install so package rollback remains
possible.

macOS or Linux, from a maintainer checkout:

```bash
npm ci
mkdir -p artifacts/package
npm pack --pack-destination artifacts/package
npm install -g ./artifacts/package/skillmap-0.1.0.tgz
skillmap --version
skillmap --help
```

Windows PowerShell, from a maintainer checkout:

```powershell
npm ci
New-Item -ItemType Directory -Force .\artifacts\package | Out-Null
npm pack --pack-destination .\artifacts\package
npm install -g .\artifacts\package\skillmap-0.1.0.tgz
skillmap --version
skillmap --help
```

For a tarball supplied by a reviewer, replace the example path with the exact
reviewed `.tgz` path. Do not install a similarly named rebuild without comparing
its recorded SHA-256 digest.

## 2. Start the local application

```bash
skillmap dashboard
```

Open the one-time `127.0.0.1` query URL printed by the foreground command. The
connector redirects it to `/app` with a capability and CSRF proof in the URL
fragment. The first synchronous app module validates them, stores them only in
origin-scoped `sessionStorage`, and immediately removes both query and fragment
with `history.replaceState` before the first API request. API requests send the
capability header; mutations additionally send an exact loopback `Origin` and
CSRF header. SkillMap does not use authorization cookies. Do not copy, proxy, or
reuse the bootstrap URL, and do not bind the server to a network interface.

On `/app/workspaces`, choose one of these explicit modes:

- **Create new**: enter a path that does not exist, acknowledge creation, validate it, then confirm.
- **Select existing**: enter an existing non-symlink directory, validate its bounded metadata, then confirm.

The path is sent once to loopback for validation. The page drops it before confirmation and does not retain it in browser storage or receipts.

## 3. Approve roots and scan

In Onboarding:

1. Enter one real skill-root path, preferably an absolute path such as `/home/you/.agents/skills` (or the platform equivalent). A leading `~/` is expanded from the connector process home; other shell expansion is not performed.
2. Review the redacted directory label and explicitly approve the scope.
3. Run **Scan approved roots**.
4. Run **Structural doctor** and review its findings.

Approval does not execute scripts or mutate the root. A changed root later marks the workspace dirty; SkillMap does not silently rescan or recurate it.

The equivalent CLI path is:

```bash
skillmap init --root ~/.agents/skills --root ~/.codex/skills --dry-run
skillmap init --root ~/.agents/skills --root ~/.codex/skills
skillmap scan
skillmap doctor
skillmap status
```

Adjust the roots to the folders you actually use. `status` may report `attention required` on the first run. That is expected until policy, source, and credible eval evidence exists; follow `readinessPhase` and `nextActions` in order.

If legacy files are detected, the app requires an explicit migration receipt. If state is corrupt, automatic recovery is offered only for eligible derived corruption with safety-equivalent last-known-good state.

## 4. Review and curate

```bash
skillmap doctor
skillmap doctor --fix-plan
skillmap doctor-pack --summary
skillmap curate codex --prepare
```

Use your native agent to write `.skillmap/proposals/policy.yml` and `.skillmap/proposals/policy-rationale.md`, then ingest them:

```bash
skillmap curate codex --ingest .skillmap/proposals/policy.yml --rationale .skillmap/proposals/policy-rationale.md --model MODEL --dry-run
skillmap curate codex --ingest .skillmap/proposals/policy.yml --rationale .skillmap/proposals/policy-rationale.md --model MODEL --confirm
skillmap apply-policy --strict
```

Replace `MODEL` with the native-agent model you actually reviewed. SkillMap
records that value as user-reported provenance; it does not verify provider
identity.

## 5. Build graph and route

```bash
skillmap graph build
skillmap sources adopt --skill-id sk_LOCAL_ID --local --reason "Authored and maintained in this workspace."
skillmap sources adopt --skill-id sk_GITHUB_ID --repo OWNER/REPOSITORY --path skills/example --ref main
skillmap sources check
skillmap apply-policy --strict
skillmap graph build
skillmap graph explain frontend-design
skillmap route "make this dashboard calmer and verify mobile" --trace
```

`graph build` writes a derived view of the approved registry. It preserves an
existing routing approval only when the routing-critical state is unchanged; it
never creates routing approval on its own.

Create real evals before trusting readiness:

```bash
skillmap eval --file .skillmap/real-evals.json --min-count 150 --min-top1 0.80 --min-top3 0.92 --max-avoid-hits 0 --save-report
skillmap status
```

The local app reviews `eval-suite/v3` in ephemeral browser memory, computes the
canonical frozen-case, dataset, and payload digests, cross-checks qualified
skill IDs, and offers only approval-recorded historical baseline revisions.
Import creates an unapproved revision, so explicitly approve the intended
current routing state before running the suite. The isolated runner replays the
same frozen cases against the historical and current immutable registries;
quota, holdout, leakage, provenance, and baseline failures remain visible.
Legacy eval v2 is candidate-only migration input and import success is never
relabeled as release evidence.

Return to Route Lab and run two materially different prompts. A useful first check is that one produces a recommendation and an unrelated prompt safely abstains. The response must show the serving revision and `promptStored: false`; record structured feedback only after a real response.

## 6. Optional integrations

```bash
skillmap hook dry-run codex "make this UI less generic"
skillmap hook install codex --passive --dry-run
skillmap mcp manifest
skillmap export --redact-paths --output skillmap-export.json
```

Hook install is explicit and checks readiness before writing hooks. MCP is read-only in v1. Export/import stays local.

## Update, package rollback, workspace rollback, and uninstall

Package updates and workspace revisions are independent. Before updating, stop
the foreground dashboard with `Ctrl+C`, record `skillmap --version`, and keep the
currently installed tarball.

Update or roll back the globally installed package on macOS/Linux:

```bash
npm install -g ./artifacts/package/skillmap-NEW_VERSION.tgz
skillmap --version

# Package rollback uses the retained prior tarball.
npm install -g ./artifacts/package/skillmap-PRIOR_VERSION.tgz
skillmap --version
```

Windows PowerShell uses the same npm operation with Windows paths:

```powershell
npm install -g .\artifacts\package\skillmap-NEW_VERSION.tgz
skillmap --version

# Package rollback uses the retained prior tarball.
npm install -g .\artifacts\package\skillmap-PRIOR_VERSION.tgz
skillmap --version
```

If the package was installed project-locally, omit `-g` and run the command in
that project. A prior-version rollback cannot be proven until two reviewed
versioned tarballs exist; do not claim it from a reinstall of the same version.

Once both reviewed tarballs exist, run the exact two-version lifecycle gate
from this checkout. It rejects equal versions or equal tarball digests and
verifies the prior -> candidate -> prior -> candidate sequence while preserving
workspace state and the approved skill root byte-for-byte:

```bash
SKILLMAP_PRIOR_TARBALL=/absolute/path/skillmap-PRIOR_VERSION.tgz \
SKILLMAP_TEST_TARBALL=/absolute/path/skillmap-NEW_VERSION.tgz \
SKILLMAP_UPGRADE_ARTIFACTS=/absolute/path/upgrade-evidence \
  npm run test:upgrade-rollback:required
```

Without both variables, `npm run test:upgrade-rollback` writes or prints an
explicit `not-run` result. That result is not rollback evidence and keeps the
public-beta gate blocked.

Workspace rollback changes the selected immutable SkillMap revision, not the
installed CLI version:

```bash
skillmap state status --json
skillmap state rollback --target REVISION --expected-revision CURRENT --actor YOUR_NAME --reason "Reviewed rollback" --confirm
```

To remove a project-local hook first:

```bash
skillmap hook uninstall codex --dry-run
skillmap hook uninstall codex
```

After hook removal, uninstall with the same scope used for installation:

macOS or Linux:

```bash
npm uninstall -g skillmap
command -v skillmap >/dev/null && echo "SkillMap is still on PATH" || echo "SkillMap CLI removed"
```

Windows PowerShell:

```powershell
npm uninstall -g skillmap
if (Get-Command skillmap -ErrorAction SilentlyContinue) { "SkillMap is still on PATH" } else { "SkillMap CLI removed" }
```

For a project-local install, use `npm uninstall skillmap` in that project.
Uninstalling or reinstalling the package does not delete `.skillmap` or any
skill root. Archive or remove workspace state only after a separate manual
review; never make state deletion part of package uninstall.
