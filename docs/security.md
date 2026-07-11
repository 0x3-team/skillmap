# Security Notes

SkillMap treats installed skills as untrusted local metadata.

## What SkillMap reads

- `SKILL.md` frontmatter and body size
- skill paths and roots
- presence of `scripts/`, `references/`, and `assets/`
- local `.skillmap` policy/eval/source files
- external source metadata only when `sources` commands are explicitly used

## What SkillMap does not do

- execute skill scripts
- upload skill content
- call an LLM in route or hook paths
- call the network during scan, doctor, route, graph, eval, or hook paths
- delete source skills
- install hooks without an explicit command
- overwrite downloaded skills during source update preview

Scan and freshness use the same bounded, streaming full-tree hasher. Depth, directory, entry, file, per-file, `SKILL.md`, per-tree, and workspace-byte limits fail closed before untrusted trees can be accepted or reported fresh.

## Local connector boundary

`skillmap dashboard` binds IPv4 loopback only. The browser receives a one-time query URL that redirects to `/app` with capability and CSRF proofs in the fragment. The first synchronous application code validates both proofs, stores them only in origin-scoped `sessionStorage`, and removes the fragment before the first API request. Every non-health API request sends the capability header; mutations also send the CSRF header and require the exact loopback origin and same-site fetch metadata. The connector emits no CORS permission and never sets SkillMap authorization cookies. It rejects cookie-only replay and expires legacy `skillmap_cap_<port>` and `skillmap_csrf_<port>` cookies without touching unrelated cookies. Workspace selection is a two-step, expiring validation receipt and never returns or caches the submitted directory path.

Route events are admitted under a serialized, write-time bounded ledger: at most 10,000 records and 90 retained UTC days. Feedback has one immutable slot for each of the four outcomes per retained route. It stores only outcome-bound machine codes, immutable-revision-qualified skill IDs, and a hash of the caller's idempotency key. Raw prompts, comments, paths, free-form reasons, and raw idempotency values are not persisted. Indexes are derived lookup aids and are rejected when their canonical public event is missing or invalid.

Route-detail lookup accepts only a UUID, resolves a bounded hashed index, and
then requires the canonical retained event to match before returning the exact
redacted contract. Policy proposal IDs are short-lived, process-local, capped,
and one-time after a successful decision. Durable policy review receipts bind
the expected revision, exact policy digest, queue fingerprint, qualified
identity/content revision where present, action, outcome, actor, and rationale
under a canonical digest. Actor and rationale are never projected back through
the connector response.

## Native-agent curation boundary

`skillmap curate codex --prepare` creates a local prompt packet. The user chooses whether to paste that packet into Codex or Claude. `curate --ingest` records user-reported model provenance and does not claim provider-verified model identity.

## Source update boundary

`skillmap sources check` is an explicit network-capable command when GitHub sources are tracked. `sources update` is preview-only in personal V1 and does not modify source skill files.

The local app's **Preview upstream diff** action is an explicit foreground,
network-capable read. The connector resolves one immutable GitHub snapshot,
compares it in an isolated temporary workspace, caps the response at 120 lines
and 500 characters per line, and verifies the current revision again before
responding. Diff lines can contain local-sensitive skill text. They are escaped
before rendering, returned with `Cache-Control: no-store`, cleared when the view
is replaced, and excluded from browser storage, route events, safe exports, and
future sync surfaces. A diff receipt never changes a skill root, persists a
comparison, records a review, or approves routing.

## Hook boundary

The Codex hook adapter is passive. It emits compact route context through `UserPromptSubmit` and does not block or rewrite prompts. Install defaults to project-local `.codex/hooks.json`; `--global` is deliberate opt-in.

`--force` may acknowledge a non-green product evidence gate only when the current routing state is already the exact explicitly approved revision. It cannot override missing or stale routing approval.

Codex may load matching hooks from multiple sources. Review installed hooks with `/hooks` and trust only definitions you recognize.

## Sensitive data

Doctor packs can contain local filesystem paths and skill descriptions. Do not paste them into untrusted external services unless you are comfortable exposing that metadata.

## Import/export and MCP boundaries

- `skillmap export` is safe-by-default. It writes a strict `skillmap.safe-export` v2 envelope containing allowlisted summaries, qualified skill metadata, and aggregate eval/source state. It does not copy raw artifact blobs.
- Safe exports omit raw prompts, skill bodies, absolute paths, diffs, free-text review reasons, sensitive receipts, and secrets. `--redact-paths` remains accepted as a deprecated safe no-op; safety no longer depends on remembering that flag.
- Shareable exports and dashboard snapshots also omit the exact eval artifact and dataset digests because hashes of prompt-bearing files can become offline equality or guessing oracles. Dashboard provenance binds a digest of the already-redacted eval projection instead.
- Every safe export carries a `payloadDigest` over canonical semantic JSON. `transportDigest` is reported out-of-band over the exact written bytes; it is not embedded as a self-digest.
- `skillmap import` verifies the strict v2 schema, privacy boundary, and `payloadDigest` before conflict analysis or any archive write. Verified imports remain archive-only and do not activate or overwrite workspace state.
- Legacy version 1 exports are `legacy-unverified`. Dry-run remains supported; confirmed import preserves the exact original bytes for review and rollback without activating them.
- Local-sensitive archival export requires the explicit `--include-sensitive-local` flag and an output confined by realpath to `.skillmap/private-exports/`. It includes identity and exact policy-v2 pointer/revision/migration/rollback state as well as legacy artifacts. These files are mode `0600`, marked `local-sensitive`, archive-only on import, and must never be shared or used by the dashboard/sync path.
- Importing a local-sensitive export requires `--acknowledge-sensitive-local`; integrity verification does not make sensitive contents shareable.
- `skillmap mcp` is read-only in v1. It can route, search, and summarize existing registry artifacts, but cannot update skills, install hooks, or mutate policy.

Canonical payload verification is semantic: object-key order and JSON formatting do not change `payloadDigest`, while a changed value or array order does. Unknown fields are rejected instead of being silently excluded from the digest projection. Only the exact top-level `payloadDigest`, optional `transportDigest`, and `transportMetadata` fields are excluded.

## Source review receipts

`skillmap sources review` records why a stale, risky, or unknown source state is accepted, explicitly ignored, or held at the currently installed tree. A hold means “keep the installed content; do not adopt this reviewed upstream tree,” so it can clear that exact review item without authorizing an update. External review receipts bind the current content revision and hashes plus the upstream full-tree manifest digest, content revision, and resolved commit. Any change to that state or immutable upstream tree makes `status` warn again.

## Personal V1 evidence handling

Personal V1 evidence is local by default. Use
`.skillmap/reports/personal-v1/evidence-index.md` as an index, not as a place to
paste raw skill bodies, raw prompt sets, secrets, or unredacted local paths.

Use explicit evidence labels so the packet cannot overstate the result:

- `validated locally`
- `browser verified`
- `package dry-run only`
- `not published`
- `not globally hooked`
- `blocked`

Package dry-runs do not publish anything. Hook smoke should use a temporary or
project-local hooks file and should not use `--global`.
