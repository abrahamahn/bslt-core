#!/usr/bin/env bash
# infra/runtime/backup/backup.sh
#
# In-VPC encrypted PostgreSQL logical backup (owner decision D13).
# Runs inside the private network on the database host (cron / systemd timer),
# creates a custom-format dump (`pg_dump -Fc --no-owner`) via the pinned
# Postgres image, verifies the archive TOC table count, encrypts with
# AES-256-GCM (`BSLTBK01`), uploads + read-back verifies over S3 SigV4
# (`@bslt/protocols/s3`), and writes Prometheus textfile freshness metrics.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
# shellcheck source=../../versions.env
. "${REPO_ROOT}/infra/versions.env"

APP_NAME="${APP_NAME:-bslt}"
BACKUP_DIR="${BACKUP_DIR:-/var/lib/${APP_NAME}/backups}"
METRICS_FILE="${BACKUP_METRICS_FILE:-/var/lib/node_exporter/textfile_collector/${APP_NAME}_backup.prom}"
MIN_DUMP_TABLES="${MIN_DUMP_TABLES:-40}"

: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL (superuser / BYPASSRLS DSN) is required}"
: "${BACKUP_ENCRYPTION_KEY:?BACKUP_ENCRYPTION_KEY (64-hex-char 32-byte key) is required}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is required}"
: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID is required}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY is required}"

mkdir -p "${BACKUP_DIR}"
STAMP="$(date -u +%Y%m%d_%H%M%SZ)"
OBJECT_NAME="${APP_NAME}_${STAMP}.dump"
LOCAL_DUMP="${BACKUP_DIR}/${OBJECT_NAME}"
trap 'rm -f "${LOCAL_DUMP}"' EXIT

docker run --rm --network host "${POSTGRES_IMAGE}" \
  pg_dump -Fc --no-owner "${BACKUP_DATABASE_URL}" > "${LOCAL_DUMP}"

TABLE_COUNT="$(docker run --rm -i "${POSTGRES_IMAGE}" pg_restore --list < "${LOCAL_DUMP}" | grep -c ' TABLE ' || true)"
if [ "${TABLE_COUNT}" -lt "${MIN_DUMP_TABLES}" ]; then
  echo "FATAL: pg_dump archive contains only ${TABLE_COUNT} tables (< ${MIN_DUMP_TABLES})" >&2
  exit 1
fi

mkdir -p "$(dirname "${METRICS_FILE}")" 2>/dev/null || METRICS_FILE=""

cd "${REPO_ROOT}"
pnpm --filter @bslt/tools exec tsx -e \
  "import { runBackupCli } from './scripts/deploy/backup'; await runBackupCli(process.argv.slice(1));" \
  upload-dump "${LOCAL_DUMP}" "${OBJECT_NAME}" "${METRICS_FILE}"
