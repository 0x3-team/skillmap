---
name: gitea-github-cicd
description: Validate repository changes through a server-hosted Gitea Actions route and then push the identical verified commit to GitHub. Use when a user asks to set up, repair, run, migrate, or operate CI/CD with Gitea on codex-linode, Gitea Actions, Gitea Runner, GitHub remotes, or a Gitea-before-GitHub quality gate.
---

# Gitea-to-GitHub CI/CD

Use Gitea on the Linode as the CI control plane and runner host. Treat GitHub as the downstream canonical remote only after Gitea Actions reports a green run for the exact commit that will be pushed.

## Guardrails

- Start with the target repository, branch, Gitea remote, GitHub remote, and verification command. Do not infer a repository from unrelated directories.
- Run `scripts/preflight.sh` before changing remotes, workflows, or server state. A nonzero result is a stop-and-fix signal, not permission to guess.
- Preserve dirty worktrees and existing remotes. Never force-push, rewrite history, expose credentials, or print token-bearing remote URLs.
- Gitea Runner only executes jobs dispatched by Gitea; it cannot make a GitHub-hosted Actions workflow run locally.
- Do not claim a Gitea validation is green until the Gitea Actions run for the candidate commit has completed successfully. Do not push that commit to GitHub first.

## Server-first route

For `codex-linode`, read [references/codex-linode.md](references/codex-linode.md) before connecting. Recheck its live state through SSH each time; versions, ports, runner health, and access policy can drift.

1. Anchor the repository.

   ```bash
   /Users/stevmq/.codex/skills/gitea-github-cicd/scripts/preflight.sh \
     --repo /absolute/path/to/repo \
     --gitea-remote gitea \
     --github-remote github
   ```

   If the repository has a different remote name, pass it explicitly. If no repository is supplied or the directory is not a Git worktree, stop and ask for the repository path or GitHub URL.

2. Authenticate without leaking credentials.

   - Use the Gitea HTTPS endpoint for browser, Tea, or MCP access and the clone URL displayed by Gitea for Git-over-SSH.
   - Require an existing Gitea account, its SSH key or a least-privilege PAT, and the user-authorized target repository. Registration is intentionally disabled on the current server.
   - Keep tokens in the approved credential store or environment; never write them to a remote URL, workflow, repository file, terminal transcript, or skill reference.

3. Make the Gitea candidate runnable.

   - Reuse the project's existing verification command, scripts, package manager, and CI conventions. Read local `AGENTS.md`, README, package scripts, and existing workflows before editing.
   - Add or update `.gitea/workflows/<name>.yaml` only when the Gitea workflow is missing or needs a deliberate fix. Prefer a push/PR-triggered workflow that calls the same verification command used locally.
   - Run the focused verification locally first. Commit only scoped changes after it succeeds.
   - Push the candidate commit to the Gitea remote and wait for the corresponding Gitea Actions run. Inspect its logs on failure; fix the cause and repeat rather than bypassing the gate.

4. Promote the identical commit to GitHub.

   - Confirm `git rev-parse HEAD` is the SHA validated by Gitea Actions.
   - Push explicitly: `git push <github-remote> HEAD:<branch>`.
   - Verify the remote branch SHA with `git ls-remote <github-remote> refs/heads/<branch>`.
   - Report separately: local verification, Gitea Actions result, GitHub push, and any deployment result. A GitHub push is not proof of deployment.

## Optional local clients

Install only clients locally: Git is required; Tea is useful for terminal administration; the official Gitea MCP server is useful for agent-mediated repository operations. Do not install a duplicate Gitea, Postgres, or Linux runner on the Mac unless the task specifically needs offline work or macOS-only CI.

## Failure handling

- **No Gitea credentials or repository:** stop before import/push and request the account, PAT/SSH-key setup, and target repository.
- **Gitea workflow incompatibility:** consult the current Gitea Actions comparison documentation, make the smallest compatible change, and validate again.
- **Gitea is green but GitHub push fails:** preserve the verified commit; diagnose the GitHub remote, permissions, branch protection, or network error without rerunning unrelated work.
- **GitHub is green but Gitea is not:** do not treat GitHub as a substitute for this server-first gate unless the user explicitly changes the policy.

## Resource

- `scripts/preflight.sh` — read-only local/Gitea-route preflight. It never commits, edits, authenticates, imports, or pushes.
- `references/codex-linode.md` — current non-secret server routing facts and revalidation commands.
