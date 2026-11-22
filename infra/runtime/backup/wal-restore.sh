#!/usr/bin/env bash
# infra/runtime/backup/wal-restore.sh
#
# PostgreSQL `restore_command` hook for PITR recovery (`restore_command = '/opt/bslt/infra/runtime/backup/wal-restore.sh %f %p'`).
# Downloads and verifies the AES-256-GCM-encrypted WAL segment from S3 into `%p`.

set -euo pipefail

SEGMENT_NAME="${1:?Usage: wal-restore.sh <segmentName (%f)> <targetWalPath (%p)>}"
TARGET_PATH="${2:?Usage: wal-restore.sh <segmentName (%f)> <targetWalPath (%p)>}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

cd "${REPO_ROOT}"
pnpm --filter @bslt/tools exec tsx -e \
  "import { runBackupCli } from './scripts/deploy/backup'; await runBackupCli(process.argv.slice(1));" \
  wal-fetch "${SEGMENT_NAME}" "${TARGET_PATH}"
