#!/usr/bin/env bash
# infra/docker/demo/generate-env.sh
#
# Generate a complete .env for the demo stack from the committed
# .env.production.example, so every key the server's Zod env schema expects is
# present. Inline `# comments` are stripped (docker compose env_file treats them
# as part of the value). Demo-specific values are overridden and strong secrets
# are generated once and REUSED on redeploys (so sessions survive a redeploy).
# The app, the worker and the migrator each get their own database role and
# password; nothing connects the application as the postgres superuser.
#
# Usage: generate-env.sh <example-path> <out-env-path> <public-base-url>
set -euo pipefail

EXAMPLE="${1:?example path required}"
OUT="${2:?output .env path required}"
BASE_URL="${3:?public base url required}"

gen_secret() { openssl rand -hex 32; }

# Preserve existing secrets across redeploys when an .env is already present.
prev() { [ -f "$OUT" ] && grep -E "^$1=" "$OUT" | head -1 | cut -d= -f2- || true; }
JWT_SECRET="$(prev JWT_SECRET)"; JWT_SECRET="${JWT_SECRET:-$(gen_secret)}"
COOKIE_SECRET="$(prev COOKIE_SECRET)"; COOKIE_SECRET="${COOKIE_SECRET:-$(gen_secret)}"
OAUTH_KEY="$(prev OAUTH_TOKEN_ENCRYPTION_KEY)"; OAUTH_KEY="${OAUTH_KEY:-$(gen_secret)}"
PG_PASS="$(prev POSTGRES_PASSWORD)"; PG_PASS="${PG_PASS:-$(gen_secret)}"
# Preserve operator-configured Auth / OAuth / SMTP settings across redeploys.
PREV_AUTH_STRATEGIES="$(prev AUTH_STRATEGIES)"
PREV_AUTH_AUTO_VERIFY="$(prev AUTH_AUTO_VERIFY_EMAIL)"
PREV_EMAIL_PROVIDER="$(prev EMAIL_PROVIDER)"
PREV_EMAIL_FROM_ADDRESS="$(prev EMAIL_FROM_ADDRESS)"
PREV_EMAIL_FROM_NAME="$(prev EMAIL_FROM_NAME)"
PREV_EMAIL_REPLY_TO="$(prev EMAIL_REPLY_TO)"
PREV_SMTP_HOST="$(prev SMTP_HOST)"
PREV_SMTP_PORT="$(prev SMTP_PORT)"
PREV_SMTP_SECURE="$(prev SMTP_SECURE)"
PREV_SMTP_USER="$(prev SMTP_USER)"
PREV_SMTP_PASS="$(prev SMTP_PASS)"
PREV_GOOGLE_CLIENT_ID="$(prev GOOGLE_CLIENT_ID)"
PREV_GOOGLE_CLIENT_SECRET="$(prev GOOGLE_CLIENT_SECRET)"
PREV_GITHUB_CLIENT_ID="$(prev GITHUB_CLIENT_ID)"
PREV_GITHUB_CLIENT_SECRET="$(prev GITHUB_CLIENT_SECRET)"
# Database role split: one independent random password per role, read back out
# of that role's own URL on redeploys. A URL that names any other user (the old
# single-superuser DATABASE_URL) is never reused. Hex needs no URL-encoding.
role_pass() { prev "$1" | sed -nE "s#^postgres(ql)?://$2:([^@/]+)@.*\$#\\2#p"; }
OWNER_PASS="$(role_pass MIGRATION_DATABASE_URL bslt_owner)"; OWNER_PASS="${OWNER_PASS:-$(gen_secret)}"
APP_PASS="$(role_pass DATABASE_URL bslt_app)"; APP_PASS="${APP_PASS:-$(gen_secret)}"
WORKER_PASS="$(role_pass WORKER_DATABASE_URL bslt_worker)"; WORKER_PASS="${WORKER_PASS:-$(gen_secret)}"

# 1) Base: strip comment-only lines and inline ` # ...` trailers, keep KEY=VALUE.
tmp="$(mktemp)"
sed -E 's/[[:space:]]+#.*$//; s/[[:space:]]+$//' "$EXAMPLE" | grep -E '^[A-Z0-9_]+=' > "$tmp"

# 2) Override helper: replace KEY=... in place, or append if absent.
set_var() {
  local key="$1" val="$2"
  if grep -qE "^${key}=" "$tmp"; then
    # Use a non-/ delimiter; values may contain / and : (URLs, DSNs).
    awk -v k="$key" -v v="$val" 'BEGIN{FS=OFS="="} $1==k{print k"="v; next} {print}' "$tmp" > "$tmp.n" && mv "$tmp.n" "$tmp"
  else
    printf '%s=%s\n' "$key" "$val" >> "$tmp"
  fi
}

# 3) Demo overrides.
# The demo is served over plain HTTP on a bare IP with no SMTP. Production mode
# rejects all three (HTTPS-only URLs, non-console email) AND sets Secure cookies
# that break over HTTP — so the demo runs in development mode, which is the
# correct fit for these constraints. A real production deploy needs a domain
# (HTTPS) + SMTP credentials, then flip this back to production.
set_var NODE_ENV development
set_var API_BASE_URL "$BASE_URL"
set_var APP_URL "$BASE_URL"
set_var CORS_ORIGIN "$BASE_URL"
set_var HOST 0.0.0.0
set_var PORT 8080
set_var API_PORT 8080
# Database (in-network postgres, no SSL).
set_var DATABASE_PROVIDER postgresql
set_var POSTGRES_HOST postgres
set_var POSTGRES_PORT 5432
set_var POSTGRES_DB bslt_demo
set_var POSTGRES_USER postgres
set_var POSTGRES_PASSWORD "$PG_PASS"
# The app never connects as the POSTGRES_USER superuser above: that login is for
# the postgres container and the role bootstrap only (docs/deploy/env.md#database-roles).
set_var DATABASE_URL "postgresql://bslt_app:${APP_PASS}@postgres:5432/bslt_demo"
set_var WORKER_DATABASE_URL "postgresql://bslt_worker:${WORKER_PASS}@postgres:5432/bslt_demo"
# The pub/sub LISTEN connection: the worker role, straight at postgres (the
# demo has no PgBouncer, so it equals the worker URL).
set_var LISTEN_DATABASE_URL "postgresql://bslt_worker:${WORKER_PASS}@postgres:5432/bslt_demo"
set_var MIGRATION_DATABASE_URL "postgresql://bslt_owner:${OWNER_PASS}@postgres:5432/bslt_demo"
set_var DB_SSL false
set_var DB_MAX_CONNECTIONS 10
# No redis/pgbouncer in the demo stack.
set_var QUEUE_PROVIDER local
set_var CACHE_PROVIDER local
set_var CACHE_USE_REDIS false
# Email: default to console when unconfigured, or preserve operator SMTP config across redeploys.
set_var EMAIL_PROVIDER "${PREV_EMAIL_PROVIDER:-console}"
set_var EMAIL_FROM_NAME "${PREV_EMAIL_FROM_NAME:-BSLT}"
set_var EMAIL_FROM_ADDRESS "${PREV_EMAIL_FROM_ADDRESS:-no-reply@bslt.demo}"
if [ -n "$PREV_EMAIL_REPLY_TO" ]; then set_var EMAIL_REPLY_TO "$PREV_EMAIL_REPLY_TO"; fi
if [ -n "$PREV_SMTP_HOST" ]; then set_var SMTP_HOST "$PREV_SMTP_HOST"; fi
if [ -n "$PREV_SMTP_PORT" ]; then set_var SMTP_PORT "$PREV_SMTP_PORT"; fi
if [ -n "$PREV_SMTP_SECURE" ]; then set_var SMTP_SECURE "$PREV_SMTP_SECURE"; fi
if [ -n "$PREV_SMTP_USER" ]; then set_var SMTP_USER "$PREV_SMTP_USER"; fi
if [ -n "$PREV_SMTP_PASS" ]; then set_var SMTP_PASS "$PREV_SMTP_PASS"; fi
# Auth, OAuth & secrets: preserve configured strategies and OAuth client credentials across redeploys.
set_var AUTH_STRATEGIES "${PREV_AUTH_STRATEGIES:-local,magic}"
set_var GOOGLE_CALLBACK_URL "${BASE_URL%/}/api/auth/oauth/google/callback"
set_var GITHUB_CALLBACK_URL "${BASE_URL%/}/api/auth/oauth/github/callback"
if [ -n "$PREV_GOOGLE_CLIENT_ID" ]; then set_var GOOGLE_CLIENT_ID "$PREV_GOOGLE_CLIENT_ID"; fi
if [ -n "$PREV_GOOGLE_CLIENT_SECRET" ]; then set_var GOOGLE_CLIENT_SECRET "$PREV_GOOGLE_CLIENT_SECRET"; fi
if [ -n "$PREV_GITHUB_CLIENT_ID" ]; then set_var GITHUB_CLIENT_ID "$PREV_GITHUB_CLIENT_ID"; fi
if [ -n "$PREV_GITHUB_CLIENT_SECRET" ]; then set_var GITHUB_CLIENT_SECRET "$PREV_GITHUB_CLIENT_SECRET"; fi
set_var CAPTCHA_ENABLED false
# Demo-only default when EMAIL_PROVIDER=console: register users as already email-verified.
# Preserves explicit operator setting (e.g. false once SMTP is active).
set_var AUTH_AUTO_VERIFY_EMAIL "${PREV_AUTH_AUTO_VERIFY:-true}"
set_var JWT_SECRET "$JWT_SECRET"
set_var COOKIE_SECRET "$COOKIE_SECRET"
set_var OAUTH_TOKEN_ENCRYPTION_KEY "$OAUTH_KEY"
set_var TRUST_PROXY true
set_var MAINTENANCE_MODE false

mv "$tmp" "$OUT"
chmod 600 "$OUT"
echo "Wrote $OUT ($(grep -cE '^[A-Z0-9_]+=' "$OUT") vars)"
