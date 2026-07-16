# Release Provenance And Approval Strategy

SkillMap is not published by this worktree. This document defines the release
boundary and the repository's one supported release wrapper; it does not grant
registry access or publication approval.

## Source-ref taxonomy

Source preservation tags and package release tags have different meanings:

- `checkpoint/<date>/<name>` records an accepted or historically useful source
  boundary. It does not claim npm publication, deployment, or a GitHub Release.
- `candidate/<date>/<name>` records an exact active candidate that has not yet
  crossed its merge/release acceptance boundary.
- `archive/<scope>/<date>/<name>` keeps superseded Git history recoverable. It
  is archaeology only and must not be merged or treated as a release input.
- `vX.Y.Z[-prerelease]` is reserved for an explicitly approved exact package
  release whose semantic version, tarball, commit, CI evidence, and publication
  approval all agree.

The current source inventory and exact annotated tags are listed in
[`PROJECT_STATUS.md`](https://github.com/0x3-team/skillmap/blob/main/PROJECT_STATUS.md).
There is intentionally no
`v0.1.0` tag or GitHub Release while `skillmap@0.1.0` remains an unpublished
development package. Creating a checkpoint, candidate, or archive tag never
authorizes npm publication or deployment.

## Current registry and bootstrap boundary

An unauthenticated `npm view skillmap name version --json` read returned `E404`
on 2026-07-10. That result is not a name reservation and must be checked again
immediately before any release.

npm's current `npm trust` documentation says a package must already exist before
a trusted publisher can be configured. npm's staged-publishing documentation
also says a brand-new package cannot be staged. Therefore the first publication
cannot honestly be described as OIDC-only or stage-only.

The one-time bootstrap path is:

1. Complete every release gate against one retained candidate tarball. Record
   its SHA-256, `npm pack --json` manifest, source commit, package version, CI run,
   and artifact name in a separate owner approval.
2. Recheck registry-name availability and repository visibility. Provenance
   requires an eligible public package built from a public repository whose
   `package.json` repository URL matches the source repository exactly.
3. After a second explicit approval for the external state change, publish the
   exact approved tarball from a GitHub-hosted runner in the protected
   `npm-production` environment using the canonical wrapper's `--publish` plus
   candidate-bound `--approve-publish` mode and a one-time, shortest-lived
   publish credential. Never put that credential in the repository or a
   long-lived general secret.
4. Verify the package, version, dist-tag, digest, tarball contents, source commit,
   and provenance from unauthenticated registry reads. If any check fails, stop;
   do not configure the failed path as trusted.
5. Now that the package exists, configure the trusted publisher for the exact
   repository, release workflow filename, `npm-production` environment, and
   allowed action. Prefer `npm stage publish` only, so a maintainer must approve
   each staged package with 2FA.
6. Prove the OIDC path, then set publishing access to require 2FA and disallow
   traditional tokens. Revoke/delete the bootstrap credential and any obsolete
   automation tokens immediately.

If the source repository remains private, provenance is not available under
npm's documented trusted-publishing rules. That is a release blocker for this
chosen model, not permission to claim an unattested release.

## Exact candidate chain

The CI `package-candidate` job builds one non-published tarball and retains it
with `pack-manifest.json` and `SHA256SUMS`. Every Node 20/22 by
Linux/macOS/Windows consumer cell downloads and verifies that artifact before
running its clean-consumer and temporary-prefix global lifecycle smoke. A
dedicated Chromium job also downloads and verifies the retained artifact,
installs that exact tarball into a temporary consumer, and runs the real
critical route, stable trace, feedback, and doctor-job workflow using the
installed package's CLI, backend modules, and static assets. Firefox and WebKit
remain independent source-checkout critical-flow gates. A source checkout test
or a tarball rebuilt independently in each matrix cell is supporting evidence,
not proof of the reviewed candidate.

The approval record must bind to the exact candidate. Create the immutable tag
at that recorded commit. If a tag or release workflow rebuilds the package, its
tarball digest and pack manifest must match the approved candidate exactly. A
mismatch creates a new candidate: rerun the candidate-dependent platform,
consumer, pilot, and manual gates and obtain a new approval. Never substitute a
fresh rebuild after approval merely because its semantic version is unchanged.

GitHub artifact retention is temporary. Publication must happen while the
recorded artifact is available and verifiable, or the candidate must be rebuilt
and requalified under the rule above.

## Canonical candidate release wrapper

`npm run release:candidate` is the only repository-supported path to an npm
publication. It accepts one exact candidate `.tgz`, its distinct reviewed prior
version, and an explicit non-`latest` dist-tag. The adjacent
`pack-manifest.json` and `SHA256SUMS` must bind to the candidate bytes.

The default mode is validation-only and never invokes npm. Add `--dry-run` when
the release operator also wants npm to inspect the exact gated candidate using
its non-publishing `npm publish --dry-run` path:

```bash
npm run release:candidate -- \
  --candidate /absolute/path/artifacts/package/skillmap-0.2.0-alpha.1.tgz \
  --prior /absolute/path/reviewed/skillmap-0.1.0.tgz \
  --dist-tag alpha \
  --source-commit FULL_40_CHARACTER_GIT_SHA \
  --ci-run-id github:RUN_ID:ATTEMPT \
  --dry-run \
  --evidence-dir /absolute/path/artifacts/release
```

The wrapper performs this fail-closed sequence:

1. Reject missing, symbolic-link, control-character, oversized, or non-versioned
   tarball inputs and reject unsafe or `latest` dist-tags. The full source commit
   must equal the checked-out `HEAD`; publish mode additionally requires the
   supplied GitHub run ID/attempt and commit to equal the active Actions
   environment.
2. Read the selected candidate, manifest, `SHA256SUMS`, and prior tarball with
   no-follow file descriptors into a new mode-0700 private staging root. Freeze
   the staged files to mode 0400 and directories to mode 0500. Source-path swaps
   after staging cannot change the release bytes.
3. Run `verify-package-candidate.mjs` against that private staged candidate,
   checking the archive, pack manifest, npm integrity, and `SHA256SUMS`.
4. Set `SKILLMAP_PRIOR_TARBALL` and `SKILLMAP_TEST_TARBALL` to the private staged
   paths and run the required two-version upgrade/rollback gate. The passing
   receipt's candidate version and SHA-256 must match the verified stage.
5. Rehash the private candidate before and after each gate. Any path, version,
   or byte mismatch stops before npm.
6. Emit the append-only `release-candidate.jsonl` journal, including only portable tarball basenames,
   digests, version, dist-tag, rollback result, and candidate-bound approval
   value plus the validated source commit and CI run identity. Absolute source,
   operator, private-stage, and CI paths are deliberately excluded.

With `--dry-run`, the wrapper then invokes the same private staged candidate
through `npm publish <candidate> --registry https://registry.npmjs.org/
--dry-run=true --tag <tag> --access public --provenance --ignore-scripts`.
Inherited npm registry, dry-run, tag, access, provenance, and lifecycle-script
configuration is removed or replaced before npm starts. The receipt records
`npmDryRunInvoked: true` and
`publishInvoked: false`; this is validation evidence, never publication proof.

Publication remains a separate, explicitly approved mode. After the owner
approval record below is complete, repeat the same command with `--publish` and
the exact `expectedPublishApproval` value from the validation receipt:

```bash
npm run release:candidate -- \
  --candidate /absolute/path/artifacts/package/skillmap-0.2.0-alpha.1.tgz \
  --prior /absolute/path/reviewed/skillmap-0.1.0.tgz \
  --dist-tag alpha \
  --source-commit FULL_40_CHARACTER_GIT_SHA \
  --ci-run-id github:RUN_ID:ATTEMPT \
  --evidence-dir /absolute/path/artifacts/release-attempt-1 \
  --publish \
  --approve-publish "publish:skillmap@0.2.0-alpha.1:tag=alpha:sha256=REVIEWED_SHA256:commit=FULL_40_CHARACTER_GIT_SHA:ci=github:RUN_ID:ATTEMPT"
```

Before real npm invocation, publish mode requires a fresh evidence directory and
exclusively creates `release-candidate.jsonl` with no-follow semantics. An
fsynced `publish-outcome-unknown` record exists before npm can contact the
registry. The same open file descriptor appends and fsyncs a complete success or
command-failure record, so a failed final write cannot truncate the conservative
preflight. A post-success evidence update fault is warned rather than converting
a successful registry command into a reported command failure. Existing files,
broken or live symlinks, and path replacement are never overwritten. Treat the
last complete JSONL record as current and retain every preceding record as the
attempt journal.

Only after all prior checks pass does approved publish mode invoke `npm publish`
with the same private staged path in both the publish argument and
`SKILLMAP_TEST_TARBALL`, plus the canonical registry, explicit `--dry-run=false`,
`--tag`, `--access public`, `--provenance`, and `--ignore-scripts`. Disabling
lifecycle scripts prevents a publish-time rebuild from replacing the reviewed
archive. This wrapper never creates a Git tag, pushes a commit, creates a GitHub
release, or deploys the web application.

Repository scripts cannot mechanically intercept a maintainer who deliberately
runs raw `npm publish /path/to/exact.tgz --ignore-scripts` or
`npm publish . --ignore-scripts` outside this wrapper. Both bypasses are
forbidden by release policy; the second explicitly skips the `prepublishOnly`
defense. Protected branches/tags, the reviewed GitHub release workflow, the
`npm-production` environment, required reviewers, and registry trusted-
publisher restrictions are the enforcement authority. `prepublishOnly` is only
defense in depth for an ordinary source-directory publish without
`--ignore-scripts`, not a publication security boundary.

Eval evidence has the same exact-artifact boundary. A prompt-free eval-run/v3
receipt is release-authoritative only when it is revalidated with its exact
operator-reviewed frozen suite, the trusted approved state-store RevisionRef,
the selected historical approved baseline RevisionRef, and the immutable
effective.json bytes named by both revisions. The validator recomputes baseline
and current routing, qualification, leakage, advisory size, outcomes, and
metrics; standalone run or suite/run validation remains candidate-only. Eval v2
is retained only as legacy candidate and migration input because display names
cannot bind duplicate variants or immutable routing identities.

The local v3 editor computes `frozenCaseSetDigest`, `datasetDigest`, and
`payloadDigest` over the same sorted-key canonical JSON projections as the
runtime, then submits that exact finalized v3 object to the revision-bound local
import endpoint. Private prompts live only in the in-memory draft before that
explicit import and are cleared from the page afterward. The browser admits up
to 500 KiB so the 150-case floor is feasible; larger reviewed documents use the
CLI above the dedicated 512 KiB eval-import boundary. Neither path grants
approval by importing.

The local `reviewedBy`, real UTC label-review/freeze timestamps, frozen case-set
digest, per-case label provenance, and historical baseline provenance make the
operator trust model explicit and ordered, but do not constitute an independent
timestamp, signature, or proof that holdout data was never used for tuning.
Public release therefore still needs the separate evidence-owner review.

## Chosen steady-state beta release model

After the bootstrap publication and trusted-publisher setup:

1. Publish or stage only from a GitHub-hosted runner using npm trusted publishing
   and OIDC. Do not add a long-lived npm automation token to repository secrets.
2. Use a dedicated `npm-production` GitHub environment with a required reviewer,
   protected tag rules, and self-review disabled when the repository plan allows
   it.
3. Bind the npm trusted publisher to the exact repository, workflow filename,
   environment, and preferably the `npm stage publish` action. Keep direct
   raw `npm publish` outside the canonical wrapper disabled unless a separately
   reviewed release policy replaces this model.
4. Use a current release runtime that satisfies npm trusted-publishing and trust
   configuration requirements. As of 2026-07-10, the `npm trust` CLI reference
   requires npm 11.15.0 or newer, while trusted publishing requires Node 22.14.0
   or newer. Recheck both official pages at release time and pin a supported
   current runtime independently of the Node 20/22 consumer matrix.
5. Use the exact retained candidate from a clean, immutable tagged commit after
   the full CI, consumer-install, browser, privacy, migration, failure, audit,
   pilot, and manual UI gates pass. Any rebuild must pass the exact-candidate
   rule above.
6. Inspect `npm pack --json` output before approval. The tarball must contain the
   CLI, canonical contracts, versioned local-app assets, public docs, and license
   files only; it must exclude internal plans, fixtures, screenshots, reports,
   `.skillmap`, caches, and credentials.
7. Stage or publish the public package through trusted publishing. npm
   automatically emits provenance for eligible public packages from public
   repositories; verify the registry package, provenance/attestation, tarball
   digest, package version, dist-tag, and source tag after publication.
8. Treat npm publication, source tagging, and any hosted web deployment as three
   separate state changes and report each one separately.

Official references:

- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
- [npm trust CLI prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/)
- [npm staged publishing](https://docs.npmjs.com/staged-publishing/)
- [npm provenance statements](https://docs.npmjs.com/generating-provenance-statements/)
- [GitHub deployment environments and protection rules](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)

## Required release approval record

The approval must name:

- exact package name, semantic version, and npm dist-tag;
- exact source commit and signed/annotated tag policy;
- the completed CI run, retained artifact name, tarball SHA-256, pack manifest,
  and evidence packet;
- whether this is the one-time bootstrap or the trusted-publisher steady state;
- the person approving publication;
- rollback owner and support contact;
- whether a public web deployment is approved separately.

No inferred approval is valid. A request to implement, test, package, or prepare
the beta does not authorize `npm publish`, a Git tag, a GitHub release, a push,
or a deployment.

## Post-publication verification and rollback

Immediately after an approved publication:

1. Install the registry package into a new temporary consumer project on a
   supported platform and rerun the first-route smoke.
2. Verify provenance/signatures with a current npm CLI and compare the installed
   tarball contents with the reviewed pack manifest.
3. Confirm the version and dist-tag from an unauthenticated registry read.
4. If verification fails, stop any web rollout, move the dist-tag back to the
   last verified version when safe, deprecate the bad version with a concise
   warning, publish a corrected new version, and document the immutable bad
   version. Never attempt to overwrite an existing npm version.

Workspace state rollback and project-local hook uninstall remain local operator
actions; they are independent of registry rollback.
