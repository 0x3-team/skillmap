# Release Checklist

Before a public package release:

```bash
npm ci
npm run typecheck
npm test
npm pack --dry-run
npm publish --dry-run
```

Manual checks:

- Install the tarball in a clean temp directory.
- Run `skillmap scan`, `doctor`, and `doctor-pack` from that temp directory.
- Confirm package contents exclude `.skillmap`, `.implementation`, tests, fixtures, and local tarballs.
- Confirm no command installs hooks or mutates global skill roots during the alpha core flow.
- Confirm README accurately labels alpha limitations.
