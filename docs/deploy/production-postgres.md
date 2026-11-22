# Production PostgreSQL Configuration

Settings and recommendations for running PostgreSQL in production with this starter.

Production Postgres runs on its own server, apart from the app server
([two servers](./README.md#two-servers)). `infra/docker/production/docker-compose.db.yml` is the
reference setup for that server; `infra/docker/production/docker-compose.prod.yml`, the app server,
runs no database.

---

## Connection Settings

### Environment Variables

```bash
# One URL per database role (docs/deploy/env.md#database-roles). Each URL's
# password is that role's password; generate each with `openssl rand -hex 32`.
# Runtime, user sessions:
DATABASE_URL=postgresql://bslt_app:<hex>@host:5432/your_app_prod?sslmode=require
# Runtime, sessionless and background work:
WORKER_DATABASE_URL=postgresql://bslt_worker:<hex>@host:5432/your_app_prod?sslmode=require
# The pub/sub LISTEN connection: the worker role, direct to Postgres. Without a
# pooler in between it is the same URL as WORKER_DATABASE_URL:
LISTEN_DATABASE_URL=postgresql://bslt_worker:<hex>@host:5432/your_app_prod?sslmode=require
# Migrations only; never given to the running API:
MIGRATION_DATABASE_URL=postgresql://bslt_owner:<hex>@host:5432/your_app_prod?sslmode=require

# The database server and its superuser: the role bootstrap, and PgBouncer's
# upstream and lookups on the app server. Never the application's login.
POSTGRES_HOST=db.example.com
POSTGRES_PORT=5432
POSTGRES_DB=your_app_prod
POSTGRES_USER=postgres
POSTGRES_PASSWORD=<generated-secret>
# ...or as one URL instead of the five parts:
# DATABASE_ADMIN_URL=postgresql://postgres:<password>@host:5432/your_app_prod?sslmode=require

# Connection pool (applies to each of the two runtime pools)
DB_MAX_CONNECTIONS=20

# SSL for managed or external Postgres
DB_SSL=true
```

The runtime connects only as `bslt_app` and `bslt_worker`. The superuser and
`bslt_owner` credentials are read by the two one-shot jobs, `bootstrap-roles`
and `migrate`, which run in that order before the API starts on every deploy
(see the [migration guide](./migrations.md#production)). In production the server
refuses to start when `DATABASE_URL` is a superuser, has `BYPASSRLS` or owns
tables.

### Connection Pooling

The server uses explicit SQL repositories backed by the `postgres` driver, with connection management handled inside `@bslt/db`.

| Setting              | Dev Default | Production Recommendation | Notes                                                                        |
| -------------------- | ----------- | ------------------------- | ---------------------------------------------------------------------------- |
| `DB_MAX_CONNECTIONS` | 10          | 20–50                     | Match to your Postgres `max_connections` minus headroom for admin/monitoring |
| Idle timeout         | 10s         | 30s                       | Configured in the DB client options                                          |

**Sizing guideline:** `DB_MAX_CONNECTIONS` applies to each of the API's two pools (`bslt_app` and `bslt_worker`), and the worker role holds one more connection for `LISTEN` (`LISTEN_DATABASE_URL`, direct to Postgres, so it counts against `max_connections` and not against a PgBouncer pool). One API instance at `DB_MAX_CONNECTIONS=20` can therefore open 41 connections. If running multiple replicas behind a load balancer, divide the total Postgres `max_connections` across instances with that in mind — e.g., 100 max connections with 2 replicas = `DB_MAX_CONNECTIONS=20` each, with headroom for admin and the one-shot database jobs.

**Pooler (PgBouncer):** the app server's compose file runs PgBouncer in front of the database
server (`POSTGRES_HOST`, `POSTGRES_PORT`), and the two runtime role URLs point at it
(`pgbouncer:5432`). With a pooler of your own, the shape is the same:

```bash
# Point both runtime roles at PgBouncer instead of Postgres directly
DATABASE_URL=postgresql://bslt_app:<hex>@pgbouncer-host:6432/your_app_prod?sslmode=require
WORKER_DATABASE_URL=postgresql://bslt_worker:<hex>@pgbouncer-host:6432/your_app_prod?sslmode=require
# LISTEN_DATABASE_URL (the pub/sub listener, as bslt_worker), MIGRATION_DATABASE_URL
# and the role bootstrap connect to Postgres directly.
LISTEN_DATABASE_URL=postgresql://bslt_worker:<hex>@host:5432/your_app_prod?sslmode=require

# PgBouncer settings (pgbouncer.ini)
# pool_mode = session        (the app compose default; pub/sub no longer depends on it,
#                             because LISTEN_DATABASE_URL bypasses the pooler)
# max_client_conn = 200
# default_pool_size = 25     (per database AND user: at least DB_MAX_CONNECTIONS)
# reserve_pool_size = 5
```

The production Compose file defaults PgBouncer to session pooling for the same reason.
Transaction pooling breaks Postgres `LISTEN` subscriptions unless pubsub is moved to a
separate direct connection.

`default_pool_size` counts per database and user. In session mode a client keeps
its server connection for as long as it is connected, so each of the two runtime
roles needs a pool at least as large as `DB_MAX_CONNECTIONS`; a smaller pool
leaves the remaining application connections waiting. The app compose file sets
`PGBOUNCER_DEFAULT_POOL_SIZE=25` for the default `DB_MAX_CONNECTIONS=20`; raise
both together.

### SSL Configuration

### Statement and transaction timeouts

The API runs every statement and transaction of its two pools under limits that Postgres enforces:

| Setting                               | Env key                             | Default | What happens over the limit                                                            |
| ------------------------------------- | ----------------------------------- | ------- | -------------------------------------------------------------------------------------- |
| `statement_timeout`, app pool         | `DB_STATEMENT_TIMEOUT_MS`           | 30000   | The statement is cancelled (SQLSTATE `57014`)                                          |
| `statement_timeout`, worker pool      | `DB_WORKER_STATEMENT_TIMEOUT_MS`    | 120000  | The same; jobs get longer than requests                                                |
| `lock_timeout`                        | `DB_LOCK_TIMEOUT_MS`                | 10000   | A statement waiting for one lock is cancelled (`55P03`)                                |
| `idle_in_transaction_session_timeout` | `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS` | 60000   | The transaction's session is ended and rolled back (`25P03`); the pool opens a new one |

Values are milliseconds and `0` turns a limit off. The limits are set inside each transaction (`set_config(..., true)`), never on the session and never as a startup parameter, so they work through PgBouncer in session and in transaction mode and need no `ignore_startup_parameters`. The `migrate` job connects as the owner and sets none: a long DDL statement or backfill is not cancelled.

A statement cancelled for one of these reasons leaves its connection usable. Setting the same limits on the server or on the roles (the table under [Connections](#connections)) covers clients other than the API, such as `psql` sessions.

The limits travel in the one `SELECT set_config(...)` statement that also binds the session of a request (the role `authenticated`, `app.user_id`, `app.org_id`, `app.role`, `app.max_audience`). A single statement is sent with it in one batch, so it costs one round trip and no `BEGIN` or `COMMIT`; a transaction sends it once. Nothing is left on the server connection, which is what transaction pooling needs.

### Transaction retry

Postgres rolls a transaction back when it cannot be serialized (`40001`) or when it is the victim of a deadlock (`40P01`). Both go away when the transaction runs again, so the client runs it again: three attempts in all, after a jittered wait of at most 20 ms and then at most 40 ms. After the last attempt the error reaches the caller. Only a whole transaction is retried, never a single statement inside one and never a savepoint. There is no env key; code sets the policy per pool (`transactionRetry`) or per call (`retry`), and `false` turns it off for a transaction that does something outside the database.

A deadlock still shows in the Postgres log (`deadlock detected`). A steady rate of them is a lock-order problem in the code, not something to tune away.

Three kinds of connection leave the app server for the database server:

| Connection                   | From                            | TLS setting                                                             |
| ---------------------------- | ------------------------------- | ----------------------------------------------------------------------- |
| Pooled queries               | PgBouncer                       | `PGBOUNCER_SERVER_TLS_SSLMODE` on the `pgbouncer` service               |
| `bootstrap-roles`, `migrate` | the one-shot jobs               | `?sslmode=require` in `DATABASE_ADMIN_URL` and `MIGRATION_DATABASE_URL` |
| The pub/sub `LISTEN` session | the API (`LISTEN_DATABASE_URL`) | `DB_SSL`, the API's one switch for all of its connections               |

The reference setup configures none of them: `docker-compose.db.yml` runs Postgres without TLS and
the app compose file sets `DB_SSL=false`, because the API's pooled connections go to PgBouncer over
the private Docker network. **Keep the two servers on one private network** (a VPC or a WireGuard
link), bind Postgres to the private address only and admit the app server only; the compose file
for the database server does the last two.

To add TLS between the servers:

1. On the database server, mount a certificate and key into the container and add
   `-c ssl=on -c ssl_cert_file=... -c ssl_key_file=...` to the `command` of
   `docker-compose.db.yml`; change `host` to `hostssl` in its `APP_SERVER_CIDR` rule.
2. On the app server, set `PGBOUNCER_SERVER_TLS_SSLMODE=require` on the `pgbouncer` service and
   add `?sslmode=require` to `MIGRATION_DATABASE_URL` and `DATABASE_ADMIN_URL`.
3. The listener is the limit: it takes `DB_SSL`, and `DB_SSL=true` also makes the API speak TLS
   to PgBouncer, which then needs client TLS certificates (`PGBOUNCER_CLIENT_TLS_*`). Until the
   listener has a TLS setting of its own, either configure PgBouncer client TLS and set
   `DB_SSL=true`, or leave `hostssl` off for the listener's role by keeping a `host` rule for
   `bslt_worker`. This is recorded as open in the restructure status.

An API that connects to a managed or external Postgres directly, with no pooler in between, sets:

```bash
DB_SSL=true
```

For self-signed certificates (e.g., internal infrastructure):

```bash
# Set in DATABASE_URL
DATABASE_URL=postgresql://user:password@host:5432/your_app_prod?sslmode=require&sslrootcert=/path/to/ca.crt
```

For managed databases (RDS, Cloud SQL, Supabase), SSL is typically pre-configured — ensure `DB_SSL=true` or include `sslmode=require` in `DATABASE_URL`.

---

## PostgreSQL Server Tuning

These settings go in `postgresql.conf` or are set via your managed database provider's dashboard.

### Memory

| Setting                | Default | Recommendation (4GB RAM server) | Notes                                                                 |
| ---------------------- | ------- | ------------------------------- | --------------------------------------------------------------------- |
| `shared_buffers`       | 128MB   | 1GB (25% of RAM)                | Main cache for hot data                                               |
| `effective_cache_size` | 4GB     | 3GB (75% of RAM)                | Query planner hint — not an allocation                                |
| `work_mem`             | 4MB     | 16–32MB                         | Per-sort/hash operation. Multiply by `max_connections` for worst case |
| `maintenance_work_mem` | 64MB    | 256MB                           | For VACUUM, CREATE INDEX, etc.                                        |

### Write Performance

| Setting                        | Default | Recommendation | Notes                                         |
| ------------------------------ | ------- | -------------- | --------------------------------------------- |
| `wal_buffers`                  | -1      | 16MB           | Auto-tuned from `shared_buffers` in modern PG |
| `checkpoint_completion_target` | 0.9     | 0.9            | Spread checkpoint writes                      |
| `max_wal_size`                 | 1GB     | 2GB            | Increase if frequent checkpoints in logs      |

### Connections

| Setting                               | Default | Recommendation | Notes                                               |
| ------------------------------------- | ------- | -------------- | --------------------------------------------------- |
| `max_connections`                     | 100     | 100–200        | With PgBouncer, can stay at 100 and pool externally |
| `idle_in_transaction_session_timeout` | 0       | 30s            | Kill idle-in-transaction sessions                   |
| `statement_timeout`                   | 0       | 30s            | Prevent runaway queries                             |

### Logging (for debugging)

```ini
# Log slow queries (enable temporarily for performance investigation)
log_min_duration_statement = 500   # Log queries taking >500ms
log_statement = 'none'              # Don't log all queries in production
log_connections = off
log_disconnections = off
```

---

## Major version upgrades

Every lane runs the Postgres major pinned in `infra/versions.env` (`POSTGRES_MAJOR`, with the exact
image in `POSTGRES_IMAGE`). The images, the migrations and the backups (`pg_dump` from the pinned
image) are built for that major, and a Postgres image cannot open a cluster an older major created.

The deploy therefore asks the database server for its version before it changes anything on the
app server (`SHOW server_version_num`, with `psql` from the pinned image, as the superuser). It
stops with `FATAL: the database server at <host>:<port> runs PostgreSQL <n>` when the major
differs from the pin, and with `FATAL: could not ask the database server ...` when the server does
not answer. In both cases the running stack is left as it was. The database server itself is never
upgraded, restarted or otherwise touched by a deploy.

To move the database server to a new pinned major (on the database server, in the directory that
holds `docker-compose.db.yml` and `.env.database`; `dbc` is
`docker compose --env-file .env.database -f docker-compose.db.yml`). The app is down between
steps 2 and 4, so stop the app server's API first or accept failing requests:

```bash
# 1. While the old server still runs: dump the whole cluster, roles included.
dbc exec -T postgres pg_dumpall -U postgres > cluster-$(date -u +%Y%m%d).sql

# 2. Stop Postgres and keep the old cluster under another volume name.
dbc down
docker volume create abe-postgres-data-old
docker run --rm -v abe-postgres-data:/from -v abe-postgres-data-old:/to alpine cp -a /from/. /to/
docker volume rm abe-postgres-data

# 3. Take the docker-compose.db.yml of the commit that pins the new major (its
#    `image:` line is the pin), start it on the empty volume and restore.
dbc up -d
dbc exec -T postgres psql -U postgres -d postgres < cluster-<date>.sql

# 4. Deploy the app: the version check passes, then bootstrap-roles, migrate
#    and the start run as on every deploy.
```

The volume is named `<RESOURCE_PREFIX>-postgres-data` (`abe-postgres-data` by default).

The binding restructure decision is that no deployed data must survive the baseline reset, so
starting step 3 on an empty volume without the restore is also acceptable. The demo deploy does
exactly that on its own: its database is disposable and lives in the demo compose file, and
`infra/docker/demo/remote-deploy.sh` drops a volume of another major before it starts the database.

**Moving off the bundled database.** A server deployed before Phase 4 ran Postgres inside the app
compose project, on the volume `<project>_postgres_data`. A deploy of the current compose file
leaves that container and volume in place (as an orphan of the project) and uses neither. Move the
data once: `pg_dumpall` from the old container, restore into the database server as in step 3,
then remove the old container and, when you are sure, its volume.

Locally, a development volume created by an older major has to be removed the same way
(`docker compose -f infra/docker/development/docker-compose.dev.yml down -v`), or dumped first if
its data matters.

---

## Managed Database Services

The snippets below show each provider's connection shape (host, port, SSL). The
role split still applies: set `DATABASE_URL`, `WORKER_DATABASE_URL` and
`MIGRATION_DATABASE_URL` to the `bslt_app`, `bslt_worker` and `bslt_owner` roles
on that host, not to the provider's admin user, and `LISTEN_DATABASE_URL` to the
`bslt_worker` role on the provider's direct (non-pooled) endpoint.

> **Not automated for managed Postgres.** `bootstrap-roles` needs a real
> superuser: it sets role attributes such as `NOBYPASSRLS` and reassigns object
> ownership. Managed services usually hand out an admin user that is not one;
> with such a user (`CREATEROLE`, `CREATEDB`) the bootstrap stops with
> `permission denied to alter role`. The roles then have to be created with the
> provider's own tooling, with the attributes and memberships listed under
> [Database roles](./env.md#database-roles). The starter does not do this for you
> and has only been exercised against self-hosted Postgres 16 and 17.

### AWS RDS

```bash
DATABASE_URL=postgresql://user:password@your-instance.region.rds.amazonaws.com:5432/your_app_prod?sslmode=require
DB_SSL=true
DB_MAX_CONNECTIONS=20   # RDS micro: max 66 connections, small: 171
```

RDS handles backups, patching, and failover. Use Multi-AZ for production availability.

### Google Cloud SQL

```bash
DATABASE_URL=postgresql://user:password@/your_app_prod?host=/cloudsql/project:region:instance
DB_SSL=true
DB_MAX_CONNECTIONS=20
```

For non-Cloud Run deployments, use the Cloud SQL Auth Proxy:

```bash
cloud-sql-proxy project:region:instance --port=5432 &
DATABASE_URL=postgresql://user:password@localhost:5432/your_app_prod?sslmode=disable
```

### Supabase / Neon

These services have lower connection limits. Use their built-in pooler:

```bash
# Supabase session pooler, or direct connection if session pooling is unavailable.
# Avoid transaction pooling while Postgres LISTEN/NOTIFY pubsub is enabled.
DATABASE_URL=postgresql://user:password@db.project.supabase.co:6543/postgres?sslmode=require
DB_MAX_CONNECTIONS=10   # Supabase free: 60 direct connections
```

### DigitalOcean Managed Database

```bash
DATABASE_URL=postgresql://user:password@db-host:25060/your_app_prod?sslmode=require
DB_SSL=true
DB_MAX_CONNECTIONS=20
```

---

## Backup Strategy

Full backup procedures are in the [backup and restore guide](./backup-restore.md). Key points:

- **Automated daily backups** via `pg_dump` + cron (3 AM server time)
- **7-day retention** locally, offsite sync to S3 or second server
- **Quarterly restore drills** to verify backup integrity
- **Pre-migration backups** before any schema change

For managed databases, enable the provider's automated backup feature in addition to application-level `pg_dump` backups.

---

## Health Monitoring

The app checks database connectivity at multiple levels:

| Endpoint             | What It Checks                         |
| -------------------- | -------------------------------------- |
| `/health`            | Basic `SELECT 1` — DB reachable        |
| `/health/ready`      | DB connected and schema version valid  |
| `/api/system/status` | Detailed latency and connection status |

Configure your monitoring to poll `/health/ready` every 30 seconds. Alert on consecutive failures.

### Query Performance

Monitor slow queries via PostgreSQL's `pg_stat_statements` extension:

```sql
-- Enable (run once)
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Top 10 slowest queries by total time
SELECT
  calls,
  round(total_exec_time::numeric, 2) AS total_ms,
  round(mean_exec_time::numeric, 2) AS mean_ms,
  substring(query, 1, 80) AS query_preview
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;
```

---

## Security Checklist

- [ ] Runtime connects as `bslt_app` / `bslt_worker`; the superuser and `bslt_owner` are used only by the `bootstrap-roles` and `migrate` jobs
- [ ] Strong, randomly generated password per role (`openssl rand -hex 32`; hex needs no URL-encoding), none derived from another
- [ ] The app server and the database server share a private network, or TLS is configured between them
- [ ] Postgres listens on the private address only (`DB_LISTEN_ADDRESS`) and `pg_hba` admits the app server only (`APP_SERVER_CIDR`)
- [ ] SSL enabled for managed/external Postgres
- [ ] `statement_timeout` set to prevent runaway queries
- [ ] `idle_in_transaction_session_timeout` set to reclaim connections
- [ ] Network access restricted to application servers only (firewall/security group)
- [ ] Automated backups enabled and tested
- [ ] `pg_stat_statements` enabled for query monitoring

---

## Related Documentation

- [Backup and Restore](./backup-restore.md) — Backups, restore drills, incident response
- [Secrets Checklist](./secrets-checklist.md) — Required secrets for deployment
- [DigitalOcean Guide](./providers/digitalocean.md) — Server provisioning
- [GCP Guide](./providers/gcp.md) — Compute Engine deployment
