# Release Checklist

Before a public package release:

Review and complete [the provenance and explicit approval strategy](release-provenance.md).

```bash
npm ci
npm run check:all
npm pack --dry-run
npm audit --audit-level=high
npm --prefix apps/web audit --audit-level=high
```

Manual checks:

- Run five real operator sessions with the [external onboarding pilot runbook](external-pilot-runbook.md); the blank runbook is not evidence.

- Install the tarball in a clean temp directory.
- Confirm the Node 20/22 by Linux/macOS/Windows matrix downloaded the retained
  `skillmap-package-candidate` artifact, verified its `SHA256SUMS` and pack
  manifest, and exercised that exact tarball rather than rebuilding per cell.
- Confirm the critical Chromium job downloaded and reverified the same retained
  candidate, installed it into a temporary consumer, and retained a passing
  `candidate-chromium.json` plus `qa-chromium.json` for the real recommended
  route, stable trace, feedback receipt, and doctor-job workflow. Firefox and
  WebKit remain source-checkout critical-flow gates.
- Run `skillmap scan`, `doctor`, and `doctor-pack` from that temp directory.
- Confirm package contents exclude `.skillmap`, `.implementation`, tests, fixtures, local tarballs, secrets, and private reports.
- Confirm package contents include `README.md`, `LICENSE`, `CHANGELOG.md`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `dist`, and `docs`.
- Confirm no command installs hooks or mutates global skill roots during the alpha core flow.
- Confirm hook install requires `hook install codex --passive`, blocks without exact routing approval, and writes a backup when modifying an existing file. `--force` may acknowledge later evidence gates only after routing approval; it cannot bypass the routing trust boundary.
- Confirm a blocked hook dry-run says it would refuse, reports `wouldInstall: false`, and does not write the target or a backup.
- Confirm every duplicate-name inventory group blocks readiness and strict policy application even when its display name is absent from policy.
- Confirm fresh inventory has opaque persisted root/workspace UUIDs, stable qualified skill IDs, full-tree content revisions, and zero identity collisions.
- Confirm policy-v2 migration leaves the original v1 bytes and all skill roots unchanged, duplicate names unresolved, and rollback digest-valid.
- Confirm a content edit invalidates its hash-bound canonical duplicate decision while leaving skillId stable.
- Confirm default safe export contains no prompt/body/path/diff/reason/receipt/secret canaries and verifies under its canonical payload digest.
- Confirm dashboard producer and web consumer agree on payloadDigest, semantic tamper is `integrity-failed`, and legacy v1 remains blocked.
- Supply two distinct reviewed tarballs and run
  `SKILLMAP_PRIOR_TARBALL=... SKILLMAP_TEST_TARBALL=... npm run test:upgrade-rollback:required`;
  retain the passing `upgrade-rollback.json`. A same-version reinstall or a
  `not-run` report does not satisfy this gate.
- Run `npm run release:candidate -- --candidate /absolute/candidate.tgz --prior
  /absolute/prior.tgz --dist-tag alpha --source-commit FULL_GIT_SHA --ci-run-id
  github:RUN_ID:ATTEMPT --evidence-dir /absolute/unique-evidence-directory` and
  retain the append-only `release-candidate.jsonl` journal. Confirm the full source commit equals the
  checked-out `HEAD`; in publish mode, confirm it and the run ID/attempt equal
  the active GitHub Actions environment. Confirm the wrapper-selected candidate
  basename, version, SHA-256, pack manifest, non-`latest` tag, and passing
  rollback receipt all identify the reviewed artifact. The portable receipt
  must not contain absolute source, operator, CI, or private-stage paths.
- Confirm the wrapper copied the candidate, manifest, `SHA256SUMS`, and prior
  package through no-follow reads into a private read-only staging root, then
  used that same staged candidate path for verification,
  `SKILLMAP_TEST_TARBALL`, rollback, and npm. Any source-path swap after staging
  must not alter the candidate; any staged-byte drift must stop before npm.
- Optionally repeat with `--dry-run` and confirm npm inspected the exact path
  at `https://registry.npmjs.org/` with explicit `--dry-run=true`,
  `publishInvoked: false`, and `npmDryRunInvoked: true`. Dry-run success is not
  publication approval or publication proof.
- Before any real publication, obtain the separate approval record and pass its
  exact candidate-bound `expectedPublishApproval` value using both `--publish`
  and `--approve-publish`. Confirm the approval and receipt bind package,
  version, tag, SHA-256, source commit, and CI run identity. Confirm inherited
  npm dry-run/registry values are removed, the real command has explicit
  `--dry-run=false` and `--registry https://registry.npmjs.org/`, and
  `SKILLMAP_TEST_TARBALL`, verifier output, rollback receipt, and npm path all
  bind to the same staged bytes. Alpha/beta publication must use an explicit
  non-`latest` dist-tag.
- Before real npm invocation, confirm the wrapper exclusively reserved a new
  no-follow `release-candidate.jsonl` and durably wrote
  `publish-outcome-unknown`. Existing files and final symlinks must fail before
  npm. Confirm the same reserved inode appends and fsyncs a complete success or
  command-failure record without truncating the preflight; the last complete
  JSONL record is current. If its post-success append fails, independently
  verify registry outcome instead of treating the npm command as failed.
- Direct source-directory publish is blocked by `prepublishOnly` only when
  lifecycle scripts run. Raw `npm publish exact.tgz --ignore-scripts` and
  `npm publish . --ignore-scripts` cannot be intercepted mechanically and are
  both forbidden. Treat protected branches/tags, the reviewed release workflow,
  required `npm-production` reviewers, and trusted-publisher policy as the
  enforcement authority.
- Confirm zero source records for a non-empty inventory report `not-configured`, partial/out-of-inventory records do not become covered, and only full variant classification is `covered`.
- Confirm stale/risky external-source review receipts match the exact resolved commit, full-tree manifest digest, upstream content revision, current content revision, and state. A hold keeps the installed tree and must not authorize adoption; a changed upstream tree must reopen review.
- Confirm README accurately labels alpha limitations.
- Confirm `skillmap --version` reports the package version from both a clean
  project-local install and a temporary-prefix global install.
- Confirm temporary-prefix global install, uninstall, and reinstall preserve the
  consumer workspace `.skillmap` tree and approved skill root byte-for-byte.
- Confirm `skillmap dashboard` clean bootstrap, legacy migration, root approval, real routing, feedback, job receipts, warm disconnect, and shutdown against the packaged static bundle.
- Confirm package update, workspace rollback, hook removal, and package uninstall instructions on every supported platform.
- Confirm every eval v2 file and report remains visibly candidate-only, even when it meets the old composition/provenance/holdout/leakage/baseline thresholds. Display-name labels are migration input, never release authority. The local app may map a name to a qualified ID only when the approved skill catalog contains exactly one match; missing and duplicate-name matches must block v3 conversion.
- For eval-suite/v3 and eval-run/v3 release evidence, retain the exact operator-reviewed qualified suite, its frozen case-set digest, per-case label provenance, the historical approved baseline RevisionRef and replay metrics, the trusted current approved RevisionRef, and both immutable effective.json artifacts. Validation must rerun every prompt through those registries and recompute labels, leakage, recommendations, advisory bytes, outcomes, baseline metrics, and current metrics. Holdout freeze and baseline provenance are explicitly local operator assertions with ordered real UTC timestamps; they are not an independent attestation and still require owner review before release.
- Exercise the bounded local-app v3 path with a real 150-case reviewed suite above the legacy 60 KiB limit and below the 500 KiB browser draft limit. Confirm the browser's frozen-case, dataset, and payload SHA-256 digests equal the canonical runtime projections, the exact finalized JSON is submitted to `/api/v1/evals/import`, and private prompts disappear from the DOM after import. Use the local CLI above the 512 KiB eval-import request boundary.
- Complete every automated and manual gate in [the local app UI acceptance matrix](ui-acceptance-matrix.md); unresolved `—` or `M` entries remain public-beta blockers.

Do not publish until the user explicitly approves npm publication and package tag.
