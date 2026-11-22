# Data, Row-Level Security & Operations Spec

**Status:** Canonical (`foundation-v1`)  
**Scope:** PostgreSQL 17 schema topology, database roles, forced Row-Level Security, append-only migrations, generated row bindings, transactional outbox/jobs, and encrypted backups/PITR.

---

## 1. One Flat `public` Schema & Table Ownership

BSLT uses a single PostgreSQL `public` schema across all tenants and modules:

- **Kernel tables** start with `sys_` (`sys_migrations`, `sys_jobs`, `sys_cron_schedules`, `sys_outbox`, `sys_outbox_deliveries`) and are defined in [`main/kernel/db/sql/0001_sys.sql`](../../main/kernel/db/sql/0001_sys.sql).
- **Module tables** equal `<id>` or start with `<id>_` (for example `identity_users`, `orgs_memberships`, `billing_subscriptions`, `tasks`) and live in `main/modules/<id>/server/migrations/`.
- Every table, view, function, trigger, enum, and policy in [`main/kernel/db/catalog.snapshot.json`](../../main/kernel/db/catalog.snapshot.json) is attributed to exactly one owner (`kernel` or a module in `bslt.config.ts`) and audited by `pnpm bslt db audit` (`db-audit` gate).

---

## 2. Three Login Roles & Policy-Target Roles

Provisioned by `pnpm db:bootstrap:roles` (`@bslt/db` role bootstrap):

| Role            | Kind          | Purpose                                                                                                      |
| --------------- | ------------- | ------------------------------------------------------------------------------------------------------------ |
| `bslt_owner`    | Login (admin) | Runs DDL migrations only (`MIGRATION_DATABASE_URL`). Never used by runtime API or worker processes.          |
| `bslt_app`      | Login         | API & realtime pools (`DATABASE_URL`). Switches per transaction between `authenticated` and `bslt_system`.   |
| `bslt_worker`   | Login         | Background job & outbox pools (`WORKER_DATABASE_URL`). Member of `bslt_system`, never `BYPASSRLS`.           |
| `authenticated` | NOLOGIN       | End-user RLS target (`SET LOCAL ROLE authenticated` + `app.user_id` / `app.org_id` session GUCs).            |
| `bslt_system`   | NOLOGIN       | Trusted background/system RLS target; accesses rows only where an explicit `system_access_policy` grants it. |
| `bslt_definer`  | NOLOGIN       | Used exclusively by `SECURITY DEFINER` session helpers (`sys_current_user_is_org_member`, etc.).             |

No runtime role ever holds `SUPERUSER`, `CREATEDB`, `CREATEROLE`, or `BYPASSRLS`. Default privileges on `public` are revoked so newly created tables deny all runtime access until explicitly classified.

---

## 3. Forced Row-Level Security (`sys_apply_rls`)

Every application and system table enables **and forces** Row-Level Security via `SELECT sys_apply_rls(tbl, class, owner_col, user_ops, admin_ops, system_ops)`:

| Class         | Default User Predicate                                     | Default User Ops                 | Default System Ops               |
| ------------- | ---------------------------------------------------------- | -------------------------------- | -------------------------------- |
| `owner_user`  | `<owner_col> = sys_current_user_id()`                      | `select, insert, update, delete` | —                                |
| `owner_org`   | `sys_current_user_is_org_member(<owner_col>)`              | `select, insert, update, delete` | —                                |
| `public_read` | `true`                                                     | `select`                         | —                                |
| `append_only` | `<owner_col> = sys_current_user_id()`                      | `select, insert`                 | —                                |
| `system`      | _(none — inaccessible to `authenticated`)_                 | —                                | `select, insert, update, delete` |
| `custom`      | Explicit per-command policies declared in owning migration | _(explicit)_                     | _(explicit)_                     |

Additional safety mechanisms:

- **Audience backstop (`sys_apply_audience`):** Restrictive policy on `files` (`audience_level <= sys_current_max_audience()`), failing closed (`NULL` audience rows are invisible to non-owners).
- **Platform admin predicate (`sys_current_user_is_platform_admin()`):** Re-checks live `identity_users.role = 'admin'` and lockout/deletion status on every statement rather than trusting stale JWT claims.
- **Automated RLS proof:** `pnpm bslt sync rows` emits `server/generated/rls.real-db.test.ts` per module, and domain repositories add `describeOwnerIsolation` suites executed as `bslt_app`.

---

## 4. Append-Only Migrations & Locked Checksums

- Migrations live in `main/kernel/db/sql/` (`0001_sys.sql`) and `main/modules/<id>/server/migrations/NNNN_<name>.sql`.
- Every shipped migration's SHA-256 checksum is locked in [`bslt.lock.json`](../../bslt.lock.json) (`migrations` map, verified by the `lockfile` gate via `pnpm bslt sync permissions`).
- `@bslt/db`'s migration runner (`migrateDatabase`) verifies both `lockedChecksums` from `bslt.lock.json` and recorded checksums in `sys_migrations`, refusing to run if any historical SQL file is mutated after release. Schema changes after `foundation-v1` are strictly append-only (`0002_*.sql`, etc.).

---

## 5. Catalog Snapshot & Generated Row Bindings

SQL crosses a language boundary into TypeScript through two deterministic steps:

1. `pnpm bslt db catalog` applies all migrations to a clean PostgreSQL 17 database and writes [`main/kernel/db/catalog.snapshot.json`](../../main/kernel/db/catalog.snapshot.json).
2. `pnpm bslt sync rows` reads `catalog.snapshot.json` and generates typed row interfaces, column maps, table constants (`main/kernel/db/src/generated/` and `main/modules/<id>/server/generated/rows.ts`), and real-DB RLS verification suites.

Raw SQL queries live exclusively inside `repository.ts` files (`raw-sql-outside-repos` budget = `0`) over `@bslt/protocols/pg` (`createPgPool`, PostgreSQL wire v3.0).

---

## 6. Transactional Outbox, Jobs & Cron

All asynchronous side effects share one PostgreSQL-backed pipeline:

1. **Transactional outbox (`sys_outbox`):** Domain mutations call `k.events.publish(tx, eventDef, payload)` inside the same database transaction as the state change.
2. **Outbox relay & deliveries (`sys_outbox_deliveries`):** The worker role claims unpublished events and dispatches each subscriber at-least-once with deduplication per `(outbox_id, subscriber_key)`.
3. **Job queue (`sys_jobs`):** Background tasks (`default` and `media` queues) use `FOR UPDATE SKIP LOCKED`, exponential backoff retries, dead-letter state (`dead`), and Prometheus alert coverage (`DeadBackgroundJobs`).
4. **Cron (`sys_cron_schedules`):** Module schedules declared in `implementServer` tick through `@bslt/server-system/cron` and enqueue deterministic jobs onto `sys_jobs`.

See [`../reference/database.md`](../reference/database.md) and [`../reference/events-jobs-cron.md`](../reference/events-jobs-cron.md) for the generated catalog of every table, event, job, and cron schedule.

---

## 7. Encrypted Backups, PITR & Restore Drills

Production backups run inside the private database network (`infra/runtime/backup/`, owner decision D13) — never by opening PostgreSQL to CI runners:

- **Logical + physical backups:** `infra/runtime/backup/backup.sh` streams `pg_dump --format=custom` through owned `AES-256-GCM` encryption (`BSLTBK01` envelope in `main/tools/scripts/deploy/backup.ts`) to S3-compatible object storage (`@bslt/protocols/s3` SigV4) and updates `bslt_backup_last_success_timestamp_seconds` (`BackupStale` alert fires if > 30h old).
- **Continuous WAL archiving (PITR):** `wal-archive.sh` and `wal-restore.sh` encrypt and restore WAL segments for point-in-time recovery.
- **Automated restore drill:** `restore-drill.sh` (`runRestoreDrill`) downloads the uploaded ciphertext from object storage, verifies SHA-256 + GCM authentication tags, restores into an ephemeral database, and asserts row-count invariants (exercised in CI by `tests/integration/database/backup-restore-drill.real-db.test.ts`).

See [`../deploy/backup-restore.md`](../deploy/backup-restore.md) and [`../deploy/production-postgres.md`](../deploy/production-postgres.md) for operator runbooks.
