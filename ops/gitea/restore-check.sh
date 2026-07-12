#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

stack_root="${GITEA_STACK_ROOT:-/srv/gitea}"
backup_root="${GITEA_BACKUP_ROOT:-${stack_root}/backups}"
backup="${1:-}"

if [[ -z "${backup}" ]]; then
  backup="$(find "${backup_root}" -mindepth 1 -maxdepth 1 -type d -printf '%p\n' | sort | tail -n 1)"
fi
[[ -d "${backup}" ]] || { echo "No backup directory found." >&2; exit 1; }

required_archives=(
  gitea-db.dump
  gitea-data.tar.gz
  gitea-runner-state.tar.gz
  gitea-config-secrets.tar.gz
  SHA256SUMS
)
for archive in "${required_archives[@]}"; do
  [[ -s "${backup}/${archive}" ]] || { echo "Missing backup artifact: ${archive}" >&2; exit 1; }
done

(
  cd "${backup}"
  sha256sum --check SHA256SUMS
  tar -tzf gitea-data.tar.gz >/dev/null
  tar -tzf gitea-runner-state.tar.gz >/dev/null
  tar -tzf gitea-config-secrets.tar.gz >/dev/null
  if tar -tzf gitea-config-secrets.tar.gz | grep -Eq '(^|/)(admin_initial_password|bootstrap_api_token)$'; then
    echo "Backup contains a transient privileged credential." >&2
    exit 1
  fi
)

suffix="$$-$(openssl rand -hex 4)"
network="gitea-restore-check-${suffix}"
db_container="gitea-restore-db-${suffix}"
app_container="gitea-restore-app-${suffix}"
workspace="$(mktemp -d /tmp/gitea-restore-check.XXXXXX)"
password="$(openssl rand -hex 24)"
check_password="$(openssl rand -hex 24)"

cleanup() {
  docker rm -f "${app_container}" "${db_container}" >/dev/null 2>&1 || true
  docker network rm "${network}" >/dev/null 2>&1 || true
  rm -rf "${workspace}"
}
trap cleanup EXIT

tar --acls --xattrs --numeric-owner -xzf "${backup}/gitea-data.tar.gz" -C "${workspace}"
tar --acls --xattrs --numeric-owner -xzf "${backup}/gitea-config-secrets.tar.gz" \
  -C "${workspace}" secrets/secret_key secrets/internal_token

docker network create --internal "${network}" >/dev/null
docker run -d --name "${db_container}" --network "${network}" \
  -e POSTGRES_PASSWORD="${password}" \
  docker.io/library/postgres:17.9-alpine@sha256:c7526c0f6c3f30260a563d7bcf8ad778effac59a44f8ffa86678c35418338609 \
  >/dev/null

db_ready=false
for _ in $(seq 1 60); do
  if docker exec "${db_container}" pg_isready -U postgres >/dev/null 2>&1; then
    db_ready=true
    break
  fi
  sleep 1
done
[[ "${db_ready}" == true ]] || { echo "Restore-check PostgreSQL did not become ready." >&2; exit 1; }

docker exec "${db_container}" createdb -U postgres gitea_restore
docker exec -i "${db_container}" pg_restore \
  -U postgres -d gitea_restore --no-owner --no-privileges \
  < "${backup}/gitea-db.dump"

table_count="$(docker exec "${db_container}" psql -U postgres -d gitea_restore -Atc \
  "select count(*) from information_schema.tables where table_schema = 'public';")"
[[ "${table_count}" =~ ^[0-9]+$ && "${table_count}" -gt 0 ]] || {
  echo "Restored database contains no public tables." >&2
  exit 1
}

docker run -d --name "${app_container}" --network "${network}" \
  -e USER_UID=1000 \
  -e USER_GID=1000 \
  -e GITEA__database__DB_TYPE=postgres \
  -e GITEA__database__HOST="${db_container}:5432" \
  -e GITEA__database__NAME=gitea_restore \
  -e GITEA__database__USER=postgres \
  -e GITEA__database__PASSWD="${password}" \
  -e GITEA__database__SSL_MODE=disable \
  -e GITEA__server__ROOT_URL=http://localhost:3000/ \
  -e GITEA__server__LOCAL_ROOT_URL=http://localhost:3000/ \
  -e GITEA__server__START_SSH_SERVER=false \
  -e GITEA__security__INSTALL_LOCK=true \
  -e GITEA__security__SECRET_KEY__FILE=/run/recovery-secrets/secret_key \
  -e GITEA__security__INTERNAL_TOKEN__FILE=/run/recovery-secrets/internal_token \
  -e GITEA__service__DISABLE_REGISTRATION=true \
  --mount "type=bind,src=${workspace}/gitea,dst=/data" \
  --mount "type=bind,src=${workspace}/secrets,dst=/run/recovery-secrets,readonly" \
  docker.gitea.com/gitea:1.26.4@sha256:8e25c717b8f748445e15ec46e0390f577cb628101184cb0a150d1dae126c1f39 \
  >/dev/null

app_healthy=false
for _ in $(seq 1 90); do
  if docker exec "${app_container}" curl -fsS http://localhost:3000/api/healthz >/dev/null 2>&1; then
    app_healthy=true
    break
  fi
  sleep 1
done
[[ "${app_healthy}" == true ]] || {
  docker logs --tail=100 "${app_container}" >&2
  echo "Restored Gitea did not become healthy." >&2
  exit 1
}

repository_count="$(docker exec "${db_container}" psql -U postgres -d gitea_restore -Atc \
  'select count(*) from repository;')"
[[ "${repository_count}" =~ ^[0-9]+$ ]] || { echo "Could not count restored repositories." >&2; exit 1; }

if [[ "${repository_count}" -gt 0 ]]; then
  canary="$(docker exec "${db_container}" psql -U postgres -d gitea_restore -Atc \
    'select u.name || '\''/'\'' || r.name from repository r join "user" u on u.id = r.owner_id order by r.id limit 1;')"
  docker exec --user git "${app_container}" gitea admin user create \
    --username restorecheck --password "${check_password}" \
    --email restorecheck@invalid.local --admin --must-change-password=false >/dev/null
  docker exec -e CHECK_PASSWORD="${check_password}" -e CANARY="${canary}" \
    "${app_container}" sh -ceu '
    rm -rf /tmp/recovery-canary.git
    git clone --quiet --mirror "http://restorecheck:${CHECK_PASSWORD}@localhost:3000/${CANARY}.git" /tmp/recovery-canary.git
    git --git-dir=/tmp/recovery-canary.git fsck --full
  '
fi

echo "Gitea recovery check passed (${table_count} tables, ${repository_count} repositories): ${backup}"
