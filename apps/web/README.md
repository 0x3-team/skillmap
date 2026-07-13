# SkillMap Web

This Next.js application contains two deliberately separate products:

- a real Supabase-backed hosted skill catalog with free-account saved skills and account-owned exact-commit submission intents;
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
- `/skills/[publisher]/[slug]`, `/audit`, and `/grade` public skill detail plus bounded current-version evidence projections
- `/api/v1/skills` and `/api/v1/skills/[skillId]` contract-validated public API
- `/submit`, `/account/submissions` authenticated exact-commit submission and owner-only queued withdrawal
- `/sign-in`, `/auth/callback`, `/account`, `/account/saved`, `/account/submissions`, `/account/reports`, `/account/export` Supabase account flow, owner-only queue history, and bounded data export
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

`SKILLMAP_RELEASE_STAGE` is a fail-closed public-copy contract. Keep the default `local-candidate` in a checkout, use `private-alpha` only for an accepted hosted pilot, and use `public-alpha` only after the public gate passes. Search indexing requires both `SKILLMAP_RELEASE_STAGE=public-alpha` and `SKILLMAP_INDEXING_MODE=public`; either missing or malformed value keeps the site private.

`SKILLMAP_SUPPORT_URL` must be the approved public HTTPS page for support, appeal, and confidential security-intake instructions before public alpha. It is rendered only after strict URL validation; malformed, credential-bearing, query-bearing, fragment-bearing, or non-loopback HTTP values fail closed. A private pilot may instead use its separately recorded participant contact.

The browser bundle uses only the Supabase publishable key. A service-role or secret key must never be added to this application.

Remote provisioning, deployment, backup, rollback, OAuth, and live-acceptance steps are controlled by [`docs/operations/hosted-alpha-deploy.md`](../../docs/operations/hosted-alpha-deploy.md). Do not push the local-only `supabase/config.toml` to a hosted project.

The required Gitea hosted-database lane starts an isolated database service, runs reset/lint/pgTAP, and checks generated API types. The full public API and authenticated browser smokes remain manually run local acceptance gates because the rootless Gitea job intentionally excludes Auth, PostgREST, and the other optional Supabase services. With a full disposable local stack and production Next.js server running, `npm run test:hosted-api` proves the public boundary and `npm run test:hosted-auth` creates and deletes a synthetic account while proving account access, concurrent-safe save, saved projection, unsave, mobile navigation naming, and 390px containment. Only the auth-smoke process receives the local service-role key; the Next.js process never does.

After an optimized build and a clean `supabase db reset --local`, run `npm run test:hosted-gates` from the repository root to compose the API, authenticated account, non-destructive submission, report, real receipt-row rendering, export, deletion, and cleanup checks behind one production server. The GitHub hosted-browser CI job runs this same command against a disposable full Supabase stack; the server process receives only public configuration.

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

Public catalog reads use an anonymous, no-store Supabase client and only the explicit `api` schema. Audit and grade pages read only the bounded current-public evidence views; their canonical evidence digest is not a full public `projectionDigest` receipt. Authenticated writes are limited by RLS to a user profile, that user’s saved skills, exact source-coordinate submission intents, queued-to-withdrawn transitions, immutable suspicious-listing reports, and the no-target `api.delete_my_account()` RPC. Submission writes are capped at 3 active rows and 10 new rows per rolling 24 hours. Reports require an exact current public version, are capped at 5 queued and 20 new rows per rolling 24 hours, allow one queued row per account/version/category, and apply a 24-hour cooldown to that tuple. The browser cannot set worker, review, audit, grade, report disposition, lifecycle, or publication authority. Account deletion requires an exact confirmation phrase, cascades account-owned data including reports, detaches published submission evidence, and clears the current browser session.

The dashboard remains a redacted mirror and workflow console. It stores prompt hashes, short previews, `$PROJECT`/`$HOME` placeholders, connector state, and read-only local commands. It does not upload raw prompts, raw skill bodies, or unredacted local paths.
