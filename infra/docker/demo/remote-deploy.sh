#!/usr/bin/env bash
# infra/docker/demo/remote-deploy.sh
#
# Droplet-side deploy step, run as root in DEMO_DIR (default /opt/bslt/demo), the
# directory its caller synced the stack files to, versions.env and
# .env.production.example among them. Where the images come from (IMAGE_SOURCE):
#
#   ghcr     (default) the `demo` job of deploy.yml, over SSH. Pulls the
#            pre-built ghcr images of a commit. Requires IMAGE_TAG, OWNER and
#            GHCR_TOKEN.
#   loaded   the workstation deploy runner, which `docker load`ed the images it
#            built before it ran this script. Requires API_IMAGE and WEB_IMAGE,
#            their tags. No registry login, no pull, and no image prune: the
#            runner keeps the previous images for its rollback.
#
# Both require PUBLIC_HOST; the public origin is https://PUBLIC_HOST unless
# PUBLIC_BASE_URL says otherwise.
#
# Then, either way: regenerate .env (secrets persist) with the deployed images
# pinned in it, bootstrap the database roles, run the migrations, and recreate
# api and web. Only those two: caddy is the edge of the whole host and also
# serves other sites, so no deploy stops, starts or recreates it. Idempotent.
# `set -e` below is what stops a failed bootstrap or migration from reaching
# api and web.
#
# The demo database is disposable. Its volume is dropped, and the database
# starts empty, in two cases:
#   - the volume holds a cluster of another Postgres major than
#     infra/versions.env pins (the new image would crash-loop on it);
#   - the migrate job exits 3: the database was built from other baselines than
#     this image ships. The baselines are edited in place until foundation-v1
#     (restructure plan 9.3), so such a database is rebuilt, not migrated.
#     Remove this case when the baselines freeze: from then on a changed
#     baseline is an error, here as in production.
set -euo pipefail

IMAGE_SOURCE="${IMAGE_SOURCE:-ghcr}"
case "$IMAGE_SOURCE" in
  ghcr)
    : "${IMAGE_TAG:?IMAGE_TAG required}"
    : "${OWNER:?OWNER required}"
    : "${GHCR_TOKEN:?GHCR_TOKEN required}"
    API_IMAGE="ghcr.io/${OWNER}/bslt-api:${IMAGE_TAG}"
    WEB_IMAGE="ghcr.io/${OWNER}/bslt-web:${IMAGE_TAG}"
    ;;
  loaded)
    : "${API_IMAGE:?API_IMAGE required}"
    : "${WEB_IMAGE:?WEB_IMAGE required}"
    ;;
  *)
    echo "IMAGE_SOURCE must be ghcr or loaded, not '${IMAGE_SOURCE}'" >&2
    exit 2
    ;;
esac
: "${PUBLIC_HOST:?PUBLIC_HOST required}"
export API_IMAGE WEB_IMAGE

cd "${DEMO_DIR:-/opt/bslt/demo}"

POSTGRES_MAJOR="$(sed -n 's/^POSTGRES_MAJOR=\([0-9][0-9]*\)$/\1/p' versions.env)"
: "${POSTGRES_MAJOR:?versions.env names no POSTGRES_MAJOR}"

if [ "$IMAGE_SOURCE" = ghcr ]; then
  echo "$GHCR_TOKEN" | docker login ghcr.io -u "$OWNER" --password-stdin
  echo "Pulling $API_IMAGE and $WEB_IMAGE"
  docker pull "$API_IMAGE"
  docker pull "$WEB_IMAGE"
else
  for image in "$API_IMAGE" "$WEB_IMAGE"; do
    if ! docker image inspect "$image" >/dev/null 2>&1; then
      echo "$image is not loaded on this host; nothing was changed" >&2
      exit 1
    fi
  done
fi

COMPOSE="docker compose -f docker-compose.demo.yml"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://${PUBLIC_HOST}}"

# Self-signed origin cert for Caddy :443 (Cloudflare "Full" mode terminates the
# public cert; the origin just needs to speak TLS). Generated once, reused.
if [ ! -f origin-cert.pem ] || [ ! -f origin-key.pem ]; then
  echo "Generating self-signed origin certificate"
  openssl req -x509 -newkey rsa:2048 -nodes -keyout origin-key.pem -out origin-cert.pem \
    -days 3650 -subj "/CN=${PUBLIC_HOST}" -addext "subjectAltName=DNS:${PUBLIC_HOST},DNS:*.${PUBLIC_HOST}" 2>/dev/null
  chmod 600 origin-key.pem
fi

# The API's local file storage, bind-mounted at /app/uploads. Docker would
# create a missing source as root, which the image's user (nodejs, uid 1001 in
# infra/docker/Dockerfile) cannot write to.
if [ ! -d uploads ]; then
  mkdir uploads
  chown 1001:1001 uploads
fi

echo "Generating .env (base ${PUBLIC_BASE_URL})"
bash generate-env.sh .env.production.example .env "$PUBLIC_BASE_URL"
# Compose also reads .env to resolve the compose file's variables. With the
# images pinned there, every later `docker compose` on this host (an
# operator's, a restart) runs the images of this deploy, not the defaults.
printf 'API_IMAGE=%s\nWEB_IMAGE=%s\n' "$API_IMAGE" "$WEB_IMAGE" >> .env

# Drop the database with its volume. Only the database and the API that holds
# its connections: caddy keeps serving the other sites on this host.
reset_demo_database() {
  $COMPOSE stop api postgres
  $COMPOSE rm -f api postgres
  docker volume rm bslt-demo_postgres_data
}

# Start postgres and wait until it accepts TCP connections (`-h 127.0.0.1` avoids
# the temporary Unix-socket-only server docker-entrypoint.sh runs during initdb).
start_database() {
  $COMPOSE up -d postgres
  for _ in $(seq 1 30); do
    if $COMPOSE exec -T postgres pg_isready -h 127.0.0.1 -U postgres -d bslt_demo >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "Postgres did not accept TCP connections within 60s" >&2
  return 1
}

# Exit code of the migrate job when the database has to be rebuilt from the
# baselines (RESET_REQUIRED_EXIT_CODE in main/kernel/db/src/migrate/database.ts).
MIGRATE_RESET_REQUIRED=3

# The major of the cluster on the data volume; empty when there is none yet.
DATA_MAJOR="$($COMPOSE run --rm --no-deps --entrypoint cat postgres /var/lib/postgresql/data/PG_VERSION 2>/dev/null | tr -d '[:space:]' || true)"
if [ -n "$DATA_MAJOR" ] && [ "$DATA_MAJOR" != "$POSTGRES_MAJOR" ]; then
  echo "The demo database holds a PostgreSQL $DATA_MAJOR cluster; resetting it for PostgreSQL $POSTGRES_MAJOR"
  reset_demo_database
fi

echo "Starting postgres, bootstrapping database roles, running migrations"
start_database
# Roles first (superuser; idempotent), then migrations as bslt_owner. api and
# web are recreated only after both succeeded.
$COMPOSE run --rm bootstrap-roles
migrate_status=0
$COMPOSE run --rm migrate || migrate_status=$?
if [ "$migrate_status" -eq "$MIGRATE_RESET_REQUIRED" ]; then
  echo "The database was built from other baselines: recreating the demo database"
  reset_demo_database
  start_database
  $COMPOSE run --rm bootstrap-roles
  $COMPOSE run --rm migrate
elif [ "$migrate_status" -ne 0 ]; then
  echo "Database migration failed; api and web were not recreated"
  exit "$migrate_status"
fi

echo "Recreating api and web"
# `--no-deps`: postgres is already up, and caddy is never part of a deploy.
$COMPOSE up -d --no-deps --force-recreate api web

if [ "$IMAGE_SOURCE" = ghcr ]; then
  # Prune old images to keep the 24 GB disk healthy.
  docker image prune -f >/dev/null 2>&1 || true
fi

echo "Deploy complete: $API_IMAGE"
