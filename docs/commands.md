# Commands

## `skillmap --version`

Prints the package product version without opening or mutating workspace state:

```bash
skillmap --version
```

## `skillmap init`

Creates starter `.skillmap` files. Use `--dry-run` first and pass the real roots you want SkillMap to govern.

```bash
skillmap init --root ~/.agents/skills --root ~/.codex/skills --dry-run
skillmap init --root ~/.agents/skills --root ~/.codex/skills
```

`init` writes `.skillmap/config.yml`, `.skillmap/identity.json`, `.skillmap/policy.yml`, and `.skillmap/real-evals.json`. The identity registry assigns a random opaque workspace UUID and a random root UUID to each approved real path. Absolute paths remain local and are never used as public identity. When `config.yml` exists, `scan` uses those configured roots unless `--root` or `--fixtures` is passed.

## `skillmap scan`

Scans configured skill roots and writes `.skillmap/inventory.json`.

```bash
skillmap scan --root ~/.agents/skills --json
skillmap scan --fixtures test/fixtures/basic --json
```

Inventory v2 uses `skillId = sk_ + base64url(sha256(identityVersion, rootId, normalizedRelativePath))`. Editing a skill keeps its `skillId` but changes `contentRevision`, which covers every regular file in the complete skill tree. Root escape, traversal, symbolic links, normalized-path collisions, and qualified-ID collisions fail closed or block readiness.

Scan and filesystem freshness share one fail-closed filesystem policy. Defaults allow at most 1,000 roots, 10,000 skills, 100,000 discovery entries, depth 32 per skill, 1,024 directories/4,096 entries/2,048 files per skill, 16 MiB per file, 1 MiB for `SKILL.md`, 64 MiB per skill tree, and 256 MiB across one workspace verification. Files are streamed into the content hash and checked again for device/inode/size/mode/mtime/ctime stability; they are not accumulated as one unbounded in-memory tree. Exceeding a limit aborts scan before a revision is published and makes freshness fail closed.

Moving a skill or changing its approved root changes `skillId`. `scan` records removed identities as tombstones and blocks a correlated move until it is reviewed. This history also covers delete-scan-add sequences; diagnostic `doctor --root` and `doctor --fixtures` scopes never overwrite the canonical inventory.

## `skillmap identity`

Inspects qualified identity blockers and records an explicit, revision-bound move adoption.

```bash
skillmap identity status --json
skillmap identity adopt-move --from sk_OLD --to sk_NEW --actor REVIEWER --reason "Reviewed the old and new full skill trees" --dry-run
skillmap identity adopt-move --from sk_OLD --to sk_NEW --actor REVIEWER --reason "Reviewed the old and new full skill trees" --confirm
skillmap identity approve-new --skill-id sk_NEW --actor REVIEWER --reason "Confirmed this is unrelated to removed identities" --dry-run
skillmap identity approve-new --skill-id sk_NEW --actor REVIEWER --reason "Confirmed this is unrelated to removed identities" --confirm
```

Use IDs from `identity status` or `.skillmap/inventory.json`. Ambiguous moves require choosing one historical source explicitly. If a replacement is genuinely unrelated, use `approve-new`; it clears only that target's possible-move blocker and never transfers a historical policy entry. A dry-run writes nothing. Move confirmation binds the target `contentRevision`, persists an adoption receipt, transfers an existing exact policy-v2 entry, preserves the absence of a denied shadow entry, and clears only the matching blocker. If a removal and replacement were observed in separate scans, the tombstone still permits the same reviewed command. Legacy inventories cannot route; run `skillmap scan` first.

## `skillmap status`

Summarizes trust state across inventory, policy, effective registry, curation receipts, eval reports, SkillGraph, and source freshness.

```bash
skillmap status
skillmap status --json
```

Status includes `readinessPhase` in JSON and human output. Warnings include every unresolved duplicate-name group, fixture root, unmatched policy entry, stale effective registry, missing or stale curation receipt, non-release eval evidence, and missing/partial source coverage. `nextActions` is ordered by the first readiness blocker rather than listing later steps prematurely. Eval v2 and legacy count-only reports are candidate/demo evidence. For `eval-run/v3`, status reads receipt-verified immutable suite/report bytes, independently resolves durable routing approvals for the run and historical baseline revisions, replays the exact frozen cases against both effective registries, and rejects stale or self-asserted composition, holdout, leakage, provenance, baseline, metric, threshold, or digest claims.

## `skillmap state`

Owns the immutable workspace revision boundary. Mutations use one fenced writer lock, fsync a complete revision, and atomically replace the current pointer only after validation.

```bash
skillmap state status --json
skillmap state migrate --confirm
skillmap state import-legacy --confirm
skillmap state rollback --target REVISION --expected-revision REVISION --actor REVIEWER --reason "Reviewed rollback" --confirm
skillmap state recover --confirm
skillmap state repair-projections --confirm
```

`migrate` is explicit and preserves legacy files as read-only projections. `import-legacy` is the reviewed compatibility path when an older tool changed an allowlisted projection. `rollback` creates a new monotonic revision rather than moving the pointer backward. `recover` is allowed only for derived corruption when canonical, raw, and routing-safety digests still match the recorded last-known-good revision. Canonical divergence and unapproved safety changes make route, hook, MCP, and API consumers abstain.

## `skillmap dashboard`

Starts the foreground local product backend and versioned embedded UI:

```bash
skillmap dashboard
skillmap dashboard --port 4173
skillmap dashboard --json
```

The process binds only to `127.0.0.1` and prints a single-use bootstrap URL. The redirect delivers capability and CSRF proofs in a fragment; the app moves them to that port-origin's `sessionStorage`, removes the fragment, and authenticates APIs with explicit headers. The connector sets no SkillMap authorization cookies, rejects untrusted Host/Origin/Fetch Metadata, and retains no raw route prompt. Browser mutations are limited to named API use cases and allowlisted jobs; arbitrary shell commands and skill-root writes are not exposed. Stop with `Ctrl-C`. Background mode is intentionally unavailable until lifecycle and recovery semantics are separately approved.

## `skillmap doctor`

Analyzes the current inventory and writes doctor reports under `.skillmap`.

```bash
skillmap doctor
skillmap doctor --json
```

## `skillmap doctor-pack`

Creates a native-agent curation packet for Codex or Claude.

```bash
skillmap doctor-pack
skillmap doctor-pack --summary
skillmap doctor-pack --max-skills 80
```

Prefer `skillmap curate codex --prepare` before pasting curation context into a native agent so SkillMap can record provenance.

## `skillmap curate`

Prepares and ingests manual native-agent curation.

```bash
skillmap curate codex --prepare
skillmap curate codex --ingest .skillmap/proposals/policy.yml --rationale .skillmap/proposals/policy-rationale.md --model codex-sota --dry-run
skillmap curate codex --ingest .skillmap/proposals/policy.yml --rationale .skillmap/proposals/policy-rationale.md --model codex-sota --confirm
```

Model identity is user-reported unless a future provider-verified integration is added.

## `skillmap apply-policy`

Applies a reviewed policy to create an effective registry and graph. It does not edit source skills.

```bash
skillmap apply-policy --policy .skillmap/policy.yml --dry-run
skillmap apply-policy --policy .skillmap/policy.yml --strict
skillmap apply-policy --policy .skillmap/policy.yml --strict --allow-fixtures
```

Without `--policy`, `apply-policy` reads the active v1/v2 policy pointer. `--strict` blocks fixture roots, unmatched policy entries, and every unresolved duplicate inventory name, including duplicate names omitted from policy. Policy v1 is dual-read for rollback but can never resolve duplicate variants. Both versions deny routing for an identity/name with no reviewed entry; policy v2 additionally requires an exact `skillsById` entry, while an intentionally absent noncanonical shadow remains denied.

## `skillmap policy`

Migrates policy v1 to qualified policy v2 without overwriting the original policy or any skill root.

```bash
skillmap policy migrate --dry-run
skillmap policy migrate --confirm
skillmap policy status
skillmap policy select-canonical NAME --skill-id sk_ID --actor REVIEWER --reason "Compared every current variant" --dry-run
skillmap policy select-canonical NAME --skill-id sk_ID --actor REVIEWER --reason "Compared every current variant" --confirm
skillmap policy rollback --confirm
```

Migration performs a fresh scan. Unique v1 names map to their exact `skillId`; duplicate and unmatched names remain unresolved. A canonical decision records every compared `contentRevision`, the selected `skillId`, actor, reason, timestamp, and a canonical decision digest. Editing any compared variant invalidates the decision and blocks implicit routing again. Noncanonical variants stay inspectable and can be routed only through the structured `--skill-id` selector when policy/frontmatter permits it.

Confirmed migration writes immutable v2, migration-receipt, and exact-byte v1 rollback artifacts under `.skillmap/policies/`, then atomically replaces only `.skillmap/policies/active.json`. Rollback verifies the exact source digest and changes only that active pointer. Dry-runs do not change inventory, policy artifacts, pointers, or roots.

The local Policies view derives five revision-bound queues from the exact
inventory and active policy: duplicate, unmatched, uncovered, explicit-only,
and blocked. It first creates a read-only proposal through
`POST /api/v1/policy/proposals`; the operator then accepts, holds, or rejects it
through `POST /api/v1/policy/decisions`. Accept can select a canonical variant,
set an exact skill tier, or retire an entry that no longer matches inventory.
Hold and reject deliberately leave blocking readiness unchanged. Every outcome
writes a hash-bound `PolicyReviewDecisionV1` under
`.skillmap/policies/reviews/` and publishes an unapproved revision; only the
separate reviewed apply step may advance routing approval.

## `skillmap graph`

Builds, queries, explains, and exports graph data.

```bash
skillmap graph build
skillmap graph query frontend
skillmap graph explain "make this UI less generic"
skillmap graph duplicates
skillmap graph conflicts
skillmap graph export --format mermaid
skillmap graph export --format json
```

## `skillmap route`

Routes a prompt against the effective registry and emits traceable recommendations.

```bash
skillmap route "review this PR for auth bugs" --trace
skillmap route "use the reviewed qualified variant" --skill-id sk_ID --trace
skillmap route --hook --prompt "review this PR for auth bugs"
```

`--hook` emits compact text suitable for Codex `UserPromptSubmit` additional context. It reads the Codex hook JSON event from stdin when no `--prompt` is provided. Duplicate display names are never selected by array order. Implicit routing uses only a receipt-valid canonical variant; a shadowed variant requires the exact structured `--skill-id` argument.

## `skillmap eval`

Runs prompt-to-skill route evals from a JSON eval file.

```bash
skillmap eval --file .skillmap/real-evals.json
skillmap eval --file .skillmap/real-evals.json --min-count 150 --min-top1 0.80 --min-top3 0.92 --max-avoid-hits 0 --save-report
```

When `--file` is omitted, SkillMap uses `.skillmap/real-evals.json` if it exists and otherwise fails clearly. It never silently falls back to fixture evals. Release-authoritative input is `skillmap.eval-suite` schema version 3: cases use qualified `sk_…` identities, one `primaryCaseType` (`explicit`, `implicit-natural`, `multi-skill`, or `negative-near-miss`), `train` or frozen `holdout` membership, and per-case label provenance. The suite binds canonical frozen-case/dataset/payload digests and an approval-recorded historical baseline `RevisionRef`; the report is prompt-free and records deterministic current/baseline replay receipts.

Release-counted evidence requires at least 100 implicit-natural, 25 multi-skill, and 25 negative/near-miss cases, with at least 20% and 30 frozen holdout cases. Explicit cases remain useful regressions but do not count toward release top-1/top-3. Implicit/multi prompts may not name an expected display name or exact alias or copy its source description. Fixed release thresholds remain top-1 at least 0.80, top-3 at least 0.92, and zero avoid hits, plus baseline non-regression and an improvement. Import creates an unapproved revision; only an isolated replay from the exact approved current revision can create v3 release evidence, and its eval-only publication carries routing approval only when the routing-safety digest is unchanged. Eval v2 and legacy/untyped suites remain candidate/demo evidence regardless of count or score.

## `skillmap sources`

Tracks external skill provenance and checks for update state.

```bash
skillmap sources list
skillmap sources adopt writing-great-skills --repo mattpocock/skills --path skills/writing-great-skills
skillmap sources adopt --skill-id sk_ID --repo mattpocock/skills --path skills/writing-great-skills
skillmap sources adopt my-local-skill --local --reason "Authored and maintained in this workspace."
skillmap sources check
skillmap sources diff writing-great-skills
skillmap sources update writing-great-skills --dry-run
skillmap sources review writing-great-skills --decision hold --reason "Reviewed upstream state; holding for now."
```

Update application is preview-only in personal V1; even `--confirm` is rejected. No source skill files are overwritten. Use `sources adopt SKILL --local --reason TEXT` to create an explicit local-authored classification receipt; it is never inferred from an empty registry. A duplicate display name is rejected as ambiguous and requires `--skill-id`; new source and review receipts bind the qualified ID, local variant, and content revision. `sources check` persists coverage as `not-configured`, `not-applicable`, `partial`, or `covered` by matching source records to inventory variants. Zero records with a non-empty inventory are `not-configured`; unknown, mismatched-path, or out-of-inventory records cannot inflate coverage. Review receipts store the source state plus relevant current/upstream hashes, so `status` warns again when the reviewed state changes.

## `skillmap hook`

Dry-runs or manages a passive Codex hook.

```bash
skillmap hook dry-run codex "make this UI less generic"
skillmap hook install codex --passive --dry-run
skillmap hook install codex --passive
skillmap hook install codex --passive --force
skillmap hook uninstall codex --dry-run
skillmap hook uninstall codex
```

`install` checks `skillmap status` and blocks unless status is `ok` with readiness phase `ready`. A blocked `--dry-run` remains inspectable but returns `blocked: true`, `wouldInstall: false`, `changed: false`, and a refusal summary. Use `--force` only after manual review or in controlled tests; force remains an explicit override and does not relabel readiness as green. Defaults to project-local `.codex/hooks.json`. Use `--global` for `~/.codex/hooks.json` only after deliberate review. Use `--config PATH` for a controlled config file.

## Doctor repair planning

```bash
skillmap doctor --fix-plan
```

Writes `.skillmap/reports/fix-plan.md`, a review-only repair plan grouped by severity. It does not edit, move, delete, or update skills.

## Export and import

```bash
skillmap export --output skillmap-export.json
skillmap export --redact-paths --output skillmap-export.json
skillmap export --include-sensitive-local --output .skillmap/private-exports/local-backup.json
skillmap export --dashboard-snapshot --redact-paths --output .skillmap/dashboard-snapshot.json
skillmap import skillmap-export.json --dry-run
skillmap import skillmap-export.json --confirm
skillmap import .skillmap/private-exports/local-backup.json --acknowledge-sensitive-local --dry-run
```

Default `export` writes a strict `skillmap.safe-export` v2 allowlist. It includes qualified skill metadata and aggregate status/eval/source evidence, but never raw prompts, skill bodies, paths, diffs, free-text reasons, hook text, or sensitive receipts. `--redact-paths` is a deprecated compatibility no-op; the default is already shareable-redacted. Every envelope has a canonical `payloadDigest`; the command separately reports a byte-exact `transportDigest`.

The local-sensitive archival bundle requires `--include-sensitive-local`, an explicit output inside `.skillmap/private-exports/`, realpath containment, and mode `0600`. It includes config, opaque identity, exact policy-v2 pointer/revision/migration/rollback files, and the legacy artifact set. It is marked local-sensitive/non-shareable, cannot be combined with dashboard export, and imports remain archive-only rather than automatically restoring state.

`export --dashboard-snapshot` creates a strict v2 `skillmap.dashboard-snapshot` envelope. It uses the opaque workspace ID, records input and workspace revision digests, omits raw prompts and bodies, and reports `payloadDigest`. The dashboard recomputes the canonical digest before freshness or connector logic. A legacy v1 snapshot is demo-only and blocked; a tampered v2 snapshot returns `integrity-failed` and is never treated as merely stale.

`import` verifies strict v2 schema, privacy, compatibility, and `payloadDigest` before any write. Dry-run is the default. Confirmed imports archive exact incoming bytes and a conflict report under `.skillmap/imports/`; they never activate or overwrite registry artifacts. Legacy v1 is labeled `legacy-unverified`. Local-sensitive import additionally requires `--acknowledge-sensitive-local`.

## Read-only MCP access

```bash
skillmap mcp manifest
skillmap mcp call route_prompt --prompt "make this UI less generic"
skillmap mcp call search_skills --query frontend
skillmap mcp serve
```

The v1 MCP surface is read-only. It exposes compact registry queries for agents without giving them mutation tools.

Read-only tools:

- `route_prompt`
- `search_skills`
- `show_skill`
- `show_skillgraph`
- `doctor_summary`
- `source_status`

## Related docs

- [First-run tutorial](first-run.md)
- [Host compatibility](host-compatibility.md)
- [Troubleshooting](troubleshooting.md)
- [Threat model](threat-model.md)

## Source review receipts

```bash
skillmap sources review ask-matt --decision hold --reason "Upstream renamed local flow commands; hold until local skill set is reconciled."
```

`review` records that a non-clean source state has been manually reviewed for the current source-status state. `status` continues to warn when the state changes or when a non-clean source record has no review receipt.
