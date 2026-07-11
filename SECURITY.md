# Security Policy

SkillMap scans configured local agent-skill trees and writes revisioned local `.skillmap` artifacts. It never executes discovered skill scripts. Passive hook installation exists, but only through an explicit command after the routing-approval gate; global installation is never the default.

## Supported versions

The project is in private alpha. Security fixes apply to the current `main` branch.

## Reporting a vulnerability

While the repository is private, report issues directly to the repository owner. Do not include secrets, private skill bodies, token values, or private filesystem dumps in reports.

## Security model

SkillMap treats third-party skills as untrusted metadata until reviewed.

The packaged browser application is served by a foreground IPv4-loopback connector with one-time bootstrap authorization. Capability and CSRF proofs are delivered once in a URL fragment, retained only in that tab's origin-scoped `sessionStorage`, and sent as explicit API headers; SkillMap authorization cookies are not used. Exact Host/origin checks, no CORS permission, bounded request/response bodies, and no raw-prompt persistence further constrain the connector. There is no SkillMap cloud service in the alpha.

Risk indicators flagged by the doctor include:

- executable scripts
- malformed or recovered frontmatter
- duplicate skill names
- broad invocation descriptions
- oversized skill bodies
- symbolic links or unsupported filesystem entries
- traversal, excessive depth/count/bytes, and mid-read tree changes
- stale or unapproved workspace revisions

## Non-goals in alpha

- SkillMap does not prove a skill is safe.
- SkillMap does not sandbox external scripts.
- SkillMap does not validate every possible prompt-injection path.
- SkillMap does not upload skill content to a cloud service.
- SkillMap does not provide hosted identity, tenant isolation, or cloud synchronization in the alpha.
- SkillMap does not make a local browser session safe to expose through a reverse proxy or non-loopback bind.
