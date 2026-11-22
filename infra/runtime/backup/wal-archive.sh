#!/usr/bin/env bash
# infra/runtime/backup/wal-archive.sh
#
# PostgreSQL `archive_command` hook for continuous PITR (`archive_command = '/opt/bslt/infra/runtime/backup/wal-archive.sh %p %f'`).
# Encrypts each closed 16 MiB WAL segment with AES-256-GCM (AAD-bound to `%f`) and
# uploads + read-back verifies via `@bslt/protocols/s3`.

set -euo pipefail

WAL_PATH="${1:?Usage: wal-archive.sh <walPath (%p)> <segmentName (%f)>}"
SEGMENT_NAME="${2:?Usage: wal-archive.sh <walPath (%p)> <segmentName (%f)>}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

cd "${REPO_ROOT}"
pnpm --filter @bslt/tools exec tsx -e \
  "import { runBackupCli } from './scripts/deploy/backup'; await runBackupCli(process.argv.slice(1));" \
  wal-push "${WAL_PATH}" "${SEGMENT_NAME}"
