# Hosted Alpha Deployment and Recovery Runbook

Status: pre-deployment. This runbook governs the Phase 1 private hosted alpha only. It does not authorize public release, third-party ingestion, package loading, grading, advanced routing, billing, or Stripe.

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
- `SKILLMAP_INDEXING_MODE=private-alpha`
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
4. Keep `SKILLMAP_INDEXING_MODE=private-alpha` until the read-only public-preview gate explicitly changes it.

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
- auth cookies are `Secure`, `HttpOnly`, and appropriately `SameSite`
- no secret/service-role key appears in HTML, JavaScript, logs, screenshots, or deployment metadata
- desktop and 390px browser checks, a hydrated landing-page interaction with zero CSP console violations, accessibility checks, performance budgets, and Vercel error logs pass

The application limiter is a per-instance private-alpha safeguard. A provider-level/global abuse control is still required before public preview.

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
