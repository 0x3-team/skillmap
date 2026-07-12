#!/usr/bin/env bash
set -Eeuo pipefail

stack_root="${GITEA_STACK_ROOT:-/srv/gitea}"

cd "${stack_root}"

if ! docker compose --profile runner ps --status running --services | grep -qx runner; then
  echo "Gitea Actions runner is not running; nothing to prune."
  exit 0
fi

docker compose --profile runner exec -T runner docker container prune --force --filter until=24h
docker compose --profile runner exec -T runner docker builder prune --all --force --filter until=168h
docker compose --profile runner exec -T runner docker volume prune --force

echo "Nested runner storage after pruning:"
docker compose --profile runner exec -T runner docker system df
