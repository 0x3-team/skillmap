# Hosted Alpha Deployment and Recovery Runbook

Status: pre-deployment. This is the canonical provider, deployment, recovery, and live-acceptance handoff for the free hosted trust alpha. It permits reviewed third-party metadata-only submissions, inert static audit, provisional numeric grading, operator review, and receipt-backed publication after the gates below pass. It never authorizes submitted-code execution, package mirroring/loading, billing, checkout, paid placement, or Stripe. Private pilot comes first; public alpha and indexing require the later promotion gate. A private owner-only mechanics pilot may use two separate test operator credentials to prove CLI and database separation, but it is technical evidence only and cannot authorize publication, moderation, or third-party participant launch.

Use this runbook together with `docs/operations/free-public-alpha-runbook.md`, which is authoritative for worker migration compatibility, submission review, publication, reports, lifecycle actions, monitoring, and daily operations.

## Ownership and approval gate

- Source and review: private `0x3-team/skillmap` on GitHub, mirrored to private Gitea.
- CI authority: the exact candidate commit must pass both jobs in `.gitea/workflows/ci.yml` **and** the `hosted-web-browser` job in `.github/workflows/ci.yml`. The Gitea lanes prove root/web quality plus restored database/RLS/type authority; the GitHub lane proves the complete disposable Auth/PostgREST/API/submission/report/evidence browser workflow. If either provider cannot run the required lane, the release remains `NO-GO`; a local transcript is useful evidence but is not a substitute for authoritative exact-commit CI.
- Gitea evidence retention: the static-preflight and recovery steps emit one bounded `skillmap-ci-retained-gate-receipt/v1` envelope into the retained job log. Copy its run ID, job, exact commit/tree, and receipt SHA-256 into the release decision record; a temporary runner path alone is not evidence.
- Incident and rollback owner: Masih Hedayati, acting as the `0x3-team` owner.
- Database target: an isolated 0x3-owned alpha project in an owner-approved region and plan whose recurring provider cost is zero for this launch. Free-tier pausing, quotas, and the absence of managed backups must remain visible limitations.
- Web target: an owner-approved provider/project that can run the reviewed Next.js application from `apps/web` at zero recurring provider cost and under terms compatible with this public product. No paid team or plan is the canonical target.
- Cost gate: do not create, upgrade, or attach any paid provider resource. If no reviewed zero-cost-compatible host is available, stop and keep deployment blocked rather than silently selecting a paid plan.
- Repository gate: do not migrate or deploy until the hosted-foundation change is merged and the resulting exact `main` commit has passed both Gitea authority lanes and the GitHub `hosted-web-browser` lane.

Preview deployments must remain unconfigured until a separate preview Supabase project exists. A preview must never receive production Supabase credentials.

### Policy-version promotion gate

`public-alpha-draft/v1` is an implementation-only consent identifier, not launch-approved legal authority. Before inviting any external submitter, the product owner must approve the support identity, governing jurisdiction, age/geography boundary, retention/deletion/legal-hold periods, terms, acceptable-use rules, privacy text, takedown/appeal process, and effective date. Publish reachable versioned terms and acceptable-use pages, update the submission consent surface to link that exact version, introduce a reviewed migration and application change that replace the draft identifier consistently, and rerun the database, contract, browser, export, and deletion gates. Record the approved policy ID, URLs, content digests, effective date, and owner in the production decision receipt. Until that receipt exists, deployment may be exercised only as private operator evidence and public invitations remain `NO-GO`. Private-owner pilot evidence does not satisfy external-pilot evidence.

## Secret boundary

Never commit, print into CI logs, put in a public Worker variable, or expose to
the browser:

- Supabase access tokens, database passwords, or JWT secrets
- GitHub OAuth client secrets
- backup encryption keys

The Cloudflare Worker receives the Supabase service-role key only as an
encrypted Worker secret named `SUPABASE_SERVICE_ROLE_KEY`. It is not a
`wrangler.vars` entry, a Next `NEXT_PUBLIC_*` variable, a client bundle value,
or a checked-in file. OpenNext copies Worker secret bindings into the server
runtime only; the server-only DeviceAuth module reads the value there and does
not return it in configuration errors or logs. `next build` does not need the
secret and must never receive it.

From the `apps/web` directory, provision the secret separately after
authenticating the intended Worker. Use a password-manager pipe or a hidden
prompt; do not paste the key into a shell command or commit it:

```bash
# Example only. Do not run this during source validation.
cd /path/to/skillmap/apps/web
read -r -s SUPABASE_SERVICE_ROLE_KEY
printf '%s' "$SUPABASE_SERVICE_ROLE_KEY" \
  | ./node_modules/.bin/wrangler secret put SUPABASE_SERVICE_ROLE_KEY \
      --config ./wrangler.jsonc --name skillmap
unset SUPABASE_SERVICE_ROLE_KEY
```

Do not use the secret value as a `wrangler.jsonc` variable. `npm run deploy`
runs a read-only preflight with the pinned local Wrangler executable from this
directory. It calls `secret list --format json --config ./wrangler.jsonc
--name skillmap`, checks only for the exact secret name, and then runs the
OpenNext build and deploy. The preflight does not print secret values, and the
secret is not passed to `next build`.

The public Worker configuration receives only:

- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SKILLMAP_RELEASE_STAGE=private-alpha`
- `SKILLMAP_INDEXING_MODE=private-alpha`
- `SKILLMAP_SUPPORT_URL` only after the owner approves a reachable public HTTPS page containing support, formal-appeal, and confidential security-report instructions

The web process uses the reviewed fixed private-alpha per-instance catalog-read guard (60 requests per 60 seconds and at most 5,000 live keys). It has no environment tuning surface in this release and does not replace the required provider-global public-alpha limiter.

The `apps/web` build performs a release-configuration preflight before Next.js compiles. It rejects an incomplete hosted stage before an artifact is created: every hosted stage needs a valid site origin and public Supabase configuration; `public-alpha` additionally needs the approved support URL and exact public-indexing opt-in. It does not prove a deployment, provider configuration, or live acceptance.

The GitHub OAuth client secret belongs only in Supabase Auth. Store database and backup credentials in the operator password manager and a root-only runtime secret file when automation is approved.

## Provider configuration

### Supabase project

1. Create `skillmap-alpha` in the approved isolated organization and the exact `APPROVED_REGION` recorded in the production provider decision receipt. Do not substitute a default region in this runbook.
2. Store the generated database password outside the repository.
3. Link the clean candidate worktree:

   ```bash
   supabase link --project-ref <project-ref>
   supabase migration list --linked
   supabase db push --linked --dry-run
   ```

4. Do **not** run `supabase config push`. The checked-in `supabase/config.toml` is deliberately local-only: it contains loopback URLs, local password-test behavior, and a disabled GitHub provider.
5. Configure the hosted project deliberately in the Supabase dashboard:
   - exposed PostgREST schema: `api` only
   - Site URL: the exact production web origin
   - additional redirect URL: `<production-origin>/auth/callback` only
   - anonymous sign-ins: disabled
   - email/password and magic-link signups: disabled
   - GitHub provider: enabled
6. Verify that `private` is not exposed and that `anon`, `authenticated`, and `service_role` have only the reviewed grants from the migration.

### GitHub OAuth application

Create the OAuth application under 0x3 ownership:

- Homepage URL: the exact production SkillMap origin
- Authorization callback URL: `https://<project-ref>.supabase.co/auth/v1/callback`
- Device Flow: disabled

The GitHub-to-Supabase callback above is distinct from the application callback `<production-origin>/auth/callback`. Configure the GitHub client ID and secret only in Supabase Auth.

### Web project

1. Select and record the zero-cost-compatible provider, project owner, plan/limits, deployment command, rollback command, and log/health surface. Selection is an owner decision; this runbook does not default to a paid provider.
2. Connect only `0x3-team/skillmap`. Configure Root Directory `apps/web`, keep the project floor of Node 22 or newer, and use Node 24.x as the reviewed hosted deployment runtime.
3. Leave preview variables unset until a separate preview database exists. Add the production public variables from the secret boundary using the checked-in `wrangler.jsonc`; provision `SUPABASE_SERVICE_ROLE_KEY` separately with the exact `apps/web` Wrangler command above. Do not add it to `vars`, a dashboard plaintext variable, shell history, logs, or artifacts.
4. Keep `SKILLMAP_RELEASE_STAGE=private-alpha` and `SKILLMAP_INDEXING_MODE=private-alpha` until the public gate explicitly changes both. Indexing requires the exact pair `public-alpha` and `public`.
5. Before public alpha, configure `SKILLMAP_SUPPORT_URL` to the approved reachable intake page, open it from the deployed `/support` page while signed out, and verify that its public and confidential reporting instructions match the approved policy. A private repository issue URL is not a public support route.

## Migration and first deployment

From a clean worktree at the reviewed `main` commit:

```bash
supabase migration list --linked
supabase db push --linked --dry-run
supabase db push --linked
supabase gen types typescript --linked --schema api,private \
  | sed -e '${/^$/d;}' > /tmp/skillmap-alpha-database.types.ts
cmp /tmp/skillmap-alpha-database.types.ts apps/web/lib/supabase/database.types.ts
```

For the Cloudflare Worker, run the deploy script from `apps/web` after the
secret has been provisioned. The script checks the configured Worker secret
name, then builds and deploys. It does not inject the secret into the build:

```bash
cd /path/to/skillmap/apps/web
npm run deploy
```

If the encrypted secret is absent, deployment stops before OpenNext builds or
uploads the Worker.

Then run the exact production deployment command recorded in the provider decision record from `apps/web`. The checked-in `supabase/seed.sql` is local development and test data only and must never be applied to a hosted project. Its example repository is not an anonymously readable production source, so it cannot satisfy the public-source contract. Production corpus entries must instead move through authenticated account submission, the current worker and evidence gates, license and collision review, publisher authorization, and distinct approver/executor dual-control publication. Public launch remains blocked until 20 owner-authorized listings resolve to their exact anonymous public sources and pass the corpus acceptance receipt below. Record the database project ref, migration versions, deployed Git commit, web deployment ID/URL, provider/plan, and operator in the implementation ledger without recording secrets.

## Backup and restore gate

Before inviting any external user:

1. Produce a schema and data dump into a root-only temporary directory outside the repository.
2. Encrypt the dump with an operator-owned key and copy it to an off-host destination.
3. Restore into an isolated disposable Postgres/Supabase environment.
4. Verify migration history, the expected approved production-corpus row counts and digests, account isolation, and `pg_restore`/SQL integrity.
5. Delete unencrypted temporary material and record only checksums, timestamps, row counts, and the restore result.

Free Supabase has no managed backup guarantee and may pause after inactivity. An unexercised export is not a backup receipt.

## Live acceptance

Capture evidence against the exact deployment commit:

- `/`, `/skills`, and each reviewed public-corpus detail return expected content with no fixture fallback
- `/api/v1/health` returns the identifier-free `skillmap-health/v1` readiness projection, uses `503` for incomplete hosted configuration, and carries browser/CDN no-store headers
- `/api/v1/skills` returns a contract-valid list, rejects malformed cursor/limit input, emits no-store headers, and returns `429` plus `Retry-After` when the alpha limit is exceeded
- `robots.txt`, metadata, and `X-Robots-Tag` block indexing during private alpha
- CSP uses a per-request nonce, keeps stylesheet elements nonce-restricted, permits inline style attributes only for the reviewed React/Motion UI boundary, and forbids framing, objects, and foreign base URLs
- HSTS, nosniff, referrer, permissions, and frame protections are present
- only the exact Supabase origin appears in `connect-src`
- direct anonymous access to `private` and hidden lifecycle records fails
- GitHub sign-in, callback normalization, profile creation, save, saved projection, unsave, logout, and cookie clearing pass
- two distinct accounts cannot read or mutate each other's profile or saved skills
- an author can submit an authorized public GitHub `SKILL.md` at one immutable full commit; an invalid path preserves the safe form values and creates no row
- the server-only worker can claim the exact queued row, fetch inert bounded source bytes, emit audit and provisional-grade receipts, and never expose its service credential to the web process
- an operator can review and publish the receipt-bound metadata; the public detail, audit, and grade routes show the exact current version, findings, safe reason codes, and a visibly letterless provisional score
- a second account can submit a suspicious-listing report and see only its own immutable report history; a no-action disposition leaves catalog state unchanged, while a confirmed disposition atomically quarantines or revokes the exact reported version and retains its original enforcement outcome for replay
- deprecate, quarantine, revoke, and receipt-backed restore actions preserve public lifecycle history and cannot be performed by the browser or ordinary authenticated role
- withdrawing a queued owner submission works, and deleting an account removes its private rows plus any derived public projection covered by the deletion contract
- auth cookies are `Secure`, `HttpOnly`, and appropriately `SameSite`
- `/support` exposes the approved reachable support, appeal, and confidential security-intake page; no private-repository-only link is treated as public support
- no secret/service-role key appears in HTML, JavaScript, logs, screenshots, or deployment metadata
- desktop and 390px browser checks, a hydrated landing-page interaction with zero CSP console violations, accessibility checks, performance budgets, and the approved web host's error logs pass

Run the composed local browser contract with `npm run test:hosted-gates`; its launch pass receipt is valid only after fatal zero-row cleanup verifies every synthetic auth user and exact synthetic publisher/repository/skill/version row are absent. Then reproduce the submission-to-publication, report, lifecycle, deletion, and support checks against the exact deployment using redacted live receipts. The application limiter is a per-instance private-alpha safeguard. A provider-level/global abuse control is still required before public alpha.

## Promotion from private pilot to public alpha

Do not change either indexing variable until all live acceptance items pass, the encrypted off-host restore and web rollback are proven, the reviewed initial corpus is public, the policy/retention version and owners are approved, `SKILLMAP_SUPPORT_URL` is reachable, and the hosted pilot, not a private owner-only rehearsal, satisfies its mandatory workflow matrix. Record that decision against the exact deployment commit and IDs. Then set the exact pair `SKILLMAP_RELEASE_STAGE=public-alpha` and `SKILLMAP_INDEXING_MODE=public`, redeploy, and verify page-level robots metadata, the absence of `X-Robots-Tag: noindex`, and `robots.txt` allowing `/`. Any mismatch returns the decision to `NO_GO` and the private pair.

## Rollback and incident response

- Web-only defect: run the exact provider rollback command recorded before deployment against the prior immutable deployment ID, verify the restored origin, then inspect the bad deployment logs.
- Pre-user database defect: delete and recreate the isolated alpha project, reapply only the reviewed migrations, and restore an approved production backup or repopulate the owner-authorized corpus through the normal authenticated submission, current worker/evidence, review, authorization, and dual-control publication path. Never apply the checked-in local seed. Repeat the restore and live gates.
- Post-user database defect: stop invites and mutations, preserve evidence, export a backup, and forward-fix with a reviewed migration. Do not run an ad hoc destructive down migration.
- OAuth compromise: disable the GitHub provider, rotate the GitHub client secret in Supabase, revoke affected sessions, and verify callbacks before re-enabling.
- Suspected data or secret exposure: disable the deployment/provider, rotate affected credentials, preserve logs, assess the exposed boundary, and document the incident before restoring service.

No external invitations resume until the incident owner records the cause, remediation, credential rotations, rollback/restore evidence, and a fresh live acceptance result.

## Cleanup receipt

After every deployment or rehearsal:

- stop local Supabase containers and temporary web servers
- remove `/tmp/skillmap-alpha-database.types.ts` and unencrypted dumps
- remove one-off cookies, test users, saved rows, and temporary OAuth credentials
- confirm no unexpected web-preview variables or database exposed schemas remain
- record `validated locally`, `pushed`, `verified live`, `deployed`, and `blocked` as separate states
