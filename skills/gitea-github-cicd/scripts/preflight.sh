#!/usr/bin/env bash
# Read-only preflight for the Gitea Actions -> GitHub promotion route.
set -uo pipefail

default_gitea_url="https://codex-linode.tail67a423.ts.net/"
repo="."
gitea_url="$default_gitea_url"
gitea_remote="gitea"
github_remote=""

usage() {
  cat <<'USAGE'
Usage: preflight.sh [options]

Read-only readiness check for a Git worktree that must validate on Gitea
Actions before the same commit is pushed to GitHub.

Options:
  --repo PATH              Repository worktree (default: current directory)
  --gitea-url URL          Gitea HTTPS endpoint
  --gitea-remote NAME      Expected Gitea Git remote (default: gitea)
  --github-remote NAME     Expected GitHub Git remote (auto-detect if omitted)
  -h, --help               Show this help

Exit codes:
  0  Route is configured enough to begin authenticated CI work.
  2  PATH is not a committed Git worktree.
  3  Route is incomplete or the Gitea endpoint is unreachable.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      repo="${2:?--repo requires a path}"
      shift 2
      ;;
    --gitea-url)
      gitea_url="${2:?--gitea-url requires a URL}"
      shift 2
      ;;
    --gitea-remote)
      gitea_remote="${2:?--gitea-remote requires a name}"
      shift 2
      ;;
    --github-remote)
      github_remote="${2:?--github-remote requires a name}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'error: unknown option: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

redact_url() {
  sed -E 's#(https?://)[^/@[:space:]]+@#\1***@#'
}

remote_url() {
  git -C "$repo" remote get-url "$1" 2>/dev/null | redact_url
}

if ! git -C "$repo" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  printf 'result=not-a-git-worktree repo=%s\n' "$repo" >&2
  exit 2
fi

if ! git -C "$repo" rev-parse --verify HEAD >/dev/null 2>&1; then
  printf 'result=unborn-branch repo=%s\n' "$repo" >&2
  exit 2
fi

repo="$(git -C "$repo" rev-parse --show-toplevel)"
branch="$(git -C "$repo" branch --show-current)"
head_sha="$(git -C "$repo" rev-parse HEAD)"
dirty_count="$(git -C "$repo" status --porcelain | wc -l | tr -d ' ')"

printf 'repo=%s\nbranch=%s\nhead=%s\ndirty_paths=%s\n' "$repo" "$branch" "$head_sha" "$dirty_count"

remotes=()
while IFS= read -r remote; do
  [[ -n "$remote" ]] && remotes+=("$remote")
done < <(git -C "$repo" remote)
if [[ ${#remotes[@]} -eq 0 ]]; then
  printf 'git_remotes=none\n'
else
  for remote in "${remotes[@]}"; do
    printf 'remote.%s=%s\n' "$remote" "$(remote_url "$remote")"
  done
fi

if [[ -z "$github_remote" ]]; then
  for remote in "${remotes[@]}"; do
    if git -C "$repo" remote get-url "$remote" 2>/dev/null | grep -Eq '(^|@|/)(github\.com)(:|/)'; then
      github_remote="$remote"
      break
    fi
  done
fi

missing=0
if git -C "$repo" remote get-url "$gitea_remote" >/dev/null 2>&1; then
  printf 'gitea_remote=%s\n' "$gitea_remote"
else
  printf 'gitea_remote=missing (%s)\n' "$gitea_remote"
  missing=1
fi

if [[ -n "$github_remote" ]] && git -C "$repo" remote get-url "$github_remote" >/dev/null 2>&1; then
  printf 'github_remote=%s\n' "$github_remote"
else
  printf 'github_remote=missing\n'
  missing=1
fi

if command -v curl >/dev/null 2>&1; then
  status="$(curl -sS -L -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 10 "$gitea_url" 2>/dev/null || true)"
  if [[ "$status" =~ ^[1-5][0-9][0-9]$ ]]; then
    printf 'gitea_https=reachable status=%s url=%s\n' "$status" "$gitea_url"
  else
    printf 'gitea_https=unreachable url=%s\n' "$gitea_url"
    missing=1
  fi
else
  printf 'gitea_https=not-checked (curl unavailable)\n'
  missing=1
fi

shopt -s nullglob
gitea_workflows=("$repo"/.gitea/workflows/*.yml "$repo"/.gitea/workflows/*.yaml)
github_workflows=("$repo"/.github/workflows/*.yml "$repo"/.github/workflows/*.yaml)
printf 'gitea_workflows=%s\ngithub_workflows=%s\n' "${#gitea_workflows[@]}" "${#github_workflows[@]}"

if [[ -x "$repo/scripts/verify.sh" ]]; then
  printf 'verify_script=%s\n' "$repo/scripts/verify.sh"
elif [[ -f "$repo/scripts/verify.sh" ]]; then
  printf 'verify_script=not-executable (%s)\n' "$repo/scripts/verify.sh"
else
  printf 'verify_script=not-found\n'
fi

if [[ -z "$branch" ]]; then
  printf 'result=detached-head\n' >&2
  exit 3
fi

if [[ "$missing" -ne 0 ]]; then
  printf 'result=route-incomplete\n' >&2
  exit 3
fi

printf 'result=route-ready\n'
