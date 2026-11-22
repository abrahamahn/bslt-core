# Working with the database

How to change the schema and how to use the database client (`@bslt/db`). For what the runner does
on a deploy see [migrations](../deploy/migrations.md); for the roles and the row-level security
classes see [database roles](../deploy/env.md#database-roles) and [tenancy](./tenancy.md).

## Add a table

Until `foundation-v1` a schema change is an edit to a baseline, not a new migration file. Every
database is rebuilt from the baselines.

1. **The baseline.** Add the `CREATE TABLE` to the baseline of the owner:
   `main/server/db/legacy-migrations/<owner>/0001_<owner>.sql`, or `main/server/db/sql/0001_sys.sql`
   for a kernel table (`sys_*`). Name the table `<owner>` or `<owner>_<entity>`; the
   `db-legacy-names` ratchet counts a name without the prefix of its owner. Reference only tables of
   the same source and of the sources it depends on (`main/server/db/src/migrate/sources.ts`), and
   change only objects of the same source.
2. **The class.** In the same file, classify it:

   ```sql
   SELECT sys_apply_rls('orgs_notes', 'owner_org', 'tenant_id');
   ```

   The classes and how to choose the command lists are in
   [classifying a table](../deploy/env.md#classifying-a-table). Without a class no runtime role can
   reach the table and the catalog command refuses to write. An `owner_user` or `owner_org` table
   has one NOT NULL owner column.

3. **The catalog and the generated rows.** Rebuild your database, recompute the catalog, regenerate:

   ```bash
   pnpm bslt db reset        # development database: drop, migrate, seed
   pnpm bslt db catalog      # needs a Postgres it may create a scratch database on
   pnpm bslt sync rows       # no database: reads the committed catalog
   ```

   Commit `main/server/db/catalog.snapshot.json` and the generated files with the baseline. The
   generated files give you `<TABLE>_TABLE`, `<Table>Row`, `<Table>Insert`, `<Table>Update` and
   `<TABLE>_COLUMNS` in `main/server/db/src/legacy-generated/<owner>.ts` (kernel:
   `src/generated/rows.ts`), the table in `TABLES` (the startup check), and one structural
   row-level security case in `tests/integration/database/generated/rls.real-db.test.ts`. Do not
   edit them ([the database catalog](./workflow.md#the-database-catalog)).

4. **The tests.**
   - An `owner_user` or `owner_org` table needs a `describeOwnerIsolation` case in
     `tests/integration/api/owner-isolation.real-db.test.ts`: a function that inserts one row for a
     given owner. `pnpm bslt db audit` fails without it.
   - The repository gets a unit test next to it and, for anything a policy decides, a real-DB test
     that runs as a user session (`realDb.database.appDb.withSession({ userId })`), never as the
     superuser.

5. **The checks.** `pnpm bslt gate run db-audit generated-rows db-legacy-names` needs no database.
   `pnpm test:real-db` builds its databases with the runner, so it runs your baseline.

A column, an index or a constraint follows the same steps without the class and the isolation case.

## Sessions

`db.withSession({ userId, tenantId, role, maxAudience })` gives a client whose statements run as that
session. The client binds it with one statement, local to the transaction:

```sql
SELECT set_config('role', $1, true), set_config('app.user_id', $2, true),
       set_config('app.org_id', $3, true), set_config('app.role', $4, true),
       set_config('app.max_audience', $5, true)
```

- A session with a `userId` runs as the role `authenticated`, so the policies apply whatever role
  the pool logged in as. A pool that may not act as `authenticated` (the worker) is refused, and the
  statement is not run.
- A single statement travels with its settings in one batch: one round trip, one implicit
  transaction. `transaction()` binds the session once, before the callback.
- Nothing is set on the connection. The next statement on it starts with no user.
- A request handler does not call `withSession` itself: `request.context.db` is already the user
  session, and `ctx.system.db` is the worker handle for work without a user.

On a session client, and on a pool with timeouts, one call is one statement: no `a; b` strings.

## Transactions and retries

```ts
await db.transaction(async (tx) => {
  const account = await tx.queryOne<Account>(
    select(ACCOUNTS_TABLE).where(eq('id', id)).forUpdate().toSql(),
  );
  await tx.execute(update(ACCOUNTS_TABLE).set({ balance }).where(eq('id', id)).toSql());
});
```

- **The callback may run more than once.** When Postgres rolls a transaction back for a
  serialization failure (`40001`) or a deadlock (`40P01`), `transaction()` runs the callback again
  on a fresh transaction: three attempts by default, with a short jittered wait. Everything the
  callback did in the database was rolled back; what it did elsewhere was not. Keep mail, HTTP calls
  and anything else that must happen once out of the callback, or pass `{ retry: false }`.
- A nested `tx.transaction()` is a savepoint. It keeps the mode of the transaction around it and is
  never retried on its own.
- `isolationLevel`, `readOnly` and `deferrable` are options of the outer call.

## Timeouts

The API's two pools run under limits Postgres enforces
([statement and transaction timeouts](../deploy/production-postgres.md#statement-and-transaction-timeouts)).
A statement over the limit is cancelled with SQLSTATE `57014`; in a transaction that aborts the
transaction.

- To give one statement less time, pass `{ timeout: ms }` to `query`, `queryOne` or `execute`. It
  cannot give a statement more time than the pool's limit.
- A statement that must run long (a backfill, `CREATE INDEX CONCURRENTLY`, `VACUUM`) belongs in a
  migration or a tool: the migration runner and the tools use a pool without limits.

## Locks and queues

`select(...).forUpdate().skipLocked()` passes over rows another transaction has locked, which is how
several workers take different jobs; `noWait()` fails at once with `55P03` instead of waiting. Both
need `forUpdate()` or `forShare()`.

## 64-bit integers and counts

Every `bigint` (int8) column comes back as a JavaScript `bigint`, whatever its value, and the
generated row types say so. A `bigint` is not JSON.

- A count: use `selectCount(table)`, which writes `COUNT(*)::int` and returns a number. In
  hand-written SQL cast the same way (`count(*)::int`, `sum(x)::int`); an uncast `count(*)` is a
  `bigint`.
- A column known to stay small (a byte size, flag bits): `toSafeNumber(value)`, which throws instead
  of rounding.

## Raw SQL fragments

Prefer the builder: `select`, `insert`, `update`, `deleteFrom` and the condition helpers (`eq`,
`and`, `inArray`, ...) quote identifiers and bind every value. When SQL has to be written by hand,
make it a fragment:

```ts
import { fragment, rawCondition, select, update } from '@bslt/db/builder';

// A condition: the text is yours, the value is bound.
select(EVENTS_TABLE).where(rawCondition('"created_at" >= now() - $1::interval', [window]));

// An expression in SET: the column refers to itself.
update(PLANS_TABLE).set({ seats: fragment('"seats" + $1', [added]) });
```

The rules:

- **Text is SQL the server wrote; everything else is a value.** `fragment(text, values)` writes
  `text` into the statement as it is. Never build `text` from a request, a header, a stored string
  or anything else a client can influence. Put those in `values` and refer to them as `$1`, `$2`;
  the builder renumbers them.
- **Only the constructors make a fragment**: `fragment()`, `raw()` (text without values, for a
  keyword or a column name you typed), `rawCondition()`, and the condition and window helpers. A
  plain `{ text, values }` object is a value: `set()`, `values()` and the conditions bind it as a
  parameter, every method that takes a fragment refuses it with a `TypeError`, and it does not
  type-check where a `SqlFragment` is expected. A JSON body can therefore never become SQL.
- **An identifier that is not a constant** (a sort column from a query string) goes through an
  allowlist first; the builder quotes identifiers, it does not decide which ones a caller may name.
- `db.raw(text, values)` runs a whole statement. It is for tools and tests; in server code it
  counts against the `raw-sql-outside-repos` ratchet, and SQL belongs in a repository.
- A string bound to a `jsonb` parameter is stored as one JSON string, not as the document it
  spells. Bind the value itself (an object or an array), or cast serialized text in the statement
  (`$1::text::jsonb`), as the queue does for a job's arguments.
