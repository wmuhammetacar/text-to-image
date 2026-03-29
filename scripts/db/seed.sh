#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL zorunlu" >&2
  exit 1
fi

DB_CONTAINER_NAME="${DB_CONTAINER_NAME:-vi_local_db}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-visual_intelligence}"

run_psql_file() {
  local file="$1"
  if command -v psql >/dev/null 2>&1; then
    psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -f "${file}"
    return
  fi

  if ! command -v docker >/dev/null 2>&1; then
    echo "psql bulunamadi ve docker komutu yok" >&2
    exit 1
  fi

  if ! docker ps --format '{{.Names}}' | grep -qx "${DB_CONTAINER_NAME}"; then
    echo "psql bulunamadi ve ${DB_CONTAINER_NAME} calismiyor" >&2
    exit 1
  fi

  docker exec -i "${DB_CONTAINER_NAME}" \
    psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -v ON_ERROR_STOP=1 -f - < "${file}"
}

echo "[db:seed] seed uygulaniyor"
run_psql_file "supabase/seed.sql"

echo "[db:seed] tamamlandi"
