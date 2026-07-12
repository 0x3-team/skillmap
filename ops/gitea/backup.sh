#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

stack_root="${GITEA_STACK_ROOT:-/srv/gitea}"
backup_root="${GITEA_BACKUP_ROOT:-${stack_root}/backups}"
retention_days="${GITEA_BACKUP_RETENTION_DAYS:-14}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
destination="${backup_root}/${timestamp}"
temporary="${backup_root}/.${timestamp}.tmp"

cd "${stack_root}"
mkdir -p "${backup_root}"
exec 9>"${backup_root}/.backup.lock"
flock -n 9 || { echo "A Gitea backup is already running." >&2; exit 1; }

running_services="$(docker compose --profile runner ps --status running --services)"
gitea_was_running=false
if grep -qx gitea <<<"${running_services}"; then
  gitea_was_running=true
fi
runner_was_running=false
if grep -qx runner <<<"${running_services}"; then
  runner_was_running=true
fi

recover_services() {
  original_status=$?
  trap - EXIT
  recovery_failed=false

  if [[ "${gitea_was_running}" == true ]]; then
    if ! docker compose --profile runner start gitea; then
      echo "Failed to restart Gitea after backup." >&2
      recovery_failed=true
    else
      gitea_healthy=false
      for _ in $(seq 1 60); do
        if curl -fsS http://127.0.0.1:3001/api/healthz >/dev/null 2>&1; then
          gitea_healthy=true
          break
        fi
        sleep 1
      done
      if [[ "${gitea_healthy}" != true ]]; then
        echo "Gitea did not become healthy after backup." >&2
        recovery_failed=true
      fi
    fi
  fi

  if [[ "${runner_was_running}" == true ]]; then
    if ! docker compose --profile runner start runner; then
      echo "Failed to restart the Actions runner after backup." >&2
      recovery_failed=true
    else
      runner_healthy=false
      for _ in $(seq 1 120); do
        container_id="$(docker compose --profile runner ps -q runner)"
        if [[ -n "${container_id}" ]] &&
          [[ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "${container_id}")" == healthy ]]; then
          runner_healthy=true
          break
        fi
        sleep 1
      done
      if [[ "${runner_healthy}" != true ]]; then
        echo "The Actions runner did not become healthy after backup." >&2
        recovery_failed=true
      fi
    fi
  fi

  if [[ "${recovery_failed}" == true ]]; then
    exit 1
  fi

  exit "${original_status}"
}
trap recover_services EXIT

rm -rf "${temporary}"
mkdir -p "${temporary}"

if [[ "${runner_was_running}" == true ]]; then
  docker compose --profile runner stop -t 90 runner
fi
if [[ "${gitea_was_running}" == true ]]; then
  docker compose --profile runner stop -t 60 gitea
fi

docker compose --profile runner exec -T db \
  pg_dump --username gitea --dbname gitea --format=custom --compress=9 \
  > "${temporary}/gitea-db.dump"

tar --acls --xattrs --numeric-owner -C "${stack_root}/data" \
  -czf "${temporary}/gitea-data.tar.gz" gitea
tar --acls --xattrs --numeric-owner -C "${stack_root}/data" \
  -czf "${temporary}/gitea-runner-state.tar.gz" runner
tar --acls --xattrs --numeric-owner -C "${stack_root}" \
  -czf "${temporary}/gitea-config-secrets.tar.gz" \
  compose.yml runner-config.yaml backup.sh restore-check.sh runner-prune.sh systemd \
  secrets/db_password secrets/secret_key secrets/internal_token secrets/runner_token

(
  cd "${temporary}"
  sha256sum gitea-db.dump gitea-data.tar.gz gitea-runner-state.tar.gz \
    gitea-config-secrets.tar.gz > SHA256SUMS
)

chmod -R go-rwx "${temporary}"
mv "${temporary}" "${destination}"
find "${backup_root}" -mindepth 1 -maxdepth 1 -type d -mtime "+${retention_days}" -exec rm -rf -- {} +

echo "Gitea backup completed: ${destination}"
