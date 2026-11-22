# Backup and Restore Procedure

## Backup Methods

### Which role takes the backup

`pg_dump` must connect as the Postgres **superuser** (`POSTGRES_USER`), or as a
role with `BYPASSRLS` and read access to every table. None of the application's
own roles can take a backup (see [Database roles](./env.md#database-roles)):

- `pg_dump` runs with `row_security = off`, and a role that row-level security
  binds is then refused instead of silently dumping a subset. As `bslt_owner` it
  stops at `activities`, one of the `FORCE ROW LEVEL SECURITY` tables, with
  `query would be affected by row-level security policy`.
- `bslt_app` and `bslt_worker` stop earlier, at the `migrations` table, with
  `permission denied`.

Keep privileges in the dump: do not pass `--no-privileges` (`-x`). The grants to
the `authenticated` and `bslt_system` roles are issued once, by a migration that
is recorded as applied and never runs again. A database restored without them
has its policies but none of the grants, and `bslt_app` and `bslt_worker` get
`permission denied` on every table. `--no-owner` is fine: the role bootstrap
hands restored objects to `bslt_owner`.

The host-cron script below dumps as `POSTGRES_USER`, with ownership and
privileges, so it already meets both requirements.

### Self-hosted PostgreSQL (`pg_dump`)

```bash
# $DB_USER is the Postgres superuser here, not an application role (see above).

# Full database dump (compressed, custom format)
pg_dump -Fc -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME > backup_$(date +%Y%m%d_%H%M%S).dump

# SQL-format dump (human-readable, slower restore)
pg_dump -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME > backup_$(date +%Y%m%d_%H%M%S).sql
```

### Automated nightly backups (host cron — recommended)

[`main/tools/scripts/deploy/backup-database.sh`](../../main/tools/scripts/deploy/backup-database.sh)
runs on the host that has the database, from root cron. Prefer it over the CI
workflow below.

**Why not CI.** A backup should have _fewer_ dependencies than the thing it
protects. Routing it through Actions adds hosted minutes, a network path from
the runner into production, and secrets that must be configured before the job
does anything — and if any of those is missing the job still reports green. That
is the worst possible failure mode: it buys false confidence. See the warning
under the CI section below.

What the script guarantees, and why each check exists:

| Check                         | Catches                                                                                                                                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trap … ERR`                  | A `set -e` death before the explicit guards, which otherwise exits in silence                                                                                                                              |
| Byte floor (`MIN_DUMP_BYTES`) | A catastrophically empty dump                                                                                                                                                                              |
| `gzip -t`                     | A truncated write — otherwise invisible until you try to restore                                                                                                                                           |
| `CREATE TABLE` count          | A dump that unpacks cleanly but holds half a schema. **The schema is most of the bytes, so a zero-row dump clears any size threshold** — this is the check that actually distinguishes good from truncated |
| Read-back after upload        | An upload that reports success but stored nothing                                                                                                                                                          |
| Missing offsite = **failure** | Silently degrading to a local-only copy                                                                                                                                                                    |

Tune `MIN_DUMP_TABLES` to your schema (`\dt` in psql gives the current count);
set it near, not at, that number so growth does not fail the job.

**Install (one time, as root on the database host):**

```bash
install -m 0755 backup-database.sh /opt/bslt/backup-database.sh

# Offsite credentials. Without this file the script FAILS rather than keeping
# a local-only copy — see BACKUP_ALLOW_LOCAL_ONLY below.
cat > /etc/bslt-backup.env <<'EOF'
BACKUP_S3_BUCKET=your-bucket
BACKUP_S3_ENDPOINT=https://nyc3.digitaloceanspaces.com
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
EOF
chmod 600 /etc/bslt-backup.env

# 03:17 UTC — an odd minute, to avoid the top-of-hour stampede.
( crontab -l 2>/dev/null; \
  echo '17 3 * * * . /etc/bslt-backup.env && /opt/bslt/backup-database.sh >> /var/log/bslt-backup.log 2>&1' \
) | crontab -
```

Set **offsite retention as a bucket lifecycle rule**, not in the script. The
script prunes only the local copies, so a bug in it can never delete your
offsite history.

`BACKUP_ALLOW_LOCAL_ONLY=1` is the one escape hatch, for before the bucket
exists. It is deliberately awkward: it warns on every run and exits `3`, so a
cron that mails on failure keeps nagging until offsite is configured.

**Still missing in both paths:** nothing alerts if the job stops running. A
silent cron is indistinguishable from a healthy one until you need a restore.

### Encrypted in-network backups & PITR (`infra/runtime/backup`)

[`infra/runtime/backup/README.md`](../../infra/runtime/backup/README.md) replaces the retired
CI backup workflow (owner decision **D13**):

- [`backup.sh`](../../infra/runtime/backup/backup.sh) — runs inside the private network on the
  database host, dumps with `pg_dump -Fc --no-owner` using the pinned `POSTGRES_IMAGE`, verifies
  table count, encrypts client-side with `AES-256-GCM` (`BSLTBK01`), uploads + `headObject`
  verifies via `@bslt/protocols/s3`, and emits Prometheus freshness gauges (`BackupStale` alert).
- [`wal-archive.sh`](../../infra/runtime/backup/wal-archive.sh) &
  [`wal-restore.sh`](../../infra/runtime/backup/wal-restore.sh) — PostgreSQL `archive_command` /
  `restore_command` hooks for continuous encrypted PITR WAL shipping.
- [`restore-drill.sh`](../../infra/runtime/backup/restore-drill.sh) — automated offsite restore
  drill into a disposable scratch database.

### Managed database (DigitalOcean / GCP)

Use the provider's snapshot feature:

- **DigitalOcean:** Databases > your-cluster > Backups > Create Manual Backup
- **GCP Cloud SQL:** Instance > Backups > Create Backup

Managed providers typically run automated daily backups with 7-day retention. Extend to 30 days if your plan allows.

## Recommended Schedule

| Backup type     | Frequency             | Retention                       |
| --------------- | --------------------- | ------------------------------- |
| Automated daily | Daily                 | 30 days                         |
| Pre-migration   | Before each migration | Until next successful migration |
| Pre-deployment  | Before major releases | 7 days                          |
| Manual snapshot | On demand             | As needed                       |

## Manual Backup Commands

```bash
# Set connection variables
export DB_HOST=localhost
export DB_PORT=5432
export DB_USER=postgres # the superuser: application roles cannot dump (see above)
export DB_NAME=your_app_prod

# Compressed backup (recommended for production)
pg_dump -Fc -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME \
  -f "your_app_prod_$(date +%Y%m%d_%H%M%S).dump"

# Upload to remote storage (example: S3-compatible)
aws s3 cp "your_app_prod_*.dump" s3://your-backup-bucket/db-backups/
```

## Restore Procedure

The restore runs as the Postgres superuser, and the database roles are handled
on both sides of it: they must exist before the dump is loaded (its policies and
grants name them), and the bootstrap runs again afterwards to hand what was
restored to `bslt_owner`.

The restore touches both servers ([two servers](./README.md#two-servers)). `compose` runs on the
**app server** and `dbc` on the **database server**. On an app server deployed by the Deploy
workflow, run `compose` from `~/deployments/<app>/<environment>/` as
`docker compose --project-name <app>-<environment> -f docker-compose.prod.yml` instead (its `.env`
is read automatically).

```bash
# App server
compose() {
  docker compose -f infra/docker/production/docker-compose.prod.yml \
    --env-file config/env/.env.production "$@"
}

# Database server, in the directory that holds docker-compose.db.yml
dbc() {
  docker compose --env-file .env.database -f docker-compose.db.yml "$@"
}
DB_NAME=your_app_prod # POSTGRES_DB on both servers
```

### Step 1: Stop the application, keep Postgres

```bash
# App server. The database server keeps running.
compose stop caddy web api pgbouncer
```

### Step 2: Make sure the database roles exist

```bash
# App server
compose run --rm bootstrap-roles
```

On the host that took the backup this changes nothing. On a new host it creates
`bslt_owner`, `bslt_app`, `bslt_worker` and the two policy-target roles, without
which the restore cannot recreate the policies and grants.

### Step 3: Restore the database, as the superuser

```bash
# Database server. From a custom-format dump (recommended): into an empty database
dbc exec -T postgres psql -U postgres -d postgres \
  -c "DROP DATABASE IF EXISTS $DB_NAME" -c "CREATE DATABASE $DB_NAME"
dbc exec -T postgres pg_restore --no-owner -U postgres -d "$DB_NAME" < backup.dump

# From a SQL dump
dbc exec -T postgres psql -U postgres -d "$DB_NAME" < backup.sql
```

For an external self-hosted Postgres, run the same `pg_restore --no-owner` with
`-h`, `-p` and the superuser's `-U`. Restoring over the existing database with
`--clean --if-exists` also works, but `pg_restore` then reports
`cannot drop inherited constraint` for the partitions of the `events` table and
exits non-zero; those errors are harmless, which is why the empty-database form
is the one shown.

For managed databases, use the provider's restore-from-backup UI or CLI.

### Step 4: Roles again, pending migrations, then start

```bash
compose run --rm bootstrap-roles && # hand the restored objects to bslt_owner
  compose run --rm migrate &&       # apply migrations newer than the backup
  compose up -d                     # the API starts only after both succeeded
```

The second bootstrap is not optional: a `--no-owner` restore leaves every table
owned by the superuser, and `migrate` runs as `bslt_owner`.

## Post-Restore Verification

1. **Health check:** `curl https://your-api-url/health` -- should return 200
2. **Row counts:** Verify critical tables have expected data:
   ```sql
   SELECT 'users' AS tbl, COUNT(*) FROM users
   UNION ALL SELECT 'tenants', COUNT(*) FROM tenants
   UNION ALL SELECT 'subscriptions', COUNT(*) FROM subscriptions;
   ```
3. **Login flow:** Attempt login with a known test account
4. **Migration state:** Verify `SELECT * FROM migrations ORDER BY applied_at DESC LIMIT 5;` matches expected state
5. **Check logs:** Monitor application logs for connection errors or missing data

---

## Restore Drill

A backup you have never restored is a hypothesis. The drill turns it into a
fact, and it is the only way to discover the failure modes that verification
inside the backup job cannot see — a dump that is valid but of the wrong
database, a missing extension, an object the restore user cannot create.

Run it **quarterly**, and after any change to the backup script, the schema
tooling, or the storage provider.

Two rules make the drill meaningful rather than ceremonial:

1. **Restore the offsite object, not the local copy.** The local file proves
   nothing about the thing you would actually reach for after losing the host.
2. **Restore somewhere else** — a throwaway container, never production, never
   the production host. A drill that can damage production will not get run.

```bash
# 1. Pull the newest offsite object (never the local copy)
aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 ls "s3://$BACKUP_S3_BUCKET/db-backups/" | tail -3
aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp \
  "s3://$BACKUP_S3_BUCKET/db-backups/bslt_YYYYMMDD_HHMMSSZ.sql.gz" /tmp/drill.sql.gz

# 2. Restore into a scratch Postgres of the pinned image, off the production host
. infra/versions.env
docker run --rm -d --name drill -e POSTGRES_PASSWORD=drill -p 55432:5432 "$POSTGRES_IMAGE"
sleep 5
gunzip -c /tmp/drill.sql.gz | docker exec -i drill psql -U postgres -d postgres

# 3. Compare against live
docker exec -i drill psql -U postgres -d postgres -c "\dt" | wc -l
docker exec -i drill psql -U postgres -d postgres \
  -c "SELECT 'users' AS tbl, COUNT(*) FROM users
      UNION ALL SELECT 'tenants', COUNT(*) FROM tenants;"
docker exec -i drill psql -U postgres -d postgres \
  -c "SELECT name FROM migrations ORDER BY applied_at DESC LIMIT 1;"

# 4. Tear down
docker rm -f drill && rm /tmp/drill.sql.gz
```

**Pass criteria:** table count matches live, row counts for the tables you care
about match live (allowing for writes since the dump), and the newest migration
is the one you expect.

**Expected noise:** `GRANT`/`ALTER OWNER`/`CREATE POLICY` errors for roles that
do not exist in the scratch instance (`bslt_owner`, `authenticated`,
`bslt_system`) are normal and do not fail the drill — the data is what is under
test, not the role graph. A real restore creates those roles first; see the
restore procedure above.

**Record the result** (date, object restored, table/row counts, outcome) in the
weekly log. An undocumented drill is indistinguishable from one that never
happened.
