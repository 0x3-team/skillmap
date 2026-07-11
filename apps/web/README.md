# SkillMap Web

This additive product surface renders a local-first dashboard from redacted fixture or local snapshot data. It does not provide accounts, team sync, billing, a hosted registry, or a live command connector, and it does not change the root CLI package, local skill roots, hook installation, or source-update behavior.

## Run

```bash
npm install
npm run dev
```

Routes:

- `/` landing page
- `/dashboard` fixture-backed dashboard by default, or local redacted snapshot mode when `SKILLMAP_DASHBOARD_SNAPSHOT` is set

## Local Snapshot Mode

The dashboard reads one optional local JSON file on the server:

```bash
SKILLMAP_DASHBOARD_SNAPSHOT=$PROJECT/.skillmap/dashboard-snapshot.json npm run dev
```

When the variable is unset, `/dashboard` stays in fixture demo mode and labels the snapshot handoff as offline. When a snapshot is loaded, the UI labels source type, generated time, loaded time, hash, redaction, stale state, and handoff state. A loaded snapshot never implies a live connector session.

Validate a snapshot before loading it:

```bash
node scripts/check-dashboard-snapshot.mjs $PROJECT/.skillmap/dashboard-snapshot.json
```

The checker rejects malformed JSON, non-redacted snapshots, raw prompt/body fields, long prompt previews, and unredacted local paths. The dashboard never runs local commands; copy actions only write redacted CLI commands or hook text to the browser clipboard.

## Browser Acceptance

With a production or development server running on `127.0.0.1:3000`:

```bash
npm run test:browser
```

The runner exercises the same critical, accessibility, responsive, overflow, and reduced-motion checks in Chromium, Firefox, and WebKit. It uses native Playwright runtimes when available. If a browser executable or its Linux host libraries are unavailable, it retries only that browser in the exact version-matched official Playwright Docker image; application or assertion failures never trigger the fallback.

## Safety Boundary

The dashboard is a redacted mirror and workflow console. It stores prompt hashes, short previews, `$PROJECT`/`$HOME` placeholders, connector state, and read-only local commands. It does not upload raw prompts, raw skill bodies, or unredacted local paths.
