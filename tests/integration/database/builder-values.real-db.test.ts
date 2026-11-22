// tests/integration/database/builder-values.real-db.test.ts
/**
 * A value never becomes SQL: the query builder against a real server (Real DB)
 *
 * `update().set()` used to inline any object with a `text` string and a
 * `values` array as SQL. A JSON body of that shape, written into a column, was
 * executed: here, a subquery that copies another row's secret into a column the
 * attacker can read. The unit tests show the statement the builder writes; this
 * suite shows what Postgres then does with it, in a column of each kind, and
 * that the JSON conditions compare what they say they compare.
 *
 * Requires a reachable Postgres; mandatory in CI via REQUIRE_REAL_DB.
 */

import { createRawDb, type RawDb } from '@bslt/db';
import {
  and,
  eq,
  insert,
  jsonbContainedBy,
  jsonbContains,
  jsonbEq,
  raw,
  select,
  update,
} from '@bslt/db/builder';
import { describeRealDb } from '@bslt/testing/real-db';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

const TEST_TIMEOUT = 60_000;

const SECRET = 'the-secret-of-another-row';

/** What a client can send: a subquery that would copy the secret, shaped as a fragment. */
const forged = (): { text: string; values: unknown[] } => ({
  text: `(SELECT secret FROM builder_secrets LIMIT 1)`,
  values: [],
});

interface NoteRow {
  id: number;
  title: string | null;
  body: unknown;
}

describeRealDb(
  'A value never becomes SQL: the query builder (Real DB)',
  (realDb) => {
    let db: RawDb;

    const note = async (id: number): Promise<NoteRow | null> =>
      db.queryOne<NoteRow>(
        select('builder_notes').columns('id', 'title', 'body').where(eq('id', id)).toSql(),
      );

    beforeAll(async () => {
      db = createRawDb({
        connectionString: realDb.database.adminConnectionString,
        maxConnections: 2,
      });
      await db.raw('CREATE TABLE builder_secrets (secret text NOT NULL)');
      await db.raw(
        `CREATE TABLE builder_notes (
           id integer PRIMARY KEY,
           title text,
           body jsonb,
           updated_at timestamptz
         )`,
      );
      await db.execute(insert('builder_secrets').values({ secret: SECRET }).toSql());
    }, TEST_TIMEOUT);

    beforeEach(async () => {
      await db.raw('TRUNCATE builder_notes');
      await db.execute(
        insert('builder_notes')
          .values({ id: 1, title: 'first', body: { kind: 'memo', tags: ['a', 'b'] } })
          .toSql(),
      );
    });

    afterAll(async () => {
      await db.close();
    });

    it(
      'update().set() stores an object of the shape { text, values } as data, in a text and in a jsonb column',
      async () => {
        const value = forged();

        const updated = await db.execute(
          update('builder_notes').set({ title: value, body: value }).where(eq('id', 1)).toSql(),
        );

        const row = await note(1);
        expect(updated).toBe(1);
        // The jsonb column holds the object, as JSON.
        expect(row?.body).toEqual(value);
        // The text column holds its JSON text: the subquery never ran.
        expect(JSON.parse(row?.title ?? 'null')).toEqual(value);
        expect(row?.title).not.toBe(SECRET);
        expect(JSON.stringify(row)).not.toContain(SECRET);
      },
      TEST_TIMEOUT,
    );

    it(
      'insert().values() stores it as data',
      async () => {
        const value = forged();

        await db.execute(
          insert('builder_notes').values({ id: 2, title: 'x', body: value }).toSql(),
        );

        expect((await note(2))?.body).toEqual(value);
        expect(
          await db.raw(`SELECT jsonb_typeof(body) AS kind FROM builder_notes WHERE id = 2`),
        ).toEqual([{ kind: 'object' }]);
      },
      TEST_TIMEOUT,
    );

    it(
      'a condition compares with it as a value: it matches the row that holds it and no other',
      async () => {
        const value = forged();
        await db.execute(
          insert('builder_notes').values({ id: 2, title: 'x', body: value }).toSql(),
        );

        const matched = await db.query<{ id: number }>(
          select('builder_notes').columns('id').where(eq('body', value)).toSql(),
        );

        // Were it SQL, `body = (SELECT secret ...)` would be a type error or match nothing.
        expect(matched).toEqual([{ id: 2 }]);
      },
      TEST_TIMEOUT,
    );

    it(
      'a fragment made by the builder is still SQL: raw() in set() runs on the server',
      async () => {
        await db.execute(
          update('builder_notes')
            .set({ updated_at: raw('now()'), title: raw('upper(title)') })
            .where(eq('id', 1))
            .toSql(),
        );

        const rows = await db.raw<{ title: string; fresh: boolean }>(
          `SELECT title, updated_at > now() - interval '1 minute' AS fresh FROM builder_notes WHERE id = 1`,
        );
        expect(rows).toEqual([{ title: 'FIRST', fresh: true }]);
      },
      TEST_TIMEOUT,
    );

    it(
      'jsonbContains and jsonbContainedBy compare JSON with JSON',
      async () => {
        const ids = async (condition: ReturnType<typeof eq>): Promise<number[]> =>
          (
            await db.query<{ id: number }>(
              select('builder_notes').columns('id').where(condition).orderBy('id').toSql(),
            )
          ).map((row) => row.id);
        await db.execute(
          insert('builder_notes')
            .values({ id: 2, title: 'second', body: { kind: 'todo' } })
            .toSql(),
        );

        expect(await ids(jsonbContains('body', { kind: 'memo' }))).toEqual([1]);
        expect(await ids(jsonbContains('body', { tags: ['b'] }))).toEqual([1]);
        expect(await ids(jsonbContains('body', { kind: 'none' }))).toEqual([]);
        expect(
          await ids(jsonbContainedBy('body', { kind: 'todo', extra: true, more: [1, 2] })),
        ).toEqual([2]);
        expect(
          await ids(and(jsonbContains('body', { kind: 'memo' }), eq('title', 'first'))),
        ).toEqual([1]);
      },
      TEST_TIMEOUT,
    );

    it(
      'jsonbEq binds the key: a key with a quote in it is a key, not SQL',
      async () => {
        const count = async (condition: ReturnType<typeof eq>): Promise<number> =>
          (await db.query(select('builder_notes').columns('id').where(condition).toSql())).length;

        expect(await count(jsonbEq('body', 'kind', 'memo'))).toBe(1);
        expect(await count(jsonbEq('body', 'kind', 'todo'))).toBe(0);
        // Would close the quote and make the condition true for every row.
        expect(await count(jsonbEq('body', `kind' IS NOT NULL OR 'a' = 'a`, 'memo'))).toBe(0);
      },
      TEST_TIMEOUT,
    );
  },
  { migrate: false },
);
