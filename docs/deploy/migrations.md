# Database Migration Guide

## Overview

One runner builds every database: `pnpm bslt db migrate` (`pnpm db:migrate`). It
is the multi-source runner of `@bslt/db` (`main/server/db/src/migrate/`). The
production image, the real-database tests and the catalog snapshot call the same
code.

**Sources.** A source is a directory of `NNNN_<name>.sql` files with an id:

| Source    | Directory                                         | Holds                                                                                                               |
| --------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `kernel`  | `main/server/db/sql/`                             | Roles and grants, the `sys_*` session helpers, `sys_apply_rls`, `sys_apply_audience`, `sys_jobs`, `sys_cron`        |
| `<owner>` | `main/server/db/legacy-migrations/<owner>/`       | The tables of one owner, with their classification, policies, grants and triggers: one baseline, `0001_<owner>.sql` |
| (seeds)   | `main/server/db/legacy-migrations/<owner>/seeds/` | Required seeds: rows the application cannot run without (compliance: the starter legal documents)                   |

The owners are `identity`, `orgs`, `billing`, `notifications`, `audit`,
`webhooks`, `flags`, `files`, `compliance`, `analytics`, `tasks` and `support`.
They and what each depends on are listed in
`main/server/db/src/migrate/sources.ts`. A legacy baseline holds the tables of
an owner whose module has not migrated yet; the module's migration moves the
file to `main/modules/<id>/server/migrations/` (restructure plan, section 9.1).

**Order.** The kernel first, then every source after the sources it depends on
(ties by id), and inside a source the files by number. Required seeds run after
all migrations.

**Record.** `sys_migrations(source, name, checksum, applied_at)`. A file is
applied once, in one transaction with its record. The runner holds an advisory
lock for the whole run, so two runners on one database never interleave.

**Limits and retries.** The runner's connection sets no statement or lock
timeout: a long DDL statement or backfill is never cancelled (the limits of
[the API's pools](./production-postgres.md#statement-and-transaction-timeouts)
do not apply to it). A file's transaction that loses a deadlock or cannot be
serialized is run again, as every transaction of the client is; nothing of the
failed attempt was committed.

**Outside a transaction.** A file whose leading comment has the line
`-- bslt:no-transaction` runs statement by statement outside a transaction
(`CREATE INDEX CONCURRENTLY`). It has to be safe to run again: a failure half
way leaves no record.

## Baselines are edited in place until `foundation-v1`

Until the foundation is tagged, a schema change is an edit to the baseline of
its owner, not a new file. A database built from the earlier content cannot be
migrated forward, so the runner stops before it changes anything:

```
This database cannot be migrated forward:
  - billing/0001_billing.sql changed after it was applied
...
run: pnpm bslt db reset
```

The same happens when a recorded file is gone, a new file sorts before an
applied one, or the database has tables the runner has no record of (a database
built by the old `0000`..`0926` chain).

- **Development:** `pnpm bslt db reset` drops every table, migrates and seeds the
  development users. It refuses to run with `NODE_ENV=production`.
- **Demo:** the deploy recreates the demo database when its migrate job reports
  this (exit code 3). The demo database is disposable.
- **Production:** a deploy fails and changes nothing. There is no production
  database to carry forward yet; from `foundation-v1` on, files are append-only
  and a changed checksum is an error everywhere.

After changing a baseline, run `pnpm bslt db catalog` against a local Postgres,
then `pnpm bslt sync rows`, and commit `main/server/db/catalog.snapshot.json`
and the generated files with the change
([The database catalog](../dev/workflow.md#the-database-catalog)).

## Running Migrations

### Development

```bash
pnpm db:migrate   # apply what is pending
pnpm db:reset     # drop everything, migrate, seed the development users
```

The runner connects with `MIGRATION_DATABASE_URL` (the owner role, `bslt_owner`).
Outside production, when that is unset, it falls back to the single development
connection (`DATABASE_URL`, else the `POSTGRES_*` parts).

### Production

Migrations run as the owner role (`bslt_owner`, `MIGRATION_DATABASE_URL`), after
the role bootstrap and before the API starts. On every deploy, in this order:

```bash
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

`bootstrap-roles` and `migrate` are one-shot services of the production app
Compose file (profile `ops`, so a plain `up` never starts them). They run on the
app server and connect to the separate database server directly
([two servers](./README.md#two-servers)); nothing runs on the database server
itself.

The image ships no repository tooling. `migrate` runs
`node node_modules/@bslt/db/dist/migrate/entry.js`: the same `migrateDatabase`
that `pnpm bslt db migrate` calls, on the SQL files the `@bslt/db` package
carries (`sql/` and `legacy-migrations/`). Its exit code is 0 when the database
is up to date, 1 on a failure and 3 when the database has to be rebuilt from the
baselines.

`migrate` reads only `MIGRATION_DATABASE_URL`. In production it refuses to run
without it and never falls back to `DATABASE_URL`, which is the unprivileged app
role there. Do not run migrations with `exec api ...`: the running API container
deliberately has neither the owner URL nor the superuser password. See
[Database roles](./env.md#database-roles).

## Changing the schema

1. Edit the baseline of the owner: `main/server/db/legacy-migrations/<owner>/0001_<owner>.sql`,
   or `main/server/db/sql/0001_sys.sql` for a kernel table.
2. A new table needs a class: `SELECT sys_apply_rls('<table>', '<class>', ...)` in
   the same file ([Classifying a table](./env.md#classifying-a-table)). Without it
   the table has no runtime grants and `pnpm db:audit` fails.
3. A file references only tables of its own source and of the sources it depends
   on, and changes only objects of its own source: `pnpm bslt db catalog` fails
   on a source that alters or drops what another one created.
4. `pnpm bslt db reset`, then `pnpm bslt db catalog` and `pnpm bslt sync rows`,
   and commit the catalog and the generated files with the change.

A second file in a source (`0002_<name>.sql`) is for what cannot run inside the
baseline's transaction, and after `foundation-v1` for every change.

## Rollback

Migrations are forward-only. There is no automatic rollback. Before
`foundation-v1` the way back is the previous commit and `pnpm bslt db reset`.

## Best practices

- **Back up before migrating production.** See [backup-restore.md](./backup-restore.md).
- **Test on a real database.** `pnpm test:real-db` builds every suite's database
  with the runner.
- **One owner per table.** A file never alters or drops another source's object.
