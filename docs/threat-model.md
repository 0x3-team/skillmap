# Threat model

## Assets

- Local skill contents and paths
- Policy and curation receipts
- Source provenance records
- Hook configuration files
- Exported registry snapshots
- Redacted route, feedback, job, and revision receipts
- Loopback browser capability and CSRF tokens

## Trust boundaries

- `scan`, `doctor`, `route`, `graph`, `eval`, `status`, `export`, `import`, and `mcp` operate on local files.
- `sources check`, `sources diff`, and preview-only `sources update` can fetch explicit GitHub raw URLs for tracked source records.
- Hook installation mutates only the configured hook file and creates a backup.
- `skillmap dashboard` serves immutable packaged UI assets and a same-origin API over IPv4 loopback. It does not expose CORS and does not create a hosted session.

## Non-goals in v1

- No cloud upload
- No background daemon
- No runtime LLM calls
- No automatic source updates
- No automatic deletion of skills
- No write-capable MCP tools

## Main risks and controls

| Risk | Control |
| --- | --- |
| Hidden upload of skill content | No cloud service in v1; source network calls are explicit commands. |
| Skill script execution | Scan/doctor/route never execute skill scripts. |
| Overwriting local skill edits | Source updates are preview-only in personal V1; use `sources diff` and `sources review` instead of applying upstream content. |
| Risky upstream instruction changes | `external-risky-update` requires `sources diff` plus a state/hash-specific `sources review` receipt. |
| A browser diff exposes or executes local/upstream skill text | Diff is an explicit same-origin foreground action over one immutable snapshot; the response is no-store and bounded, text is escaped, and neither the connector nor browser persists it. The safe export and sync schemas exclude diffs. |
| Hook config corruption | Hook install is explicit, checks readiness before writing, and writes a timestamped backup. |
| Safe export leaks prompts, prompt-dependent hashes, bodies, paths, secrets, diffs, or receipts | Default export uses a strict allowlist plus a final privacy/secret scan, excludes exact eval artifact/dataset digests, and derives dashboard eval provenance only from the already-redacted projection; raw artifact export requires `--include-sensitive-local` and a mode-0600 target confined to `.skillmap/private-exports/` on Linux/macOS, while Windows fails closed before creating a target because POSIX mode bits do not establish a private ACL. |
| Export or dashboard payload is tampered after production | V2 consumers reconstruct canonical semantic JSON and reject a mismatched `payloadDigest` before use or archival. Exact serialized-byte integrity is a separate out-of-band `transportDigest`. |
| Unknown fields evade integrity coverage | V2 loaders reject unknown fields before digest verification; only exact top-level `payloadDigest`, `transportDigest`, and `transportMetadata` are excluded from the canonical projection. |
| Legacy export is mistaken for verified state | Version 1 imports are labeled `legacy-unverified`, remain archive-only, and preserve exact original bytes for rollback. |
| Local-sensitive export enters a share/sync path | Private export is marked non-shareable, confined by realpath, and private import requires `--acknowledge-sensitive-local`; dashboard and normal safe-export paths reject the sensitive flag. |
| Agent mutation through MCP | V1 MCP tools are read-only. |
| Cross-site browser request reaches the local API | A one-time bootstrap delivers capability and CSRF proofs in a fragment that is synchronously moved to origin-scoped `sessionStorage` and removed from the URL. Every non-health API call requires the capability header; mutations also require exact Host/Origin, same-site Fetch Metadata, and the CSRF header. Cookie-only replay is rejected and no CORS permission is emitted. |
| Browser workspace switch shows stale data under the wrong workspace ID | Workspace IDs are canonicalized on boot and history navigation; switching clears workspace-scoped caches before the selected workspace is rendered, including ambiguous response recovery. |
| Route or feedback storage grows without reads | Write-time admission enforces the route count/age cap; feedback has at most four deterministic slots per retained route and is pruned first with its route. |
| Prompt or secret is smuggled through feedback metadata | Outcome-bound reason enum, immutable selected-ID binding, revision inventory validation for expected/unsafe IDs, and hash-only idempotency persistence. |
| Event paths escape through a nested symlink | Every event/index/feedback write validates each ancestor and realpath containment under `.skillmap/events`; symlinks fail closed before write. |

## Evidence packet risks

| Risk | Control |
| --- | --- |
| Stale state is mistaken for current readiness | Evidence index records command date, checkout, branch, commit, and final `status --json`. |
| Dirty worktree hides unrelated changes | Baseline and final `git status --short --branch` are required evidence. |
| Misleading dry-run output is treated as publication | Evidence labels distinguish `package dry-run only` from `not published`. |
| Temporary hook smoke is treated as global install | Evidence labels require `not globally hooked` and record the hook target path. |
| Browser fixture mode is treated as real local readiness | Browser evidence records the URL, mode, snapshot source, and whether the dashboard is fixture-backed. |
