# Release Checklist

Before a public package release:

```bash
npm ci
npm run typecheck
npm test
npm pack --dry-run
npm publish --dry-run --tag alpha
```

Manual checks:

- Install the tarball in a clean temp directory.
- Run `skillmap scan`, `doctor`, and `doctor-pack` from that temp directory.
- Confirm package contents exclude `.skillmap`, `.implementation`, tests, fixtures, local tarballs, secrets, and private reports.
- Confirm package contents include `README.md`, `LICENSE`, `CHANGELOG.md`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `dist`, and `docs`.
- Confirm no command installs hooks or mutates global skill roots during the alpha core flow.
- Confirm hook install requires `hook install codex --passive` and writes a backup when modifying an existing file.
- Confirm README accurately labels alpha limitations.
- Confirm route evals meet the stable-alpha threshold on a real curated policy.

Do not publish until the user explicitly approves npm publication and package tag.
