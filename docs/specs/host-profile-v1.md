# Host Profile v1

Status: Phase 0 frozen contract. Phase 1 exposes `not-tested` compatibility only. Canonical host profiles, compatibility workers, and host-specific grade receipts begin in Phase 4.

## Purpose

A host profile describes the observable environment in which a skill is parsed, selected, loaded, and allowed to use tools. Publisher compatibility claims are inputs; SkillMap compatibility is a version-bound evidence result for an exact profile.

## Canonical profile

```yaml
schema_version: skillmap.host-profile/v1
host: codex
profile_version: 1
host_version_range: ">=x <y"
runtime:
  operating_systems: [linux, macos, windows]
  node: ">=22"
skill_format:
  agent_skills_spec_digest: sha256:...
  entrypoint: SKILL.md
  progressive_disclosure: true
routing:
  explicit_selection: true
  deterministic_route_plan: true
loading:
  local_files: true
  remote_fetch: false
tools:
  filesystem: scoped
  shell: approval-bound
  network: approval-bound
auth:
  supported_flows: []
limits:
  max_skill_bytes: policy-versioned
  max_reference_depth: policy-versioned
documentation_snapshot_digest: sha256:...
profile_digest: sha256:...
```

Human host/version labels are aliases. Compatibility authority binds the canonical profile bytes, profile digest, host documentation snapshot, tested operating-system/runtime matrix, immutable skill version, and artifact digest.

## Profile dimensions

- accepted skill/package specification and frontmatter behavior;
- activation and explicit-selection mechanisms;
- progressive-disclosure and content-loading model;
- filesystem, shell, network, browser, MCP, and other tool semantics;
- approval, sandbox, secret, and credential boundaries;
- path, archive, token, response, and timeout limits;
- supported operating systems, architectures, and runtime versions;
- auth callback/redirect constraints where a skill integrates external services;
- cancellation, retry, failure, cleanup, and user-visible recovery behavior;
- host documentation and implementation snapshots used as evidence.

## Compatibility states

- `not-tested`: no canonical result exists.
- `declared`: compatibility is publisher-declared for this profile but has not been established by a canonical test receipt.
- `compatible`: the required matrix passes for the exact profile and artifact.
- `incompatible`: a required behavior fails or a hard host constraint conflicts.
- `stale`: the profile, host documentation/runtime, artifact, permissions, or required dependency changed.

Partial case outcomes remain receipt details and reason codes rather than a sixth compatibility state: the exact required profile matrix is `compatible` only when every required case passes, otherwise `incompatible`. If testing cannot safely proceed or required evidence is unavailable, a never-tested subject remains `not-tested`; a prior result becomes `stale`. These five values exactly match the hosted schema and evidence-state contract. New states require a versioned contract and schema migration.

## Test and receipt requirements

Compatibility evaluation starts from a clean context and uses only the permissions declared by the package and profile. The receipt includes profile/artifact/documentation digests, test suite and runner digests, OS/runtime matrix, tool policy, network policy, case outcomes, failures, issued/expiry timestamps, and signature bundle. It never grants extra permissions or executes unaudited package scripts merely to make a test pass.

The router treats unknown or partial compatibility according to explicit local policy. It never relabels publisher claims as tested evidence, and a grade for one host profile cannot be shown as current for another.
