#!/usr/bin/env bash
# main/tools/scripts/deploy/backup-database.sh
#
# Nightly logical backup of the production database, run ON the host that has
# the database.
#
# It does NOT go through GitHub Actions, and that is the whole design. A backup
# routed through CI inherits CI's dependencies: hosted minutes, a network path
# from the runner to production, and secrets that must be configured before the
# job does anything. Miss any one of those and the job still reports green —
# which is exactly what `.github/workflows/database-backup.yml` did, skipping
# every night with a `::notice::` when its secrets were absent. A backup whose
# failure mode is a green tick is worse than no backup, because it buys false
# confidence.
#
# A backup should have FEWER dependencies than the thing it protects, so this
# runs where the database already is, on a host that is already always on.
#
# The local copy is an undo button, not a backup: lose the host and you lose the
# database and every dump beside it. Offsite is the point, so a missing upload
# is a FAILURE here, never a warning.
#
# Install: see docs/deploy/backup-restore.md. Run as root from cron.

set -euo pipefail

APP_NAME="${APP_NAME:-bslt}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-${APP_NAME}-production}"
COMPOSE_DIR="${COMPOSE_DIR:-/opt/${APP_NAME}/production}"
BACKUP_DIR="${BACKUP_DIR:-/opt/${APP_NAME}/backups}"
# How long a dump survives on the host. Offsite retention is set on the bucket,
# not here — see docs/deploy/backup-restore.md.
LOCAL_RETENTION_DAYS="${LOCAL_RETENTION_DAYS:-7}"
# A byte floor catches a catastrophically empty dump, but it is a weak guard on
# its own: on this database the SCHEMA is most of the bytes, so a dump that lost
# every row but kept its structure would still clear any size threshold.
#
# So the real check is structural: the dump must contain the tables we know
# exist. That is what actually distinguishes a good dump from a truncated one.
# Tune MIN_DUMP_TABLES to your schema — `\dt` in psql gives the current count,
# and setting it near (not at) that number leaves room for growth.
MIN_DUMP_BYTES="${MIN_DUMP_BYTES:-10000}"
MIN_DUMP_TABLES="${MIN_DUMP_TABLES:-40}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { trap - ERR; log "FATAL: $*" >&2; exit 1; }

# Every `set -e` death gets a line number and a loud word. Without this trap a
# failure before the explicit guards below — an unreadable .env, say — exits in
# total silence with a nonzero status, and a backup job whose failures are
# silent is the problem, not the fix.
trap 'die "unexpected failure at line ${LINENO}"' ERR

command -v docker >/dev/null || die "docker not found"
[ -d "$COMPOSE_DIR" ] || die "compose dir $COMPOSE_DIR not found"
mkdir -p "$BACKUP_DIR"

cd "$COMPOSE_DIR"
[ -f .env ] || die "no .env in $COMPOSE_DIR — cannot read POSTGRES_USER/POSTGRES_DB"

# `|| true` so a missing key reaches the explicit check below with a readable
# message, instead of tripping the ERR trap with a line number and no context.
PG_USER="$(grep '^POSTGRES_USER' .env | cut -d= -f2- || true)"
PG_DB="$(grep '^POSTGRES_DB' .env | cut -d= -f2- || true)"
[ -n "$PG_USER" ] || die "POSTGRES_USER missing from $COMPOSE_DIR/.env"
[ -n "$PG_DB" ] || die "POSTGRES_DB missing from $COMPOSE_DIR/.env"

STAMP="$(date -u +%Y%m%d_%H%M%SZ)"
DUMP="$BACKUP_DIR/${APP_NAME}_${STAMP}.sql.gz"

log "dumping $PG_DB as $PG_USER -> $DUMP"

# `set -o pipefail` above is what makes a pg_dump failure fail the script
# instead of writing a valid gzip of an error message.
docker compose -p "$COMPOSE_PROJECT" exec -T postgres pg_dump \
  -U "$PG_USER" -d "$PG_DB" | gzip > "$DUMP" \
  || die "pg_dump failed (is the '$COMPOSE_PROJECT' postgres service running?) — no backup was taken"

SIZE="$(stat -c %s "$DUMP")"
[ "$SIZE" -ge "$MIN_DUMP_BYTES" ] || die "dump is only ${SIZE}B (< ${MIN_DUMP_BYTES}B) — refusing to treat it as a backup"

# Prove it is a readable archive before trusting it. gzip -t catches the
# truncated-write case, which is otherwise invisible until a restore.
gzip -t "$DUMP" || die "dump failed gzip integrity check"

# And prove it contains a database. A gzip that unpacks cleanly can still hold
# half a schema and no rows; counting the tables is what tells them apart.
TABLES="$(gunzip -c "$DUMP" | grep -c '^CREATE TABLE' || true)"
[ "$TABLES" -ge "$MIN_DUMP_TABLES" ] \
  || die "dump holds only $TABLES tables (< $MIN_DUMP_TABLES) — truncated or wrong database"

log "dump ok (${SIZE} bytes, ${TABLES} tables)"

# ---------------------------------------------------------------- offsite --
# Configured via /etc/${APP_NAME}-backup.env (see docs/deploy/backup-restore.md).
# Absent config is a HARD failure: a local-only dump is not a backup, and
# silently degrading to one is the failure mode this script exists to prevent.
#
# BACKUP_ALLOW_LOCAL_ONLY=1 is the ONE exception, and it is deliberately awkward
# to reach: it must be set explicitly, it says so on every single run, and it
# exits non-zero at the end so a cron that mails on failure keeps nagging.
#
# It exists because the alternative was worse. Offsite needs a bucket and keys
# only the operator can create; until those exist the honest choice is not "no
# backup" but "a local dump that never lets you forget it is not one". A local
# copy still restores a bad migration, an app bug or a bad DELETE — it just dies
# with the host, which is the one case it cannot help with.
if [ -z "${BACKUP_S3_BUCKET:-}" ]; then
  if [ "${BACKUP_ALLOW_LOCAL_ONLY:-}" = "1" ]; then
    log "WARNING: no BACKUP_S3_BUCKET — this dump exists ONLY on this host."
    log "WARNING: that is not a backup. Lose the host and you lose the"
    log "WARNING: database and every copy of it together. Configure offsite:"
    log "WARNING: docs/deploy/backup-restore.md section 1."
    find "$BACKUP_DIR" -name "${APP_NAME}_*.sql.gz" -mtime "+${LOCAL_RETENTION_DAYS}" -delete
    log "done (LOCAL ONLY — offsite still not configured)"
    exit 3
  fi
  die "BACKUP_S3_BUCKET not set — refusing to keep a local-only copy (set BACKUP_ALLOW_LOCAL_ONLY=1 to accept that explicitly)"
fi

S3_PREFIX="${BACKUP_S3_PREFIX:-db-backups}"
TARGET="s3://${BACKUP_S3_BUCKET}/${S3_PREFIX}/$(basename "$DUMP")"

AWS_ARGS=()
[ -n "${BACKUP_S3_ENDPOINT:-}" ] && AWS_ARGS+=(--endpoint-url "$BACKUP_S3_ENDPOINT")

log "uploading -> $TARGET"
aws "${AWS_ARGS[@]}" s3 cp "$DUMP" "$TARGET" --only-show-errors \
  || die "upload failed — the local copy exists but there is NO offsite backup"

# Read it back. An upload that reports success but stored nothing is precisely
# the class of failure this script exists to rule out, so we ask the bucket.
aws "${AWS_ARGS[@]}" s3 ls "$TARGET" >/dev/null \
  || die "upload reported success but the object is not in the bucket"

log "offsite ok"

# ---------------------------------------------------------------- prune ----
# Local only. Offsite retention belongs to a bucket lifecycle rule, so a bug in
# this script can never delete the offsite history.
find "$BACKUP_DIR" -name "${APP_NAME}_*.sql.gz" -mtime "+${LOCAL_RETENTION_DAYS}" -delete
log "done"
