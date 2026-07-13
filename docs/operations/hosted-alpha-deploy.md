# Hosted Alpha Deployment and Recovery Runbook

Status: pre-deployment. This is the canonical provider, deployment, recovery, and live-acceptance handoff for the free hosted trust alpha. It permits reviewed third-party metadata-only submissions, inert static audit, provisional numeric grading, operator review, and receipt-backed publication after the gates below pass. It never authorizes submitted-code execution, package mirroring/loading, billing, checkout, paid placement, or Stripe. Private pilot comes first; public alpha and indexing require the later promotion gate.

Use this runbook together with `docs/operations/free-public-alpha-runbook.md`, which is authoritative for worker migration compatibility, submission review, publication, reports, lifecycle actions, monitoring, and daily operations.

## Ownership and approval gate

- Source and review: private `0x3-team/skillmap` on GitHub, mirrored to private Gitea.
- CI authority: the exact candidate commit must pass both jobs in `.gitea/workflows/ci.yml`.
- Incident and rollback owner: Masih Hedayati, acting as the `0x3-team` owner.
- Supabase target: an isolated 0x3-owned alpha organization and `skillmap-alpha` project in `us-east-1`. Free infrastructure is acceptable only for the private alpha; pausing and the absence of managed backups must remain visible limitations.
- Vercel target: an 0x3-owned Pro team and a `skillmap` project rooted at `apps/web`.
- Cost gate: do not create or upgrade the Vercel team until the owner explicitly approves the current Pro charge. Do not place this professional project in the personal Hobby scope.
- Repository gate: do not migrate or deploy until the hosted-foundation PR is merged and the resulting `main` commit has passed Gitea CI.

Preview deployments must remain unconfigured until a separate preview Supabase project exists. A preview must never receive production Supabase credentials.

## Secret boundary

Never commit, print into CI logs, or add to Vercel:

- Supabase access tokens, database passwords, secret/service-role keys, or JWT secrets
- GitHub OAuth client secrets
- backup encryption keys

Vercel receives only:

- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SKILLMAP_RELEASE_STAGE=private-alpha`
- `SKILLMAP_INDEXING_MODE=private-alpha`
- `SKILLMAP_SUPPORT_URL` only after the owner approves a reachable public HTTPS page containing support, formal-appeal, and confidential security-report instructions
- optional bounded rate-limit tuning values documented by the application

The GitHub OAuth client secret belongs only in Supabase Auth. Store database and backup credentials in the operator password manager and a root-only runtime secret file when automation is approved.

## Provider configuration

### Supabase project

1. Create `skillmap-alpha` in the approved isolated organization and `us-east-1`.
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
   - Site URL: the exact production Vercel origin
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

### Vercel project

1. Install the Vercel GitHub App for `0x3-team/skillmap` only.
2. Create `skillmap` in the approved 0x3 team with Root Directory `apps/web`, Next.js detection, and Node 24.x.
3. Leave Preview variables unset. Add the production variables from the secret boundary using stdin or the dashboard so values do not enter shell history.
4. Keep `SKILLMAP_RELEASE_STAGE=private-alpha` and `SKILLMAP_INDEXING_MODE=private-alpha` until the public gate explicitly changes both. Indexing requires the exact pair `public-alpha` and `public`.
5. Before public alpha, configure `SKILLMAP_SUPPORT_URL` to the approved reachable intake page, open it from the deployed `/support` page while signed out, and verify that its public and confidential reporting instructions match the approved policy. A private repository issue URL is not a public support route.

## Migration and first deployment

From a clean worktree at the reviewed `main` commit:

```bash
supabase migration list --linked
supabase db push --linked --dry-run
supabase db push --linked --include-seed
supabase gen types typescript --linked --schema api \
  | sed -e '${/^$/d;}' > /tmp/skillmap-alpha-database.types.ts
cmp /tmp/skillmap-alpha-database.types.ts apps/web/lib/supabase/database.types.ts
vercel deploy --prod --cwd apps/web
```

`--include-seed` is a one-time alpha bootstrap. Later migrations must omit it unless a reviewed reseed is explicitly intended. Record the Supabase project ref, migration versions, deployed Git commit, Vercel deployment ID/URL, and operator in the implementation ledger without recording secrets.

## Backup and restore gate

Before inviting any external user:

1. Produce a schema and data dump into a root-only temporary directory outside the repository.
2. Encrypt the dump with an operator-owned key and copy it to an off-host destination.
3. Restore into an isolated disposable Postgres/Supabase environment.
4. Verify migration history, the three approved first-party rows, account isolation, and `pg_restore`/SQL integrity.
5. Delete unencrypted temporary material and record only checksums, timestamps, row counts, and the restore result.

Free Supabase has no managed backup guarantee and may pause after inactivity. An unexercised export is not a backup receipt.

## Live acceptance

Capture evidence against the exact deployment commit:

- `/`, `/skills`, and each first-party detail return expected content with no fixture fallback
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
- a second account can submit a suspicious-listing report, see only its own immutable report history, and receive a bounded operator disposition without directly changing catalog state
- deprecate, quarantine, revoke, and receipt-backed restore actions preserve public lifecycle history and cannot be performed by the browser or ordinary authenticated role
- withdrawing a queued owner submission works, and deleting an account removes its private rows plus any derived public projection covered by the deletion contract
- auth cookies are `Secure`, `HttpOnly`, and appropriately `SameSite`
- `/support` exposes the approved reachable support, appeal, and confidential security-intake page; no private-repository-only link is treated as public support
- no secret/service-role key appears in HTML, JavaScript, logs, screenshots, or deployment metadata
- desktop and 390px browser checks, a hydrated landing-page interaction with zero CSP console violations, accessibility checks, performance budgets, and Vercel error logs pass

Run the composed local browser contract with `npm run test:hosted-gates`, then reproduce the submission-to-publication, report, lifecycle, deletion, and support checks against the exact deployment using redacted live receipts. The application limiter is a per-instance private-alpha safeguard. A provider-level/global abuse control is still required before public alpha.

## Promotion from private pilot to public alpha

Do not change either indexing variable until all live acceptance items pass, the encrypted off-host restore and web rollback are proven, the reviewed initial corpus is public, the policy/retention version and owners are approved, `SKILLMAP_SUPPORT_URL` is reachable, and the hosted pilot satisfies its mandatory workflow matrix. Record that decision against the exact deployment commit and IDs. Then set the exact pair `SKILLMAP_RELEASE_STAGE=public-alpha` and `SKILLMAP_INDEXING_MODE=public`, redeploy, and verify page-level robots metadata, the absence of `X-Robots-Tag: noindex`, and `robots.txt` allowing `/`. Any mismatch returns the decision to `NO_GO` and the private pair.

## Rollback and incident response

- Web-only defect: `vercel rollback <previous-deployment-url-or-id>`, verify the restored URL, then inspect the bad deployment logs.
- Pre-user database defect: delete and recreate the isolated alpha project, reapply the reviewed migration and seed, and repeat the restore and live gates.
- Post-user database defect: stop invites and mutations, preserve evidence, export a backup, and forward-fix with a reviewed migration. Do not run an ad hoc destructive down migration.
- OAuth compromise: disable the GitHub provider, rotate the GitHub client secret in Supabase, revoke affected sessions, and verify callbacks before re-enabling.
- Suspected data or secret exposure: disable the deployment/provider, rotate affected credentials, preserve logs, assess the exposed boundary, and document the incident before restoring service.

No external invitations resume until the incident owner records the cause, remediation, credential rotations, rollback/restore evidence, and a fresh live acceptance result.

## Cleanup receipt

After every deployment or rehearsal:

- stop local Supabase containers and temporary web servers
- remove `/tmp/skillmap-alpha-database.types.ts` and unencrypted dumps
- remove one-off cookies, test users, saved rows, and temporary OAuth credentials
- confirm no unexpected Vercel Preview variables or Supabase exposed schemas remain
- record `validated locally`, `pushed`, `verified live`, `deployed`, and `blocked` as separate states
