# Local alpha support and diagnostics

SkillMap is an experimental local alpha, not a hosted service. Before reporting a problem, capture bounded redacted evidence:

```bash
skillmap --version
node --version
skillmap state status --json
skillmap status --json
skillmap doctor --fix-plan
```

`npm run check:all` is a maintainer-checkout gate; it is not included in the
installed package. Maintainers reproducing from a full checkout can additionally
run `npm ci` and `npm run check:all`. Tarball users should report the exact
tarball filename and its reviewer-provided SHA-256. On Windows, include the
PowerShell path used to install it (for example,
`.\artifacts\package\skillmap-0.1.0.tgz`); on macOS/Linux include the equivalent
path without sharing private home-directory segments.

For connector problems, stop the foreground process, confirm no stale process owns the port, then restart `skillmap dashboard` and open the newly printed one-time URL. Do not reuse an old bootstrap URL.

Include:

- operating system and Node version
- SkillMap package version and install method
- the command and safe machine error code
- whether the state was uninitialized, migrated, current, or last-known-good
- the current revision ID and redacted digest receipts
- the smallest reproducible workflow

Do not include raw prompts, skill bodies, absolute paths, secrets, tokens, hook configuration, local-sensitive exports, or private `.skillmap` artifacts. Replace any accidentally captured private value before sharing.

Recovery boundaries:

- Use `state repair-projections` only to restore legacy read-only projections from a validated current revision.
- Use `state recover` only when diagnostics prove derived corruption and the store accepts the safety-equivalent last-known-good revision.
- Use `state rollback` with an explicit target, current expected revision, actor, and reason.
- Never delete state locks, rewrite pointers, or edit immutable revision directories by hand.

Package publication, production incident response, and hosted-service support are not active for this build.
