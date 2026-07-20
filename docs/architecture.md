# Architecture

SkillMap separates judgment from runtime routing.

```text
Native chat agent = semantic curation and user preference handling
CLI = scan, persist, policy, status, SkillGraph, route, eval, sources
Hook = tiny passive route advisory
```

The tool keeps two graph views:

- Raw graph: every skill found on disk.
- Effective graph / SkillGraph: raw inventory after policy tiers, supersedes, overlaps, exclusions, source provenance, and curation/eval context.

Runtime routing uses the effective graph only. The hook path must remain deterministic and must not call an LLM or network service.

## Personal-product topology

```text
configured skill roots (read-only discovery)
                 |
                 v
CLI commands -> shared use cases -> WorkspaceStateStore -> immutable revisions
     |                  |                    |
     |                  |                    +-> current / last-known-good pointers
     |                  +-> route, status, jobs, sources, evals, policy
     |
     +-> passive hook and read-only MCP

packaged local-app ES modules <-> 127.0.0.1 same-origin connector <-> shared use cases
public/docs Next.js build ------------------------------------------^ (no shared .next runtime)
```

The local application is a versioned static asset bundle shipped in the npm package. `skillmap dashboard` serves that bundle and the API from one foreground IPv4-loopback process. It never reuses the public Next.js `.next` directory. The public/docs build may demonstrate fixture or verified redacted snapshot data, but it is not the local workspace backend.

The connector owns only transport concerns: one-time bootstrap exchange, capability/CSRF/origin checks, strict request schemas, bounded bodies, ETags, stable revision reads, redacted response projection, and graceful shutdown. CLI, hook, MCP, and API call the same domain services rather than reimplementing routing or readiness rules.

## Revision and routing model

Every mutation creates a new fsynced immutable revision and then atomically advances a pointer under a fenced writer lock. A revision manifest binds canonical intent, raw truth, derived read models, semantic effective state, and the exact file set. Legacy `.skillmap` files are compatibility projections, not independent routing authority.

Readers capture one pointer and validate one manifest before composing a response. Routing uses only the exact explicitly approved revision. A last-known-good revision is eligible only for derived corruption or an unapproved derived-only current revision whose canonical and raw routing-safety digests are identical. Canonical divergence or a safety change makes route, hook, MCP, and API consumers abstain.

Rollback copies a verified ancestor into a new monotonic revision; it never moves a pointer backward. Browser rollback remains explicitly revision-bound and does not silently approve the new revision for routing.

## Jobs and operational ledgers

Allowlisted maintenance jobs are anchored by an idempotency transaction before becoming executable. Slow work runs in an isolated staging workspace outside the writer lock, then uses a compare-and-swap publication with an exact expected revision and a final cancellation check inside the lock. Restart reconciliation distinguishes committed publication from retryable failure or cancellation.

Observed route events are separate from eval evidence and modeled estimates. Their ledger is redacted, date-partitioned, write-time bounded, and indexed only by derived hashed anchors. Feedback is outcome-bound to a retained event and immutable revision; raw prompts, free comments, paths, and caller idempotency values are not stored.

Each retained event has a stable, authenticated `/traces/:routeId` permalink
resolved from the bounded derived index back to its canonical public ledger
record. Activity also reports a page-bounded feedback backlog and outcome
counts. Policy review uses short-lived in-memory proposals bound to the current
revision, active policy digest, queue fingerprint, skill/content revision, and
reviewed action; durable accept/hold/reject receipts are canonical intent, but
never silently approve routing.

CodeGraph is useful for developing SkillMap, but SkillGraph is a separate domain graph for agent capabilities rather than source-code symbols.

## V1 local sharing and agent access

SkillMap v1 keeps cross-agent access local-first:

- `skillmap export` creates a portable registry snapshot.
- `skillmap import` reports conflicts and archives imported snapshots without overwriting active artifacts.
- `skillmap mcp serve` exposes the six fixed local metadata/routing tools through the official MCP SDK and a 64 KiB-bounded stdio adapter. A protocol-neutral runtime owns approved-revision reads and explicit MCP redaction; SDK lifecycle/notifications/list/call dispatch remain outside the domain layer. Successful results carry the same canonical envelope in structured and text forms, and total frames stay below 512 KiB.

Discovery selection, ordering, and revision/query-bound cursors are shared with the loopback API while each surface keeps an explicit projection. A deterministic revision-bound postings index has `reference`, `shadow`, and `indexed` strategies with a two-revision cache; the full scanner remains the semantic oracle and rollback path. This local foundation does not add Streamable HTTP, remote auth, skill-body loading, or a hosted MCP endpoint.

General mutation remains CLI-explicit. The MCP surface intentionally has no write/update/install tools in v1.

The browser API exposes only narrowly reviewed local mutations such as root/workspace approval, revision-bound policy/source decisions, allowlisted jobs, explicit cancellation, and reviewed rollback. It does not expose arbitrary commands, paths in receipts, global hook installation, source-tree writes, or write-capable MCP.

Settings can export a client-composed diagnostics document capped at 64 KiB.
It contains compatibility, revision, readiness, and freshness receipts only;
path-like or private-key metadata fails closed before download. Updates remain
manual with no background network check, and uninstall preserves `.skillmap`
history and all skill roots unless the operator separately removes them.

Source-diff preview is the deliberate exception to the otherwise redacted
summary-only browser surface: an authenticated loopback operator can request a
bounded, escaped, response-only comparison containing local-sensitive lines.
The backend performs the network read outside the workspace and writer lock,
binds it to one immutable upstream commit and one current workspace revision,
then discards the stage. Diff text is not a canonical artifact, revision,
event, cached snapshot, export field, or sync field.
