# Codex Linode Gitea route

Use this only for a `codex-linode` task. Treat every fact below as routing context, then verify live before modifying a repository or service.

## Current route

- Admin SSH alias: `codex-linode`
- Gitea HTTPS root: `https://codex-linode.tail67a423.ts.net/`
- Gitea Git SSH port: `2222`; use the clone URL Gitea displays rather than inventing a remote path.
- The current stack is Docker-managed by `gitea-stack.service`: Gitea, Postgres, and one rootless Gitea Actions Runner.
- Registration is disabled and sign-in is required. Use an existing account with an SSH key or scoped PAT; never put that credential into a remote URL or checked-in file.

## Live revalidation

Run this read-only check before use:

```bash
ssh codex-linode '
  docker exec gitea-gitea-1 gitea --version
  docker exec gitea-runner-1 act_runner --version
  docker ps --format "{{.Names}} | {{.Status}}" | grep "^gitea-"
'
```

From the Mac, verify the web route without authenticating:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://codex-linode.tail67a423.ts.net/
```

A successful HTTP response proves reachability only. An authenticated Gitea API call or Actions run is required to prove repository access and CI execution.
