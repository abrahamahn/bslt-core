# Starter Deployment Guide

Docker-based deployment for the starter monorepo.

---

## Quick Start

### Development (Local)

Start the database and run the dev servers:

```bash
# Start PostgreSQL
docker compose -f infra/docker/development/docker-compose.dev.yml up -d

# Run migrations
pnpm db:migrate

# Start all dev servers (web + server)
pnpm dev
```

Access:

- Web: http://localhost:5173
- API: http://localhost:8080
- API Health: http://localhost:8080/health

### Production (Docker)

Production runs on [two servers](#two-servers): a database server first, then the app server.

**1. The database server** (once; a deploy never touches it again):

```bash
# On the database server. Copy infra/docker/production/docker-compose.db.yml there, or clone.
( umask 077 && cat > .env.database << EOF
POSTGRES_PASSWORD=$(openssl rand -hex 32)
POSTGRES_DB=your_app_prod
# This server's private address, and the only client it admits: the app server.
DB_LISTEN_ADDRESS=10.0.0.5
APP_SERVER_CIDR=10.0.0.4/32
EOF
)
docker compose --env-file .env.database -f docker-compose.db.yml up -d
```

**2. The app server:**

```bash
# 1. Create the production environment file. Every later command reads it, so
#    the generated values below are written into it, not just exported.
ENV_FILE=config/env/.env.production
cp config/env/.env.production.example "$ENV_FILE"
chmod 600 "$ENV_FILE"

# 2. The database server: its private address, its database, and the superuser
#    password from its .env.database (a line appended here wins over the
#    blank template line).
DB_HOST=10.0.0.5
DB_NAME=your_app_prod
cat >> "$ENV_FILE" << EOF
POSTGRES_HOST=${DB_HOST}
POSTGRES_DB=${DB_NAME}
POSTGRES_PASSWORD=<POSTGRES_PASSWORD from the database server>
EOF

# 3. Generate secrets
echo "JWT_SECRET=$(openssl rand -base64 32)" >> "$ENV_FILE"
echo "COOKIE_SECRET=$(openssl rand -base64 32)" >> "$ENV_FILE"
echo "OAUTH_TOKEN_ENCRYPTION_KEY=$(openssl rand -base64 32)" >> "$ENV_FILE"

# 4. One password per database role, kept only in that role's URL. Hex, because
#    the URLs carry them unencoded (base64 has `/`, `+` and `=`).
echo "DATABASE_URL=postgresql://bslt_app:$(openssl rand -hex 32)@pgbouncer:5432/${DB_NAME}" >> "$ENV_FILE"
WORKER_PASSWORD=$(openssl rand -hex 32)
echo "WORKER_DATABASE_URL=postgresql://bslt_worker:${WORKER_PASSWORD}@pgbouncer:5432/${DB_NAME}" >> "$ENV_FILE"
# The worker role again, straight at the database server: the pub/sub LISTEN connection.
echo "LISTEN_DATABASE_URL=postgresql://bslt_worker:${WORKER_PASSWORD}@${DB_HOST}:5432/${DB_NAME}" >> "$ENV_FILE"
echo "MIGRATION_DATABASE_URL=postgresql://bslt_owner:$(openssl rand -hex 32)@${DB_HOST}:5432/${DB_NAME}" >> "$ENV_FILE"

# 5. Set your domain and mail values in the same file
DOMAIN=yourdomain.com
cat >> "$ENV_FILE" << EOF
DOMAIN=${DOMAIN}
ACME_EMAIL=admin@${DOMAIN}
API_BASE_URL=https://${DOMAIN}
APP_URL=https://${DOMAIN}
EMAIL_FROM_ADDRESS=no-reply@${DOMAIN}
SMTP_HOST=smtp.mail.${DOMAIN}
EOF

# 6. Deploy (includes Caddy reverse proxy with auto TLS)
compose() {
  docker compose -f infra/docker/production/docker-compose.prod.yml \
    --env-file config/env/.env.production "$@"
}

# The same steps, in this order, on every deploy. `&&` is the point: the API
# must not start if a database step failed.
compose --profile ops build &&        # api, web and the two one-shot database jobs
  compose run --rm bootstrap-roles && # superuser: create or repair bslt_owner, bslt_app, bslt_worker
  compose run --rm migrate &&         # bslt_owner: apply pending migrations
  compose up -d                       # the API starts only after both succeeded
```

The API connects as `bslt_app` and `bslt_worker` and refuses to start as the
`postgres` superuser, so the two database jobs are not optional and not
"first deploy only": the role bootstrap is idempotent, and `migrate` applies
whatever is pending. See [Database roles](./env.md#database-roles).

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                       Internet                          │
└───────────────────────────┬─────────────────────────────┘
                            │
┌ app server ───────────────▼─────────────────────────────┐
│               Caddy (Reverse Proxy)                     │
│              Port 80 / 443 (TLS)                        │
│         Automatic Let's Encrypt certificates            │
│                           │                             │
│         ┌─────────────────┼─────────────────┐           │
│         ▼                 ▼                 ▼           │
│   ┌──────────┐    ┌──────────────┐    ┌──────────┐      │
│   │/health*  │    │/ws /api/*    │    │    /*    │      │
│   │  api     │    │    api       │    │   web    │      │
│   │ :8080    │    │   :8080      │    │   :80    │      │
│   └──────────┘    └───┬──────┬───┘    └──────────┘      │
│                       │      │                          │
│               ┌───────▼───┐  │ one LISTEN connection    │
│               │ pgbouncer │  │ (LISTEN_DATABASE_URL)    │
│               │   :5432   │  │                          │
│               └───────┬───┘  │   redis :6379            │
└───────────────────────┼──────┼──────────────────────────┘
                        │      │   private network
┌ database server ──────▼──────▼──────────────────────────┐
│                    postgres :5432                       │
│      listens on its private address only; pg_hba        │
│      admits the app server's address and nothing else   │
└─────────────────────────────────────────────────────────┘
```

### Two servers

The database does not run on the app server. That is what lets a deploy replace the API and web
containers without the database ever restarting, and it keeps the data directory away from
anything a deploy does.

| Server          | Compose file                                      | Runs                                                                            |
| --------------- | ------------------------------------------------- | ------------------------------------------------------------------------------- |
| Database server | `infra/docker/production/docker-compose.db.yml`   | Postgres (the image pinned in `infra/versions.env`) on a named volume           |
| App server      | `infra/docker/production/docker-compose.prod.yml` | Caddy, api, web, PgBouncer, Redis, and the one-shot `bootstrap-roles`/`migrate` |

Order of setup:

1. **Database server first.** Start `docker-compose.db.yml` with a superuser password, the
   server's private address (`DB_LISTEN_ADDRESS`) and the app server's address as a CIDR
   (`APP_SERVER_CIDR`). Postgres uses host networking, listens on loopback and that one address,
   and its `pg_hba.conf` admits password (SCRAM) logins to the application database from
   `APP_SERVER_CIDR` only. Repeat the same rule in your firewall or cloud network.
2. **Then the app server.** Its env file names the database server (`POSTGRES_HOST`,
   `POSTGRES_PORT`) and holds the superuser password and the four role URLs.

Where each database step runs:

| Step              | Runs on    | Connects as               | To                                                           |
| ----------------- | ---------- | ------------------------- | ------------------------------------------------------------ |
| `bootstrap-roles` | app server | superuser                 | the database server directly (`POSTGRES_HOST`)               |
| `migrate`         | app server | `bslt_owner`              | the database server directly (`MIGRATION_DATABASE_URL`)      |
| API pools         | app server | `bslt_app`, `bslt_worker` | PgBouncer on the app server, which dials the database server |
| API listener      | app server | `bslt_worker`             | the database server directly (`LISTEN_DATABASE_URL`)         |
| PgBouncer lookups | app server | superuser                 | the database server (`auth_query`)                           |

Both one-shot jobs are services of the app compose file (profile `ops`), built from the API image,
so nothing has to be installed on the database server besides Docker. The role bootstrap needs a
real superuser, which a self-hosted Postgres has; see
[Managed Database Services](./production-postgres.md#managed-database-services) for what a managed
service changes.

The traffic between the two servers is not encrypted by this stack. Keep both on one private
network (a VPC or a WireGuard link); [SSL Configuration](./production-postgres.md#ssl-configuration)
describes adding TLS and its one limit.

Any Postgres of the pinned major with a superuser can stand in for `docker-compose.db.yml`; the app
server only needs its address. The demo deployment is the exception to the two-server rule: it
keeps a disposable database in its own compose file (`infra/docker/demo/docker-compose.demo.yml`).

**Routing:**

- `/health*` → API server (health checks)
- `/ws` → API server (WebSocket)
- `/api/*` → API server (REST API)
- `/uploads/*` → API server (file uploads)
- `/*` → Web server (SPA frontend)

---

## Port Reference

| Service   | Server   | Internal Port | External Port               | Purpose                         |
| --------- | -------- | ------------- | --------------------------- | ------------------------------- |
| caddy     | app      | 80/443        | 80/443                      | Reverse proxy + TLS termination |
| api       | app      | 8080          | (none)                      | Backend API server              |
| web       | app      | 80            | (none)                      | Frontend (nginx)                |
| pgbouncer | app      | 5432          | (none)                      | Connection pooler               |
| redis     | app      | 6379          | (none)                      | Cache and rate limiting         |
| postgres  | database | 5432          | 5432 on the private address | PostgreSQL database             |

Only Caddy's ports (80/443) are exposed to the internet. Postgres listens on the database
server's private address and admits the app server only.

---

## Required Environment Variables

### Secrets (Required)

| Variable                     | Description                                                                                             | Example                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `POSTGRES_PASSWORD`          | The database server's superuser password (role bootstrap and PgBouncer only; never the app's login)     | `openssl rand -hex 32`                               |
| `DATABASE_URL`               | App role URL (`bslt_app`), through PgBouncer                                                            | `postgresql://bslt_app:<hex>@pgbouncer:5432/<db>`    |
| `WORKER_DATABASE_URL`        | Worker role URL (`bslt_worker`), through PgBouncer                                                      | `postgresql://bslt_worker:<hex>@pgbouncer:5432/<db>` |
| `LISTEN_DATABASE_URL`        | Worker role URL again, straight to the database server: the pub/sub `LISTEN` connection                 | `postgresql://bslt_worker:<hex>@<db-host>:5432/<db>` |
| `MIGRATION_DATABASE_URL`     | Owner role URL (`bslt_owner`), straight to the database server; read by `bootstrap-roles` and `migrate` | `postgresql://bslt_owner:<hex>@<db-host>:5432/<db>`  |
| `JWT_SECRET`                 | JWT signing key                                                                                         | `openssl rand -base64 32`                            |
| `COOKIE_SECRET`              | Cookie signing key                                                                                      | `openssl rand -base64 32`                            |
| `OAUTH_TOKEN_ENCRYPTION_KEY` | OAuth token encryption key                                                                              | `openssl rand -base64 32`                            |
| `EMAIL_FROM_ADDRESS`         | Production sender address                                                                               | `no-reply@yourdomain.com`                            |
| `SMTP_HOST`                  | Production SMTP host                                                                                    | `smtp.mail.yourdomain.com`                           |

Each role URL carries that role's password; generate each with
`openssl rand -hex 32` (hex needs no URL-encoding). The role bootstrap sets the
passwords from these URLs, so changing one and redeploying rotates it.

### Domain Configuration

| Variable     | Default             | Description                           |
| ------------ | ------------------- | ------------------------------------- |
| `DOMAIN`     | `localhost`         | Your domain (e.g., `example.com`)     |
| `ACME_EMAIL` | `admin@example.com` | Email for Let's Encrypt notifications |

### Database

| Variable        | Default         | Description                                    |
| --------------- | --------------- | ---------------------------------------------- |
| `POSTGRES_DB`   | `your_app_prod` | Database name                                  |
| `POSTGRES_USER` | `postgres`      | Postgres superuser (never the app's own login) |
| `POSTGRES_HOST` | (required)      | The database server's private address          |
| `POSTGRES_PORT` | `5432`          | The database server's port                     |

On the database server, `docker-compose.db.yml` reads `POSTGRES_PASSWORD`, `POSTGRES_DB`,
`DB_LISTEN_ADDRESS`, `APP_SERVER_CIDR` and, optionally, `POSTGRES_PORT` and `POSTGRES_USER`.

### Application

| Variable       | Default      | Description                             |
| -------------- | ------------ | --------------------------------------- |
| `NODE_ENV`     | `production` | Environment mode                        |
| `TRUST_PROXY`  | `true`       | Trust X-Forwarded-\* headers            |
| `VITE_API_URL` | (empty)      | API URL for frontend (empty = relative) |

### Service Providers

| Variable           | Default | Description                                                       |
| ------------------ | ------- | ----------------------------------------------------------------- |
| `STORAGE_PROVIDER` | `local` | `local` or S3-compatible object storage for deployed uploads      |
| `EMAIL_PROVIDER`   | `smtp`  | Production requires `smtp`; use `console` only outside production |

See `config/env/.env.production.example` for the complete list.

---

## Health Endpoints

| Endpoint        | Service | Description                              |
| --------------- | ------- | ---------------------------------------- |
| `/health`       | api     | Basic health check (always 200 if alive) |
| `/health/ready` | api     | Readiness (DB connected)                 |
| `/health/live`  | api     | Liveness probe                           |
| `/health`       | web     | Nginx health check (200 OK)              |

---

## Caddy Configuration

The production compose includes Caddy as a reverse proxy with:

- **Automatic TLS** via Let's Encrypt (set `DOMAIN` and `ACME_EMAIL`)
- **HTTP/2 and HTTP/3** support
- **WebSocket** proxying with proper upgrade headers
- **Compression** (gzip, zstd) of what the API leaves identity; the API encodes its own text and JSON responses with br or gzip
- **Security headers** (HSTS, X-Frame-Options, X-Content-Type-Options)

### Configuration Files

| File                                | Purpose                  |
| ----------------------------------- | ------------------------ |
| `infra/runtime/caddy/Caddyfile`     | Production configuration |
| `infra/runtime/caddy/Caddyfile.dev` | Development (HTTP only)  |

### Staging Certificates

For testing, uncomment the staging ACME server in Caddyfile to avoid rate limits:

```caddyfile
{
    acme_ca https://acme-staging-v02.api.letsencrypt.org/directory
}
```

---

## Deployment Workflow

Quick links:

- [Provider deployment guides](./providers/README.md)
- [Deploying the demo without GitHub Actions](demo-manual-deploy.md) — the workstation deploy runner and `pnpm deploy:demo`, while the Actions budget is unavailable
- [DigitalOcean Auto-Deploy (push to deploy)](./providers/digitalocean-auto-deploy.md)
- [Secrets Checklist](./secrets-checklist.md)
- [Release Checklist](./release-checklist.md)

### Automated Deployment (Recommended)

One workflow deploys everything: [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml).

| What starts it                                    | Environment | What it does                                                      |
| ------------------------------------------------- | ----------- | ----------------------------------------------------------------- |
| CI passed for a push to `main`                    | production  | app server, the demo host, the Cloudflare web app                 |
| Push to the `staging` branch                      | staging     | merge gate, staging images, app server                            |
| Run workflow, `environment` only                  | as chosen   | that environment's deploy (production: `main`, once CI passed)    |
| Run workflow with `rollback_sha`                  | as chosen   | the images of that commit again, on the current configuration     |
| Run workflow with `terraform` = `plan` or `apply` | as chosen   | Terraform only; `apply` is refused without a remote state backend |

A CI run that was not started by a push (the nightly and manual runs) deploys nothing, and a
target whose host or token is not configured is skipped with a warning on an automatic run.

- **Running an earlier CI run again** ("Re-run jobs") deploys only while its commit is still the tip
  of `main`. To run an older commit's images again, use `rollback_sha`.
- **A manual production deploy** needs a CI run for the commit, started by its push to `main`, that
  passed as a whole. While CI is still running or is red, the deploy refuses.
- **Staging runs queue as whole runs**: a newer push waits for the one in progress and replaces any
  run that is still waiting, so staging ends on the latest push.

What the app deploy does on the app server, in this order, stopping at the first failure:

1. checks that every database secret and the database server address are configured;
2. fetches the compose file, the Caddyfile and `infra/versions.env` at the deployed commit;
3. asks the database server for its version and stops unless it runs the pinned major;
4. pulls the API and web images;
5. writes `.env` (mode 600, every value resolved) and puts the new compose file in place;
6. runs `bootstrap-roles`, then `migrate`, while the previous API keeps serving;
7. runs `docker compose up -d`, which replaces the containers whose image or configuration
   changed, and recreates Caddy alone when the Caddyfile it runs on is not the one just fetched;
8. waits until every service of the compose file reports healthy, and checks that the API and web
   containers run the images of this deploy.

The stack is never taken down first, and the database server is not restarted by any step.

While a deploy runs, the secrets it carries are readable in the process list of the app server (the
SSH action passes them in the text of the remote command). Do not give other users a login there.
Pin the server's host key before the first deploy: see
[SSH host keys](./secrets-checklist.md#ssh-host-keys).

To use it:

1. **Create the GitHub environments** `staging`, `production` and `demo`, with protection rules
   as you need them, and set up the database server (above).
2. **Configure secrets and variables**: follow the [secrets checklist](./secrets-checklist.md).
3. **Run the release checklist**: complete all items in the [release checklist](./release-checklist.md).
4. **Deploy**: merge to `main`, or Actions → "Deploy" → "Run workflow".
5. **Verify**: test your application at `https://yourdomain.com`.

**Rollback:** Actions → "Deploy" → "Run workflow" with `rollback_sha` set to the full SHA of the
last good commit. See [runbook 2](./runbooks.md#2-failed-deployment--bad-release). The database is
not rolled back.

### Manual Deployment (Alternative)

For custom deployment scenarios, use the traditional Docker Compose approach:

```bash
# 1. Set up the database server, then configure the app server's environment:
#    steps 1-5 of "Production (Docker)" above (the database server address,
#    secrets, the four database role URLs, domain and mail values).

# 2. Build and deploy
compose() {
  docker compose -f infra/docker/production/docker-compose.prod.yml \
    --env-file config/env/.env.production "$@"
}

# The same steps, in this order, on every deploy. `&&` is the point: the API
# must not start if a database step failed.
compose --profile ops build &&        # api, web and the two one-shot database jobs
  compose run --rm bootstrap-roles && # superuser: create or repair bslt_owner, bslt_app, bslt_worker
  compose run --rm migrate &&         # bslt_owner: apply pending migrations
  compose up -d                       # the API starts only after both succeeded
```

---

## Common Operations

### View Logs

```bash
# All services
docker compose -f infra/docker/production/docker-compose.prod.yml logs -f

# Specific service
docker compose -f infra/docker/production/docker-compose.prod.yml logs -f api
docker compose -f infra/docker/production/docker-compose.prod.yml logs -f caddy
```

### Restart Services

```bash
# Restart all
docker compose -f infra/docker/production/docker-compose.prod.yml restart

# Restart specific service
docker compose -f infra/docker/production/docker-compose.prod.yml restart api
```

### Update Deployment

```bash
# Pull latest code
git pull

compose() {
  docker compose -f infra/docker/production/docker-compose.prod.yml \
    --env-file config/env/.env.production "$@"
}

# The same steps, in this order, on every deploy. `&&` is the point: the API
# must not start if a database step failed.
compose --profile ops build &&        # api, web and the two one-shot database jobs
  compose run --rm bootstrap-roles && # superuser: create or repair bslt_owner, bslt_app, bslt_worker
  compose run --rm migrate &&         # bslt_owner: apply pending migrations
  compose up -d                       # the API starts only after both succeeded
```

### Shell Access

```bash
# API container
docker compose -f infra/docker/production/docker-compose.prod.yml exec api sh

# Database (on the database server)
docker compose --env-file .env.database -f docker-compose.db.yml exec postgres psql -U postgres -d your_app_prod
```

---

## Troubleshooting

### API Won't Start

1. Check logs: `docker compose logs api`
2. Verify database is healthy: `docker compose ps`
3. Check environment variables are set, including `DATABASE_URL` (`bslt_app`),
   `WORKER_DATABASE_URL` (`bslt_worker`) and `LISTEN_DATABASE_URL` (`bslt_worker`,
   at the database server)
4. Ensure both database jobs have run, in order: `bootstrap-roles`, then `migrate`.
   The API refuses to start as a superuser or table-owning role, and cannot log
   in as `bslt_app` before the role bootstrap has created it

### Database Connection Failed

1. On the database server, verify Postgres is running:
   `docker compose --env-file .env.database -f docker-compose.db.yml ps`
2. Check that `POSTGRES_HOST` on the app server is the database server's private address
   (`DB_LISTEN_ADDRESS` there), and that the app server's address is inside `APP_SERVER_CIDR`
3. Verify the superuser password is the same on both servers, and that each role URL carries the
   password the last `bootstrap-roles` run set

### WebSocket Connection Failed

1. Check Caddy logs: `docker compose logs caddy`
2. Ensure `/ws` route is being proxied
3. Verify WebSocket upgrade headers are forwarded

### TLS Certificate Issues

1. Ensure DNS is pointing to server IP
2. Check ACME email is valid
3. Try staging CA first to avoid rate limits
4. Check Caddy logs for certificate errors

---

## File Reference

```
infra/
├── docker/
│   ├── Dockerfile              # API server (multi-stage build)
│   ├── Dockerfile.web          # Web frontend (nginx serving static)
│   ├── Dockerfile.dockerignore # Build context exclusions
│   ├── Dockerfile.web          # Node.js PROCESS_ROLE=web SSR + static runner
│   ├── development/
│   │   ├── docker-compose.yml      # Development (full local stack)
│   │   └── docker-compose.dev.yml  # Development (database only)
│   └── production/
│       ├── docker-compose.prod.yml # Production app server (Caddy, api, web, PgBouncer, Redis)
│       └── docker-compose.db.yml   # Production database server (Postgres)
└── runtime/
    └── caddy/
        ├── Caddyfile              # Production Caddy config (TLS)
        └── Caddyfile.dev          # Development Caddy config (HTTP)

config/env/
├── .env.production.example    # Production environment template
├── .env.development.example   # Development environment template
├── .env.development           # Development settings
└── .env.production            # Production settings (create from template)
```

---

## Related Documentation

- [Production PostgreSQL](./production-postgres.md) - Connection pooling, SSL, server tuning, managed databases
- [Secrets Checklist](./secrets-checklist.md) - Required secrets and security setup
- [Provider Deployment Guides](./providers/README.md) - DigitalOcean and GCP deployment notes
- [Reverse Proxy & Trusted Proxy](./reverse-proxy.md) - Caddy setup, routing, WebSocket, X-Forwarded-\* configuration
- [Backup and Restore](./backup-restore.md) - Backups, restore drills, incident response
- [Observability](./observability.md) - Logging, metrics, error tracking, alerting, tracing status
- [Incident Runbooks](./runbooks.md) - Step-by-step responses for DB down, bad releases, error/latency spikes
