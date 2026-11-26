#!/usr/bin/env bash
# infra/docker/demo/local-deploy.sh
#
# Deploy the demo stack from a workstation, with no GitHub Actions and no ghcr.
#
# This exists because the Actions budget is unavailable, which makes the `demo` job
# of `deploy.yml` unrunnable, and its `web` job additionally lacks its Cloudflare
# secrets. The workstation deploy runner now delivers accepted `main` commits through
# remote-deploy.sh (docs/deploy/demo-manual-deploy.md); this is the manual path,
# and it should not be a sequence of commands someone retypes from memory — the first
# manual deploy (2026-08-06) took the site down for ~3 minutes for a reason this
# script now handles automatically (see the nginx.conf step).
#
# Images are built here rather than on the shared 2 GB droplet.
# They travel as a `docker save | docker load` stream, so no registry and
# no `write:packages` token is involved.
#
# Usage:
#   DROPLET_HOST=143.198.174.88 SSH_KEY=~/.ssh/digital_ocean \
#     bash infra/docker/demo/local-deploy.sh [--web] [--api] [--migrate] [--prune] [--dry-run]
#
#   --web / --api   Which images to deploy. Default: both.
#   --migrate       Bootstrap the database roles and run migrations after loading
#                   the api image and BEFORE restarting it. Off by default because
#                   migrations are not reversible, so running them is a decision,
#                   not a step. Pass it whenever the new api image needs a
#                   migration the database does not have. When the image ships
#                   other baselines than the database was built from, the migrate
#                   job stops with exit code 3 and this script with it: the
#                   automatic deploy (remote-deploy.sh) recreates the demo
#                   database in that case, this script never drops it.
#   --prune         Prune dangling images on the droplet afterwards. Off by default:
#                   the box also runs ganbate and kanustudio, and their images are
#                   not this script's business.
#   --dry-run       Print what would happen and exit before mutating anything.
#
# Requires: docker and ssh locally, and SSH access on SSH_PORT (default 2222). The
# droplet's firewall allows only specific source IPs, so this fails fast with a clear
# message when the current address is not allowlisted.
set -euo pipefail

DROPLET_HOST="${DROPLET_HOST:-}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/digital_ocean}"
SSH_PORT="${SSH_PORT:-2222}"
PUBLIC_HOST="${PUBLIC_HOST:-app.bslt.dev}"
REMOTE_DIR="${REMOTE_DIR:-/opt/bslt/demo}"
COMPOSE_FILE="docker-compose.demo.yml"

# The SPA and API share an origin behind Caddy. The client appends /api itself,
# so its same-origin base must be empty, including when explicitly configured.
VITE_API_URL="${VITE_API_URL:-}"

DEPLOY_WEB=0
DEPLOY_API=0
RUN_MIGRATIONS=0
PRUNE=0
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --web) DEPLOY_WEB=1 ;;
    --api) DEPLOY_API=1 ;;
    --migrate) RUN_MIGRATIONS=1 ;;
    --prune) PRUNE=1 ;;
    --dry-run) DRY_RUN=1 ;;
    -h | --help)
      sed -n '3,35p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg (try --help)" >&2
      exit 2
      ;;
  esac
done

# Neither selected means both, so the common case needs no flags.
if [ "$DEPLOY_WEB" -eq 0 ] && [ "$DEPLOY_API" -eq 0 ]; then
  DEPLOY_WEB=1
  DEPLOY_API=1
fi

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$REPO_ROOT"

say() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
die() {
  printf '\n\033[31m✖ %s\033[0m\n' "$1" >&2
  exit 1
}

remote() {
  ssh -p "$SSH_PORT" -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=20 \
    "root@${DROPLET_HOST}" "$@"
}

# ---------------------------------------------------------------------------
# Preflight — fail before building, not after
# ---------------------------------------------------------------------------
say "Preflight"
[ -n "$DROPLET_HOST" ] || die "DROPLET_HOST is not set."
[ -f "$SSH_KEY" ] || die "SSH key not found at $SSH_KEY (override with SSH_KEY=…)."
command -v docker >/dev/null || die "docker is required to build the images."
if [ "$DEPLOY_WEB" -eq 1 ]; then
  case "$VITE_API_URL" in
    '' | http://* | https://*) ;;
    *) die "VITE_API_URL must be empty for same-origin hosting or an absolute HTTP(S) API base. The client appends /api itself." ;;
  esac
fi

echo "  host      root@${DROPLET_HOST}:${REMOTE_DIR}"
echo "  ssh port  ${SSH_PORT}"
echo "  public    https://${PUBLIC_HOST}"
echo "  images    web=$DEPLOY_WEB api=$DEPLOY_API  migrate=$RUN_MIGRATIONS  prune=$PRUNE"
echo "  commit    $(git rev-parse --short HEAD)$(git diff --quiet || echo ' (dirty)')"
if [ "$DEPLOY_API" -eq 1 ] && [ "$RUN_MIGRATIONS" -eq 0 ]; then
  # Not an error: most API deploys need no migration. But the script cannot see
  # which do, and the failure is not obvious from a health check.
  echo "  note      --migrate not given: the database is left as it is. If this api"
  echo "            image needs a migration the database does not have, signed-in"
  echo "            requests fail until you re-run with --migrate."
fi

if [ "$DRY_RUN" -eq 1 ]; then
  say "Dry run — stopping before any build or remote change."
  exit 0
fi

if ! remote 'echo ok' >/dev/null 2>&1; then
  die "Cannot SSH to ${DROPLET_HOST}. The droplet firewall allows only specific
  source IPs — add $(curl -sS -m 10 https://api.ipify.org 2>/dev/null || echo 'your IP') to the
  SSH rule (DigitalOcean → Networking → Firewalls), or use the DO web console."
fi
echo "  ssh       ok"

# ---------------------------------------------------------------------------
# Build locally — the droplet cannot
# ---------------------------------------------------------------------------
if [ "$DEPLOY_WEB" -eq 1 ]; then
  say "Building bslt-web:local"
  # Feature and capability flags resolve at runtime via /api/platform/context.
  docker build -f infra/docker/Dockerfile.web -t bslt-web:local \
    --build-arg "VITE_API_URL=${VITE_API_URL}" \
    --build-arg "SITE_URL=https://${PUBLIC_HOST}" \
    .
fi

if [ "$DEPLOY_API" -eq 1 ]; then
  say "Building bslt-api:local"
  docker build -f infra/docker/Dockerfile -t bslt-api:local .
fi

# ---------------------------------------------------------------------------
# Ship the images over SSH
# ---------------------------------------------------------------------------
ship() {
  local image="$1"
  say "Shipping $image"
  # gzip -1: the layers are already compressed, so heavier settings only cost CPU.
  docker save "$image" | gzip -1 | remote 'gunzip | docker load'
}

[ "$DEPLOY_WEB" -eq 1 ] && ship bslt-web:local
[ "$DEPLOY_API" -eq 1 ] && ship bslt-api:local

# remote-deploy.sh pins the images it deployed in the droplet's .env, and compose
# resolves API_IMAGE / WEB_IMAGE from that file. Point it at the images just
# loaded, before any database job or restart, or those would run the old ones.
pin_image() {
  remote "cd ${REMOTE_DIR} && sed -i '/^$1=/d' .env && echo '$1=$2' >> .env"
}
[ "$DEPLOY_WEB" -eq 1 ] && pin_image WEB_IMAGE bslt-web:local
[ "$DEPLOY_API" -eq 1 ] && pin_image API_IMAGE bslt-api:local

# ---------------------------------------------------------------------------
# Host-mounted config that pairs with the image
# ---------------------------------------------------------------------------
if [ "$DEPLOY_WEB" -eq 1 ]; then
  say "Syncing nginx.conf"
  # This is the step the first manual deploy missed, and it 404'd the whole site.
  # nginx.conf is a host mount, and commit 80a4a492 changed the image layout *and*
  # this file together (the document root moved from …/html/client to …/html). The
  # workflow re-syncs it on every deploy; a manual deploy that only swaps the image
  # leaves a new image behind an old config.
  #
  # Deliberately NOT synced: Caddyfile. The droplet's copy also fronts ganbate.io
  # and kanustudio.com, so overwriting it from this repo would take down two
  # unrelated production sites. Same for docker-compose.demo.yml, which the deploy
  # runner and the workflow sync; both are reported below rather than changed.
  remote "cp ${REMOTE_DIR}/nginx.conf ${REMOTE_DIR}/nginx.conf.bak.\$(date +%Y%m%dT%H%M%SZ)"
  scp -q -P "$SSH_PORT" -i "$SSH_KEY" -o BatchMode=yes \
    infra/docker/demo/nginx.conf "root@${DROPLET_HOST}:${REMOTE_DIR}/nginx.conf"
  echo "  synced (previous copy kept as nginx.conf.bak.*)"

  for f in "$COMPOSE_FILE" Caddyfile; do
    local_sum="$(md5sum "infra/docker/demo/$f" | cut -d' ' -f1)"
    remote_sum="$(remote "md5sum ${REMOTE_DIR}/$f 2>/dev/null | cut -d' ' -f1" || true)"
    if [ "$local_sum" != "$remote_sum" ]; then
      echo "  note: $f differs from the repo and was left alone (intentional)"
    fi
  done
fi

# ---------------------------------------------------------------------------
# Database jobs — before the restart, never after
# ---------------------------------------------------------------------------
# The api image runs `SET LOCAL ROLE authenticated` in every user session, and
# that role and its grants come from the role bootstrap and the baselines. So
# the database is brought up to date BEFORE the new image starts, and a failure
# here stops the deploy (`set -e`) with the previous api container still serving.
# This used to run after the restart, which served permission errors in between.
#
# `--no-deps` on every `run`: compose would otherwise start, or recreate, postgres.
if [ "$RUN_MIGRATIONS" -eq 1 ]; then
  say "Running database jobs"
  if remote "cd ${REMOTE_DIR} && docker compose -f ${COMPOSE_FILE} --profile ops config --services | grep -qx bootstrap-roles"; then
    # Roles first (superuser, idempotent), then migrations as bslt_owner.
    remote "cd ${REMOTE_DIR} && docker compose -f ${COMPOSE_FILE} run --rm --no-deps bootstrap-roles"
    remote "cd ${REMOTE_DIR} && docker compose -f ${COMPOSE_FILE} run --rm --no-deps migrate"
  else
    # This script never syncs the compose file, so the droplet's copy can lack
    # the one-shot services. Migrate the way that copy supports; the stack stays
    # on whatever database login its .env names until it is brought up to date
    # (docs/deploy/demo-manual-deploy.md#database-role-split).
    echo "  note: ${COMPOSE_FILE} on the droplet predates the database role split;"
    echo "        skipping the role bootstrap and migrating through the api service."
    remote "cd ${REMOTE_DIR} && docker compose -f ${COMPOSE_FILE} run --rm --no-deps api node node_modules/@bslt/db/dist/migrate/entry.js"
  fi
fi

# ---------------------------------------------------------------------------
# Restart only what changed
# ---------------------------------------------------------------------------
say "Restarting services"
# `--no-deps` so postgres and caddy keep running: caddy also serves the other two
# sites on this box, and restarting it is never part of shipping a new image.
services=""
[ "$DEPLOY_API" -eq 1 ] && services="$services api"
[ "$DEPLOY_WEB" -eq 1 ] && services="$services web"
# shellcheck disable=SC2086 # word splitting is the intent: one arg per service
remote "cd ${REMOTE_DIR} && docker compose -f ${COMPOSE_FILE} up -d --no-deps --force-recreate${services:+ }${services}"

if [ "$PRUNE" -eq 1 ]; then
  say "Pruning dangling images"
  remote 'docker image prune -f' >/dev/null || true
fi

# ---------------------------------------------------------------------------
# Verify — a deploy that is not checked is a deploy that is not done
# ---------------------------------------------------------------------------
say "Verifying"
sleep 12
remote "cd ${REMOTE_DIR} && docker compose -f ${COMPOSE_FILE} ps --format '  {{.Service}}\t{{.Image}}\t{{.Status}}'"

status="$(curl -sS -o /dev/null -m 25 -w '%{http_code}' "https://${PUBLIC_HOST}/" || echo 000)"
echo "  https://${PUBLIC_HOST}/ → ${status}"
if [ "$status" != "200" ]; then
  die "Public URL returned ${status}. Roll back with:
  ssh -p ${SSH_PORT} -i ${SSH_KEY} root@${DROPLET_HOST} \\
    'cd ${REMOTE_DIR} && WEB_IMAGE=<previous-ghcr-tag> docker compose -f ${COMPOSE_FILE} up -d --no-deps web'
  and restore the previous nginx.conf from ${REMOTE_DIR}/nginx.conf.bak.*"
fi

# The public pages are prerendered, so a bare SPA shell means the build regressed
# even though the status code is fine.
bytes="$(curl -sS -m 25 -o /dev/null -w '%{size_download}' "https://${PUBLIC_HOST}/" || echo 0)"
if [ "$bytes" -lt 2000 ]; then
  echo "  warning: / returned only ${bytes} bytes — expected a prerendered page, not a shell"
fi

printf '\n\033[32m✔ Deployed to https://%s\033[0m\n' "$PUBLIC_HOST"
