# SkillMap Web

This Next.js application contains two deliberately separate products:

- a real Supabase-backed hosted skill catalog and free-account saved-skill workflow;
- the existing fixture/redacted-snapshot dashboard for the local-first CLI.

Hosted routes never fall back to dashboard fixtures. Missing Supabase configuration produces an explicit unavailable state or API `503`.

## Run

```bash
npm install
npm run typecheck
npm run dev
```

Node 22 or newer is required.

Routes:

- `/` landing page
- `/skills` anonymous hosted catalog
- `/skills/[publisher]/[slug]` public skill evidence detail
- `/api/v1/skills` and `/api/v1/skills/[skillId]` contract-validated public API
- `/sign-in`, `/auth/callback`, `/account`, `/account/saved` Supabase account flow
- `/dashboard` fixture-backed dashboard by default, or local redacted snapshot mode when `SKILLMAP_DASHBOARD_SNAPSHOT` is set

## Hosted Catalog Setup

From the repository root:

```bash
supabase start
supabase db reset --local
supabase db lint --local --level warning
supabase test db supabase/tests/hosted_catalog_rls.test.sql --local
supabase status
```

Copy `.env.example` to `.env.local` and set the local API URL and publishable key printed by `supabase status`. GitHub OAuth is intentionally disabled in local `supabase/config.toml`; configure the hosted GitHub provider and exact callback URL only through the remote-alpha runbook.

The browser bundle uses only the Supabase publishable key. A service-role or secret key must never be added to this application.

Remote provisioning, deployment, backup, rollback, OAuth, and live-acceptance steps are controlled by [`docs/operations/hosted-alpha-deploy.md`](../../docs/operations/hosted-alpha-deploy.md). Do not push the local-only `supabase/config.toml` to a hosted project.

The hosted CI lane starts a disposable local Supabase stack, runs the public API smoke, and then injects the local service-role key only into `test:hosted-auth`. That browser smoke creates and deletes a synthetic account while proving account access, save, saved projection, unsave, mobile navigation naming, and 390px containment. The Next.js process never inherits the service-role key.

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

Public catalog reads use an anonymous, no-store Supabase client and only the explicit `api` schema. Authenticated writes are limited by RLS to a user profile and that user’s saved skills. Catalog, version, grade, and audit mutation are denied in this slice.

The dashboard remains a redacted mirror and workflow console. It stores prompt hashes, short previews, `$PROJECT`/`$HOME` placeholders, connector state, and read-only local commands. It does not upload raw prompts, raw skill bodies, or unredacted local paths.
