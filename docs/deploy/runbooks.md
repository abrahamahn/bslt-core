# Incident Runbooks

Step-by-step responses for the most common production incidents. Each runbook
assumes the Docker production stack described in [README.md](./README.md) and the
health/metrics surfaces in [observability.md](./observability.md).

> Convention used below: `dc` is shorthand for
> `docker compose -f infra/docker/production/docker-compose.prod.yml` on the **app server**, and
> `dbc` for `docker compose --env-file .env.database -f docker-compose.db.yml` on the **database
> server** ([two servers](./README.md#two-servers)). The app server runs no Postgres.

## Triage order (any incident)

1. **Confirm scope.** `curl -fsS https://<domain>/health` and `/health/ready`.
   `live` failing = process down; `ready` failing = dependency (DB) down.
2. **Check error rate / latency.** Scrape `GET /metrics/prometheus` or open the
   alert that fired.
3. **Read logs.** `dc logs -f --tail=200 api` (JSON, redacted — safe to share).
4. **Decide:** mitigate (restart / rollback) first, root-cause after.

---

## 1. Database is down / unreachable

**Signals:** `/health/ready` returns 503, logs show `ECONNREFUSED` / pool
timeouts, `DatabaseDown` alert firing (or `DatabaseSlow` when the pool is
saturating but not yet down), plus `TargetDown` if the API itself is unreachable.

1. On the database server: is the container up? `dbc ps`. If exited:
   `dbc logs --tail=100 postgres`, then `dbc up -d`.
2. Confirm Postgres and the pooler accept connections (the API image has no
   Postgres client, and the API container holds only its two role URLs): on the
   database server `dbc exec postgres pg_isready`; on the app server
   `dc exec pgbouncer pg_isready -h 127.0.0.1 -p 5432`.
3. Postgres is up but the app server cannot reach it → the network path. From the
   app server, `nc -vz <POSTGRES_HOST> 5432`. A refusal that is not a timeout and a
   log line `no pg_hba.conf entry for host` on the database server mean the app
   server's address is not the `APP_SERVER_CIDR` the database was started with.
4. Pool exhausted but DB healthy → a slow query or leak is holding connections.
   Identify, on the database server: `dbc exec postgres psql -U postgres -d "$POSTGRES_DB" -c \
"SELECT pid, state, wait_event_type, query_start, left(query,80) FROM pg_stat_activity ORDER BY query_start;"`.
   Cancel a stuck statement with `SELECT pg_cancel_backend(<pid>);`.
5. Disk full on the database server is a frequent root cause — `df -h`. Free space, then
   restart.
6. If data is corrupt or lost, follow [backup-restore.md](./backup-restore.md)
   (restore the latest dump as the superuser, then run `bootstrap-roles` and
   `migrate`, in that order, before starting the API).
7. API logs say it cannot log in as `bslt_app`, or that `DATABASE_URL` is a
   superuser or table owner → the database roles were not bootstrapped, or the
   env points the API at the wrong role. Run `dc run --rm bootstrap-roles`, then
   `dc run --rm migrate`, then `dc up -d`. See
   [Database roles](./env.md#database-roles).

**Exit:** `/health/ready` 200, error rate back to baseline.

---

## 2. Failed deployment / bad release

**Signals:** post-deploy 5xx spike, `HighErrorRate` alert within the first hour,
health checks flapping.

1. **Roll back first, debug later.** Run the
   [Deploy](../../.github/workflows/deploy.yml) workflow by hand (Actions → "Deploy" →
   **Run workflow**) with the `environment` and `rollback_sha` = the full SHA of the last good
   commit on `main`. It pulls that commit's two images, changes only the image references of the
   stack on the server, replaces the containers without taking the stack down, and checks that
   the running containers are those images. The `.env` and the database are left as they are.
   By hand, on the app server, in `~/deployments/<app>/<environment>`: set the four `image:`
   lines (api, bootstrap-roles, migrate, web) of `docker-compose.prod.yml` to the older tags
   (`<registry>/<name>:<sha>-api`, `<sha>-web`), then
   `docker compose --project-name <app>-<environment> -f docker-compose.prod.yml up -d`.
2. A rollback does not touch the schema: migrations only move forward, so the older code runs
   against the current schema. If the failure is a migration, do **not** roll the schema back
   blindly. Assess whether the older code can run against the new schema. If not, restore from
   the pre-deploy backup (see release-checklist "Backup completed before deployment").
3. Confirm recovery via health + metrics, then open an issue with the failing
   commit range and logs.

**Prevention:** the release-checklist requires a backup before deploy and a
staging pass; keep both gates.

---

## 3. High error rate

**Signals:** `HighErrorRate` alert (5xx ratio over threshold), a spike of
`Captured server error` log events, or of `Client error report` events from
browsers.

1. Group the errors by message and URL in the log events, for example
   `dc logs --no-log-prefix api | grep '"Captured server error"' | jq -r '.err.message + " " + .url' | sort | uniq -c | sort -rn | head`.
   One endpoint or global?
2. Single dependency (email/storage/billing provider) failing → check that
   provider's status and the relevant `*_PROVIDER` env; the app degrades per
   provider, so disabling the optional capability may restore the core flow.
3. `api` restarting (`dc ps` shows a rising restart count) → an
   `Uncaught exception` fatal event precedes each exit. With
   `origin: "unhandledRejection"` it is a promise nothing awaited: since
   Phase 12 that ends the process in every deployment, including those that
   once reported to Sentry. Fix the missing `await`/`catch`; rolling back buys time.
4. Global and correlated with a deploy → go to runbook #2 (roll back).
5. Sudden traffic / abuse → rate limiting is built in; confirm limits and, if
   needed, tighten per-role limits or block at the proxy.

---

## 4. High latency

**Signals:** `HighLatencyP99` alert, slow page loads, healthy error rate.

1. DB-bound? Check `pg_stat_activity` (runbook #1, step 3) for long queries and
   missing indexes on a new query path.
2. Pool saturation without DB load = too few connections for traffic — raise
   `DB_MAX_CONNECTIONS` (mind the server's max) or add a read replica
   (see [production-postgres.md](./production-postgres.md)).
3. Memory pressure / GC → `dc stats`. Restart the API to mitigate, then profile.

---

## After every incident

- Capture: timeline, blast radius, root cause, the alert that caught it (or the
  gap that didn't).
- File follow-ups: a test that would have caught it, and an alert/threshold
  adjustment if detection was slow.
- If a brand-new failure mode appeared, add a runbook section here.
