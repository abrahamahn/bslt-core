#!/usr/bin/env bash
# infra/runtime/backup/restore-drill.sh
#
# Automated offsite restore drill (owner decision D13):
# 1. Downloads and verifies the AES-256-GCM authentication tag of `<objectName>` from S3.
# 2. Creates a disposable scratch database on `DRILL_ADMIN_DATABASE_URL`, runs `pg_restore`,
#    verifies table count and `sys_migrations` integrity, and drops the scratch database.

set -euo pipefail

OBJECT_NAME="${1:?Usage: restore-drill.sh <objectName (e.g. bslt_20261121_030000Z.dump)>}"
: "${DRILL_ADMIN_DATABASE_URL:?DRILL_ADMIN_DATABASE_URL (superuser DSN on scratch/staging cluster) is required}"
MIN_DUMP_TABLES="${MIN_DUMP_TABLES:-40}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
# shellcheck source=../../versions.env
. "${REPO_ROOT}/infra/versions.env"

SCRATCH_DB="bslt_restore_drill_$(date -u +%s)"
TMP_DUMP="$(mktemp -t bslt-drill-XXXXXX.dump)"

cleanup() {
  rm -f "${TMP_DUMP}"
  docker run --rm --network host "${POSTGRES_IMAGE}" \
    psql "${DRILL_ADMIN_DATABASE_URL}" -v ON_ERROR_STOP=1 \
    -c "DROP DATABASE IF EXISTS \"${SCRATCH_DB}\" WITH (FORCE);" >/dev/null 2>&1 || true
}
trap cleanup EXIT

cd "${REPO_ROOT}"
pnpm --filter @bslt/tools exec tsx -e \
  "import { runBackupCli } from './scripts/deploy/backup'; await runBackupCli(process.argv.slice(1));" \
  download-dump "${OBJECT_NAME}" "${TMP_DUMP}"

docker run --rm --network host "${POSTGRES_IMAGE}" \
  psql "${DRILL_ADMIN_DATABASE_URL}" -v ON_ERROR_STOP=1 \
  -c "CREATE DATABASE \"${SCRATCH_DB}\";"

DRILL_DB_URL="${DRILL_ADMIN_DATABASE_URL%/*}/${SCRATCH_DB}"
docker run --rm -i --network host "${POSTGRES_IMAGE}" \
  pg_restore --no-owner --exit-on-error -d "${DRILL_DB_URL}" < "${TMP_DUMP}"

RESTORED_TABLES="$(docker run --rm --network host "${POSTGRES_IMAGE}" \
  psql "${DRILL_DB_URL}" -tA -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';")"

if [ "${RESTORED_TABLES}" -lt "${MIN_DUMP_TABLES}" ]; then
  echo "FATAL: restore drill restored only ${RESTORED_TABLES} tables (< ${MIN_DUMP_TABLES})" >&2
  exit 1
fi

MIGRATION_COUNT="$(docker run --rm --network host "${POSTGRES_IMAGE}" \
  psql "${DRILL_DB_URL}" -tA -c "SELECT count(*) FROM sys_migrations;")"

if [ "${MIGRATION_COUNT}" -lt 1 ]; then
  echo "FATAL: restore drill found 0 rows in sys_migrations" >&2
  exit 1
fi

echo "Restore drill OK: ${OBJECT_NAME} -> ${SCRATCH_DB} (${RESTORED_TABLES} tables, ${MIGRATION_COUNT} recorded migrations)"
