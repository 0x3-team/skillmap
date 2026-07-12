# Server-wide Gitea operations

This directory is the reviewed source for the shared private Gitea installation
on `codex-linode`. The live stack is installed at `/srv/gitea`, managed by
`gitea-stack.service`, and available only through the owner's Tailscale network.
It is not coupled to the SkillMap runtime: any owner-controlled project can use
the Git host and the instance-level Actions runner.

## Pinned components

- Gitea `1.26.4`
- PostgreSQL `17.9-alpine`
- Gitea `act_runner` `0.2.11-dind-rootless`

Every container reference includes a registry digest. Update the tag and digest
together after reviewing the upstream release notes and taking a verified backup.

## Network boundary

- Web: `https://codex-linode.tail67a423.ts.net/` through Tailscale Serve.
- Git SSH: `ssh://git@codex-linode.tail67a423.ts.net:2222/...` through a
  Tailscale TCP forwarder.
- Container HTTP and SSH ports bind only to host loopback.
- Registration is disabled, sign-in is required, and repositories are forced
  private by default.
- Authenticated owners can create private user or organization repositories by
  pushing to a new path.

Do not enable Funnel or expose ports 3001/2222 on the public interface. A future
public domain requires a separate DNS, TLS, abuse, mail, recovery, and security
review.

## Runner boundary

The instance-level runner has capacity one and uses rootless Docker-in-Docker.
It does not mount the host Docker socket, so jobs control a nested Docker daemon
instead of the host daemon. The job image and all workflow actions are pinned.

This reduces direct host access; it is not a hard sandbox. The outer runner is a
privileged container and still shares the host's kernel, network, CPU, memory,
and disk. Use it only for repositories and workflow changes controlled by the
owner. Do not run workflows from untrusted forks. Move CI to a dedicated worker
VM before allowing outside contributors or privileged deployment credentials.
Job containers share the nested rootless daemon's host network so Docker-based
tools such as the Supabase CLI can reach sibling containers on `127.0.0.1`.

## Add any project

The server user's SSH config defines the `gitea-0x3` host alias. From any Git
repository, choose a private repository name and push it; Gitea creates the
missing organization repository on first push:

```bash
git remote add gitea gitea-0x3:0x3-team/<repository>.git
git push -u gitea HEAD
```

Add workflows under `.gitea/workflows/` and target `runs-on: ubuntu-latest`.
The shared runner processes one job at a time. The original `origin` remote can
remain GitHub; use `gitea` for the self-hosted CI authority.

## Live operations

```bash
cd /srv/gitea
sudo systemctl status gitea-stack.service
sudo docker compose ps
sudo docker compose logs --tail=200 gitea db
sudo docker compose --profile runner logs --tail=200 runner
sudo docker compose pull
sudo docker compose up -d
sudo docker compose --profile runner up -d runner
```

The initial administrator password is stored at
`/srv/gitea/secrets/admin_initial_password` with root-only permissions. It must
be changed at first login. Never paste it into an issue, workflow, log, or chat.

## Backup and recovery

The daily timer stops the runner and Gitea briefly, dumps PostgreSQL with native
`pg_dump`, archives Gitea and runner state plus an explicit allowlist of required
recovery secrets, hashes the result, restarts the services, and retains 14 days
locally. Transient administrator and bootstrap credentials are never archived.
The recovery check restores into an isolated network, boots the restored Gitea,
and performs an authenticated mirror clone plus `git fsck` on a canary repository.

```bash
sudo systemctl status gitea-backup.timer
sudo systemctl start gitea-backup.service
sudo /srv/gitea/restore-check.sh
sudo systemctl status gitea-runner-prune.timer
```

The weekly prune timer removes old stopped job containers, old build cache, and
unused anonymous volumes while preserving named caches and digest-pinned CI
images. Image retirement is an explicit maintenance action because Docker treats
digest-only images as dangling. Container logs rotate at 20 MiB x five files.

Local backups protect against application mistakes but not loss of this Linode.
An encrypted off-host backup destination remains required before this becomes
the only authoritative copy of any repository.

## GitHub coexistence

Gitea is the CI authority while GitHub remains a private secondary host. Avoid a
bidirectional force-push mirror. Push reviewed branches explicitly to both
remotes, or configure a one-way Gitea-to-GitHub mirror only after the GitHub
token has the required repository and workflow permissions.

The `main` branch is protected from ordinary direct pushes and all force pushes.
Pull requests must be current and free of rejected reviews. The owner-only admin
override exists solely for audited fast-forward synchronization from the reviewed
GitHub `main`; it is not a substitute for a passing exact-commit Gitea Actions run.
The protected branch requires `Gitea CI / CLI contracts and web (push)` and
`Gitea CI / Hosted catalog migrations and RLS (push)`, captured from the passing
hosted-foundation candidate. These jobs cover root/web quality and the isolated
database reset, lint, pgTAP, and generated-type gates. The full public API and
authenticated browser smokes remain separate local acceptance gates until the
runner supports the complete disposable Supabase service stack. Never place
Supabase, Vercel, OAuth, signing, or deployment credentials in this shared
privileged runner.

Hosted-foundation feature run 14 passed both required contexts at
`00e29a442b3ef03345f25970aa2abff4655d259d`, and main run 15 passed them at
`295dffe031d3010bb241ade75e9f249c97cd6063`; those commits share tree
`3a163cf577eef73b832c2947c6e01332e1c4ecca`. Phase 1 final-product feature run
18 later reconfirmed them at `1427e277e46315de5792a973deded1af4c274195`,
and main run 19 reconfirmed them at
`f9ea0fa0d9711b5b0a61d24555ed9102fff20eb3`; those commits share tree
`be96e2a71f2b38ded52ac6e1077ebbcd1dc0bbc1`.
