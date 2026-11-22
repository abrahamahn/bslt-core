// tests/integration/database/rls-classes.real-db.test.ts
/**
 * The row-level security classes, once per class (Real DB)
 *
 * Restructure plan 9.4, proof item 2: what each class of `sys_apply_rls` does,
 * shown on fixture tables that only the kernel baseline describes, as both
 * runtime roles:
 *
 * - `bslt_app` (user sessions: role `authenticated`, `app.user_id`):
 *   cross-user and cross-org read, update and delete touch 0 rows, and an
 *   insert for a foreign owner fails WITH CHECK;
 * - `bslt_worker` (the system role): it reaches a table only where the class
 *   or the table's own list names system commands, never through a user class;
 * - the audience backstop of `sys_apply_audience` fails closed for both.
 *
 * Every table here is classified with the three-argument form: the commands
 * are the ones of the class. The per-table lists and the admin commands are
 * covered by tests/integration/api/rls-foundation.real-db.test.ts; the
 * generated structural test proves that every table of the product equals its
 * class.
 *
 * Requires a reachable Postgres; mandatory in CI via REQUIRE_REAL_DB.
 */

import { randomUUID } from 'node:crypto';

import { DB_ROLES, type DbClient } from '@bslt/db';
import { describeRealDb, type TestDatabase } from '@bslt/testing/real-db';
import { beforeAll, describe, expect, it } from 'vitest';

const TEST_TIMEOUT = 30_000;

/** `new row violates row-level security policy`. */
const RLS_VIOLATION = /row-level security/;
/** `permission denied for table`. */
const NO_PRIVILEGE = /permission denied/;

interface PolicyRow {
  name: string;
  cmd: string;
  permissive: string;
  roles: string[];
}

describeRealDb('Row-level security classes on kernel fixtures (Real DB)', (realDb) => {
  let harness: TestDatabase;
  /** Superuser: seeding and truth. */
  let admin: DbClient;
  /** bslt_owner: what a migration runs as. */
  let owner: DbClient;
  /** bslt_worker: the system role. */
  let worker: DbClient;

  const alice = randomUUID();
  const bob = randomUUID();
  const orgOfAlice = randomUUID();
  const orgOfBob = randomUUID();

  /** A user session on the app pool, as a request has it. */
  const as = (userId: string): DbClient => harness.appDb.withSession({ userId, role: 'user' });

  /**
   * Run `work` in one transaction of `pool` with the given settings bound the
   * way the client binds a session: `set_config(..., true)`.
   */
  async function withSettings<T>(
    pool: DbClient,
    settings: Readonly<Record<string, string>> & { readonly userId?: string },
    work: (tx: DbClient) => Promise<T>,
  ): Promise<T> {
    return pool.transaction(async (tx) => {
      const { userId, ...rest } = settings;
      if (userId !== undefined) {
        await tx.raw(`SET LOCAL ROLE ${DB_ROLES.authenticated}`);
        await tx.raw(`SELECT set_config('app.user_id', $1, true)`, [userId]);
      }
      for (const [name, value] of Object.entries(rest)) {
        await tx.raw(`SELECT set_config($1, $2, true)`, [name, value]);
      }
      return work(tx as DbClient);
    });
  }

  async function policies(table: string): Promise<PolicyRow[]> {
    return admin.raw<PolicyRow>(
      `SELECT policyname AS name, cmd, permissive, roles::text[] AS roles
         FROM pg_policies WHERE schemaname = 'public' AND tablename = $1
        ORDER BY policyname`,
      [table],
    );
  }

  async function grants(table: string, grantee: string): Promise<string[]> {
    const rows = await admin.raw<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = 'public' AND table_name = $1 AND grantee = $2
        ORDER BY privilege_type`,
      [table, grantee],
    );
    return rows.map((row) => row.privilege_type);
  }

  async function seed(table: string, columns: string, values: unknown[]): Promise<string> {
    const placeholders = values.map((_, index) => `$${String(index + 1)}`).join(', ');
    const [row] = await admin.raw<{ id: string }>(
      `INSERT INTO ${table} (${columns}) VALUES (${placeholders}) RETURNING id`,
      values,
    );
    if (row === undefined) throw new Error(`seed returned no row for ${table}`);
    return row.id;
  }

  async function note(table: string, id: string): Promise<string | null> {
    const [row] = await admin.raw<{ note: string }>(`SELECT note FROM ${table} WHERE id = $1`, [
      id,
    ]);
    return row?.note ?? null;
  }

  /** Read, update and delete of one row: the rows each command touched. */
  async function touch(
    db: DbClient,
    table: string,
    id: string,
  ): Promise<{ read: number; updated: number; deleted: number }> {
    const read = await db.raw(`SELECT id FROM ${table} WHERE id = $1`, [id]);
    const updated = await db.execute({
      text: `UPDATE ${table} SET note = 'changed' WHERE id = $1`,
      values: [id],
    });
    const deleted = await db.execute({ text: `DELETE FROM ${table} WHERE id = $1`, values: [id] });
    return { read: read.length, updated, deleted };
  }

  /** Every command of the worker on a table whose class gives the system role nothing. */
  async function expectWorkerRefused(table: string, insert: string, id: string): Promise<void> {
    await expect(worker.raw(`SELECT id FROM ${table}`)).rejects.toThrow(NO_PRIVILEGE);
    await expect(worker.raw(insert)).rejects.toThrow(NO_PRIVILEGE);
    await expect(
      worker.raw(`UPDATE ${table} SET note = 'changed' WHERE id = $1`, [id]),
    ).rejects.toThrow(NO_PRIVILEGE);
    await expect(worker.raw(`DELETE FROM ${table} WHERE id = $1`, [id])).rejects.toThrow(
      NO_PRIVILEGE,
    );
  }

  beforeAll(async () => {
    harness = realDb.database;
    admin = harness.adminDb;
    owner = harness.ownerDb;
    worker = harness.db;

    for (const [id, name] of [
      [alice, 'alice'],
      [bob, 'bob'],
    ] as const) {
      await admin.raw(
        `INSERT INTO identity_users (id, email, canonical_email, username, role)
         VALUES ($1, $2, $2, $3, 'user')`,
        [id, `${name}@rls-classes.test`, `classes_${name}`],
      );
    }
    const [orgsReg] = await admin.raw<{ reg: string | null }>(
      `SELECT to_regclass('public.orgs')::text AS reg`,
    );
    if (orgsReg?.reg === null) {
      await owner.raw(
        `CREATE TABLE orgs (
           id uuid PRIMARY KEY,
           name text NOT NULL,
           slug text NOT NULL,
           owner_id uuid NOT NULL
         )`,
      );
      await owner.raw(
        `CREATE TABLE orgs_members (
           org_id uuid NOT NULL,
           user_id uuid NOT NULL,
           role text NOT NULL,
           PRIMARY KEY (org_id, user_id)
         )`,
      );
    }
    for (const [org, member, slug] of [
      [orgOfAlice, alice, 'classes-alice'],
      [orgOfBob, bob, 'classes-bob'],
    ] as const) {
      await admin.raw(`INSERT INTO orgs (id, name, slug, owner_id) VALUES ($1, $2, $2, $3)`, [
        org,
        slug,
        member,
      ]);
      await admin.raw(`INSERT INTO orgs_members (org_id, user_id, role) VALUES ($1, $2, 'owner')`, [
        org,
        member,
      ]);
    }
  }, 120_000);

  // ==========================================================================
  // Session helpers
  // ==========================================================================

  describe('session helpers', () => {
    const read = async (
      settings: Readonly<Record<string, string>>,
    ): Promise<{ user_id: string | null; org_id: string | null; audience: number }> => {
      const [row] = await withSettings(harness.appDb, settings, (tx) =>
        tx.raw<{ user_id: string | null; org_id: string | null; audience: number }>(
          `SELECT sys_current_user_id()::text AS user_id, sys_current_org_id()::text AS org_id,
                  sys_max_audience()::int AS audience`,
        ),
      );
      if (row === undefined) throw new Error('no row');
      return row;
    };

    it(
      'answer NULL, NULL and audience 0 for a session that binds nothing',
      async () => {
        expect(await read({})).toEqual({ user_id: null, org_id: null, audience: 0 });
        expect(await read({ 'app.user_id': '', 'app.org_id': '', 'app.max_audience': '' })).toEqual(
          { user_id: null, org_id: null, audience: 0 },
        );
      },
      TEST_TIMEOUT,
    );

    it(
      'read app.user_id, app.org_id and app.max_audience',
      async () => {
        expect(
          await read({ 'app.user_id': alice, 'app.org_id': orgOfAlice, 'app.max_audience': '2' }),
        ).toEqual({ user_id: alice, org_id: orgOfAlice, audience: 2 });
      },
      TEST_TIMEOUT,
    );

    it(
      'read the org from app.org_id only, which is what the client binds',
      async () => {
        // The name the client bound before the one-statement session: read by nothing.
        expect((await read({ 'app.tenant_id': orgOfBob })).org_id).toBeNull();
        expect((await read({ 'app.tenant_id': orgOfBob, 'app.org_id': orgOfAlice })).org_id).toBe(
          orgOfAlice,
        );
        // What `withSession({ orgId })` binds is what the helper answers.
        const [row] = await harness.appDb
          .withSession({ userId: alice, orgId: orgOfAlice, role: 'user' })
          .raw<{ org_id: string }>(`SELECT sys_current_org_id()::text AS org_id`);
        expect(row).toEqual({ org_id: orgOfAlice });
      },
      TEST_TIMEOUT,
    );

    it(
      'refuse a ceiling that is not a number instead of reading it as one',
      async () => {
        await expect(read({ 'app.max_audience': 'everything' })).rejects.toThrow(
          /invalid input syntax/,
        );
      },
      TEST_TIMEOUT,
    );
  });

  // ==========================================================================
  // owner_user
  // ==========================================================================

  describe('owner_user', () => {
    const table = 'sys_fixture_owner_user';
    let ofAlice: string;

    beforeAll(async () => {
      await owner.raw(
        `CREATE TABLE ${table} (
           id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
           owner_user_id uuid NOT NULL,
           note text NOT NULL)`,
      );
      await owner.raw(`SELECT sys_apply_rls('${table}', 'owner_user', 'owner_user_id')`);
      ofAlice = await seed(table, 'owner_user_id, note', [alice, 'of alice']);
      await seed(table, 'owner_user_id, note', [bob, 'of bob']);
    });

    it(
      'the three-argument form gives the class its commands: all four to users, none to the system',
      async () => {
        const authenticated = [DB_ROLES.authenticated];
        expect(await policies(table)).toEqual([
          {
            name: 'rls_user_delete',
            cmd: 'DELETE',
            permissive: 'PERMISSIVE',
            roles: authenticated,
          },
          {
            name: 'rls_user_insert',
            cmd: 'INSERT',
            permissive: 'PERMISSIVE',
            roles: authenticated,
          },
          {
            name: 'rls_user_select',
            cmd: 'SELECT',
            permissive: 'PERMISSIVE',
            roles: authenticated,
          },
          {
            name: 'rls_user_update',
            cmd: 'UPDATE',
            permissive: 'PERMISSIVE',
            roles: authenticated,
          },
        ]);
        expect(await grants(table, DB_ROLES.authenticated)).toEqual([
          'DELETE',
          'INSERT',
          'SELECT',
          'UPDATE',
        ]);
        expect(await grants(table, DB_ROLES.system)).toEqual([]);
        const [meta] = await admin.raw<{ forced: boolean; comment: string }>(
          `SELECT relforcerowsecurity AS forced, obj_description(oid, 'pg_class') AS comment
             FROM pg_class WHERE oid = '${table}'::regclass`,
        );
        expect(meta).toEqual({ forced: true, comment: 'rls:owner_user' });
      },
      TEST_TIMEOUT,
    );

    it(
      'bslt_app: a user reaches its own row and no other',
      async () => {
        const mine = await as(alice).raw<{ note: string }>(`SELECT note FROM ${table}`);
        expect(mine).toEqual([{ note: 'of alice' }]);
      },
      TEST_TIMEOUT,
    );

    it(
      "bslt_app: another user's read, update and delete touch 0 rows",
      async () => {
        expect(await touch(as(bob), table, ofAlice)).toEqual({ read: 0, updated: 0, deleted: 0 });
        expect(await note(table, ofAlice)).toBe('of alice');
      },
      TEST_TIMEOUT,
    );

    it(
      'bslt_app: an insert for a foreign owner, and handing an own row over, fail WITH CHECK',
      async () => {
        await expect(
          as(bob).raw(`INSERT INTO ${table} (owner_user_id, note) VALUES ($1, 'forged')`, [alice]),
        ).rejects.toThrow(RLS_VIOLATION);
        await expect(
          as(bob).raw(`UPDATE ${table} SET owner_user_id = $1`, [alice]),
        ).rejects.toThrow(RLS_VIOLATION);
      },
      TEST_TIMEOUT,
    );

    it(
      'bslt_app without a user session reaches no row',
      async () => {
        expect(await touch(harness.appDb, table, ofAlice)).toEqual({
          read: 0,
          updated: 0,
          deleted: 0,
        });
      },
      TEST_TIMEOUT,
    );

    it(
      'bslt_worker: every command is refused, a user id in the session included',
      async () => {
        await expectWorkerRefused(
          table,
          `INSERT INTO ${table} (owner_user_id, note) VALUES ('${alice}', 'by worker')`,
          ofAlice,
        );
        // The worker is not a member of `authenticated`: it cannot become a user session.
        await expect(
          worker.withSession({ userId: alice, role: 'user' }).raw(`SELECT id FROM ${table}`),
        ).rejects.toThrow(/permission denied to set role/);
        await expect(
          withSettings(worker, { 'app.user_id': alice }, (tx) => tx.raw(`SELECT id FROM ${table}`)),
        ).rejects.toThrow(NO_PRIVILEGE);
        expect(await note(table, ofAlice)).toBe('of alice');
      },
      TEST_TIMEOUT,
    );
  });

  // ==========================================================================
  // owner_org
  // ==========================================================================

  describe('owner_org', () => {
    const table = 'sys_fixture_owner_org';
    let ofAliceOrg: string;

    beforeAll(async () => {
      await owner.raw(
        `CREATE TABLE ${table} (
           id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
           org_id uuid NOT NULL,
           note text NOT NULL)`,
      );
      await owner.raw(`SELECT sys_apply_rls('${table}', 'owner_org', 'org_id')`);
      ofAliceOrg = await seed(table, 'org_id, note', [orgOfAlice, 'of the org of alice']);
      await seed(table, 'org_id, note', [orgOfBob, 'of the org of bob']);
    });

    it(
      'bslt_app: a member reaches the rows of its org and no other',
      async () => {
        const mine = await as(alice).raw<{ note: string }>(`SELECT note FROM ${table}`);
        expect(mine).toEqual([{ note: 'of the org of alice' }]);
      },
      TEST_TIMEOUT,
    );

    it(
      "bslt_app: a member of another org's read, update and delete touch 0 rows",
      async () => {
        expect(await touch(as(bob), table, ofAliceOrg)).toEqual({
          read: 0,
          updated: 0,
          deleted: 0,
        });
        expect(await note(table, ofAliceOrg)).toBe('of the org of alice');
      },
      TEST_TIMEOUT,
    );

    it(
      'bslt_app: naming the foreign org in the session does not make the caller a member',
      async () => {
        const claiming = harness.appDb.withSession({
          userId: bob,
          orgId: orgOfAlice,
          role: 'user',
        });
        expect(await touch(claiming, table, ofAliceOrg)).toEqual({
          read: 0,
          updated: 0,
          deleted: 0,
        });
        const viaOrgId = await withSettings(
          harness.appDb,
          { userId: bob, 'app.org_id': orgOfAlice },
          (tx) => tx.raw(`SELECT id FROM ${table} WHERE id = $1`, [ofAliceOrg]),
        );
        expect(viaOrgId).toEqual([]);
      },
      TEST_TIMEOUT,
    );

    it(
      'bslt_app: an insert for a foreign org, and moving a row to one, fail WITH CHECK',
      async () => {
        await expect(
          as(bob).raw(`INSERT INTO ${table} (org_id, note) VALUES ($1, 'forged')`, [orgOfAlice]),
        ).rejects.toThrow(RLS_VIOLATION);
        await expect(as(bob).raw(`UPDATE ${table} SET org_id = $1`, [orgOfAlice])).rejects.toThrow(
          RLS_VIOLATION,
        );
      },
      TEST_TIMEOUT,
    );

    it(
      'bslt_worker: every command is refused',
      async () => {
        await expectWorkerRefused(
          table,
          `INSERT INTO ${table} (org_id, note) VALUES ('${orgOfAlice}', 'by worker')`,
          ofAliceOrg,
        );
      },
      TEST_TIMEOUT,
    );
  });

  // ==========================================================================
  // public_read
  // ==========================================================================

  describe('public_read', () => {
    const table = 'sys_fixture_public_read';
    let row: string;

    beforeAll(async () => {
      await owner.raw(
        `CREATE TABLE ${table} (
           id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
           note text NOT NULL)`,
      );
      await owner.raw(`SELECT sys_apply_rls('${table}', 'public_read')`);
      row = await seed(table, 'note', ['for everyone']);
    });

    it(
      'bslt_app: every user reads, and no user writes',
      async () => {
        expect(await as(alice).raw(`SELECT note FROM ${table}`)).toEqual([
          { note: 'for everyone' },
        ]);
        expect(await as(bob).raw(`SELECT note FROM ${table}`)).toEqual([{ note: 'for everyone' }]);
        expect(await grants(table, DB_ROLES.authenticated)).toEqual(['SELECT']);
        await expect(as(bob).raw(`INSERT INTO ${table} (note) VALUES ('forged')`)).rejects.toThrow(
          NO_PRIVILEGE,
        );
        await expect(
          as(bob).raw(`UPDATE ${table} SET note = 'changed' WHERE id = $1`, [row]),
        ).rejects.toThrow(NO_PRIVILEGE);
        await expect(as(bob).raw(`DELETE FROM ${table} WHERE id = $1`, [row])).rejects.toThrow(
          NO_PRIVILEGE,
        );
        expect(await note(table, row)).toBe('for everyone');
      },
      TEST_TIMEOUT,
    );

    it(
      'bslt_worker: every command is refused',
      async () => {
        await expectWorkerRefused(table, `INSERT INTO ${table} (note) VALUES ('by worker')`, row);
      },
      TEST_TIMEOUT,
    );
  });

  // ==========================================================================
  // append_only
  // ==========================================================================

  describe('append_only', () => {
    const table = 'sys_fixture_append_only';
    let ofAlice: string;

    beforeAll(async () => {
      await owner.raw(
        `CREATE TABLE ${table} (
           id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
           owner_user_id uuid NOT NULL,
           note text NOT NULL)`,
      );
      await owner.raw(`SELECT sys_apply_rls('${table}', 'append_only', 'owner_user_id')`);
      ofAlice = await seed(table, 'owner_user_id, note', [alice, 'of alice']);
    });

    it(
      'bslt_app: a user appends and reads its own rows; another user reads none of them',
      async () => {
        const [added] = await as(alice).raw<{ id: string }>(
          `INSERT INTO ${table} (owner_user_id, note) VALUES ($1, 'appended') RETURNING id`,
          [alice],
        );
        expect(added?.id).toEqual(expect.any(String));
        expect(await as(alice).raw(`SELECT id FROM ${table}`)).toHaveLength(2);
        expect(await as(bob).raw(`SELECT id FROM ${table}`)).toEqual([]);
        await expect(
          as(bob).raw(`INSERT INTO ${table} (owner_user_id, note) VALUES ($1, 'forged')`, [alice]),
        ).rejects.toThrow(RLS_VIOLATION);
      },
      TEST_TIMEOUT,
    );

    it(
      'bslt_app: nobody updates or deletes, the owner included',
      async () => {
        expect(await grants(table, DB_ROLES.authenticated)).toEqual(['INSERT', 'SELECT']);
        for (const user of [alice, bob]) {
          await expect(
            as(user).raw(`UPDATE ${table} SET note = 'changed' WHERE id = $1`, [ofAlice]),
          ).rejects.toThrow(NO_PRIVILEGE);
          await expect(
            as(user).raw(`DELETE FROM ${table} WHERE id = $1`, [ofAlice]),
          ).rejects.toThrow(NO_PRIVILEGE);
        }
        expect(await note(table, ofAlice)).toBe('of alice');
      },
      TEST_TIMEOUT,
    );

    it(
      'bslt_worker: every command is refused',
      async () => {
        await expectWorkerRefused(
          table,
          `INSERT INTO ${table} (owner_user_id, note) VALUES ('${alice}', 'by worker')`,
          ofAlice,
        );
      },
      TEST_TIMEOUT,
    );
  });

  // ==========================================================================
  // system
  // ==========================================================================

  describe('system', () => {
    const table = 'sys_fixture_system';
    let row: string;

    beforeAll(async () => {
      await owner.raw(
        `CREATE TABLE ${table} (
           id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
           owner_user_id uuid,
           note text NOT NULL)`,
      );
      await owner.raw(`SELECT sys_apply_rls('${table}', 'system')`);
      row = await seed(table, 'owner_user_id, note', [alice, 'system row about alice']);
    });

    it(
      'bslt_worker: reads, inserts, updates and deletes',
      async () => {
        expect(await policies(table)).toEqual([
          {
            name: 'system_access_policy',
            cmd: 'ALL',
            permissive: 'PERMISSIVE',
            roles: [DB_ROLES.system],
          },
        ]);
        expect(await worker.raw(`SELECT id FROM ${table}`)).toHaveLength(1);
        const [added] = await worker.raw<{ id: string }>(
          `INSERT INTO ${table} (note) VALUES ('by worker') RETURNING id`,
        );
        expect(await touch(worker, table, String(added?.id))).toEqual({
          read: 1,
          updated: 1,
          deleted: 1,
        });
      },
      TEST_TIMEOUT,
    );

    it(
      'bslt_app: no user command, for the user the row is about either',
      async () => {
        expect(await grants(table, DB_ROLES.authenticated)).toEqual([]);
        for (const db of [as(alice), as(bob), harness.appDb]) {
          await expect(db.raw(`SELECT id FROM ${table}`)).rejects.toThrow(NO_PRIVILEGE);
          await expect(
            db.raw(`UPDATE ${table} SET note = 'changed' WHERE id = $1`, [row]),
          ).rejects.toThrow(NO_PRIVILEGE);
          await expect(db.raw(`DELETE FROM ${table} WHERE id = $1`, [row])).rejects.toThrow(
            NO_PRIVILEGE,
          );
        }
        expect(await note(table, row)).toBe('system row about alice');
      },
      TEST_TIMEOUT,
    );
  });

  // ==========================================================================
  // custom
  // ==========================================================================

  describe('custom', () => {
    const table = 'sys_fixture_custom';

    beforeAll(async () => {
      await owner.raw(
        `CREATE TABLE ${table} (
           id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
           owner_user_id uuid NOT NULL,
           note text NOT NULL)`,
      );
      await owner.raw(`SELECT sys_apply_rls('${table}', 'custom')`);
      await seed(table, 'owner_user_id, note', [alice, 'of alice']);
    });

    it(
      'grants nothing and writes no policy until the migration lists commands and writes its own',
      async () => {
        expect(await policies(table)).toEqual([]);
        expect(await grants(table, DB_ROLES.authenticated)).toEqual([]);
        expect(await grants(table, DB_ROLES.system)).toEqual([]);
        await expect(as(alice).raw(`SELECT id FROM ${table}`)).rejects.toThrow(NO_PRIVILEGE);
        await expect(worker.raw(`SELECT id FROM ${table}`)).rejects.toThrow(NO_PRIVILEGE);

        // Granted but without a policy: still no row (FORCE, default deny).
        await owner.raw(`SELECT sys_apply_rls('${table}', 'custom', NULL, ARRAY['select'])`);
        expect(await as(alice).raw(`SELECT id FROM ${table}`)).toEqual([]);
      },
      TEST_TIMEOUT,
    );
  });

  // ==========================================================================
  // The audience backstop
  // ==========================================================================

  describe('sys_apply_audience', () => {
    const table = 'sys_fixture_audience';

    /** The notes a session sees, sorted. */
    const seen = async (
      pool: DbClient,
      settings: Readonly<Record<string, string>> & { readonly userId?: string },
    ): Promise<string[]> => {
      const rows = await withSettings(pool, settings, (tx) =>
        tx.raw<{ note: string }>(`SELECT note FROM ${table} ORDER BY note`),
      );
      return rows.map((entry) => entry.note);
    };

    beforeAll(async () => {
      await owner.raw(
        `CREATE TABLE ${table} (
           id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
           owner_user_id uuid NOT NULL,
           audience smallint,
           note text NOT NULL)`,
      );
      // Everyone reads (public_read), the system role too; the audience narrows it.
      await owner.raw(
        `SELECT sys_apply_rls('${table}', 'public_read', NULL, NULL, NULL, ARRAY['select'])`,
      );
      await owner.raw(`SELECT sys_apply_audience('${table}', 'audience', 'owner_user_id')`);
      for (const [audience, label] of [
        [null, 'unrated'],
        [0, 'rated 0'],
        [1, 'rated 1'],
        [3, 'rated 3'],
      ] as const) {
        await seed(table, 'owner_user_id, audience, note', [alice, audience, label]);
      }
    });

    it(
      'adds one restrictive policy that names no role, on top of the class',
      async () => {
        expect(await policies(table)).toEqual([
          { name: 'rls_audience', cmd: 'SELECT', permissive: 'RESTRICTIVE', roles: ['public'] },
          {
            name: 'rls_user_select',
            cmd: 'SELECT',
            permissive: 'PERMISSIVE',
            roles: [DB_ROLES.authenticated],
          },
          {
            name: 'system_access_policy',
            cmd: 'ALL',
            permissive: 'PERMISSIVE',
            roles: [DB_ROLES.system],
          },
        ]);
      },
      TEST_TIMEOUT,
    );

    it(
      'bslt_app: the owner sees every row, rated or not, without a ceiling',
      async () => {
        expect(await seen(harness.appDb, { userId: alice })).toEqual([
          'rated 0',
          'rated 1',
          'rated 3',
          'unrated',
        ]);
      },
      TEST_TIMEOUT,
    );

    it(
      'bslt_app: another user without a ceiling has ceiling 0 (fail closed)',
      async () => {
        expect(await seen(harness.appDb, { userId: bob })).toEqual(['rated 0']);
        expect(await seen(harness.appDb, { userId: bob, 'app.max_audience': '' })).toEqual([
          'rated 0',
        ]);
      },
      TEST_TIMEOUT,
    );

    it(
      'bslt_app: another user sees rated rows up to its ceiling, and never an unrated one',
      async () => {
        expect(await seen(harness.appDb, { userId: bob, 'app.max_audience': '1' })).toEqual([
          'rated 0',
          'rated 1',
        ]);
        expect(await seen(harness.appDb, { userId: bob, 'app.max_audience': '32767' })).toEqual([
          'rated 0',
          'rated 1',
          'rated 3',
        ]);
      },
      TEST_TIMEOUT,
    );

    it(
      'bslt_worker: the system role is bound too, with the same ceiling rule',
      async () => {
        expect(await seen(worker, {})).toEqual(['rated 0']);
        expect(await seen(worker, { 'app.max_audience': '3' })).toEqual([
          'rated 0',
          'rated 1',
          'rated 3',
        ]);
      },
      TEST_TIMEOUT,
    );

    it(
      'is repeatable, and refuses a table that is not classified or a column that is not a rating',
      async () => {
        const before = await policies(table);
        await owner.raw(`SELECT sys_apply_audience('${table}', 'audience', 'owner_user_id')`);
        expect(await policies(table)).toEqual(before);

        await owner.raw(`CREATE TABLE sys_fixture_unclassified (id uuid, rating smallint, o uuid)`);
        await expect(
          owner.raw(`SELECT sys_apply_audience('sys_fixture_unclassified', 'rating', 'o')`),
        ).rejects.toThrow(/classify the table with sys_apply_rls first/);
        await expect(
          owner.raw(`SELECT sys_apply_audience('${table}', 'note', 'owner_user_id')`),
        ).rejects.toThrow(/must be smallint/);
        await expect(
          owner.raw(`SELECT sys_apply_audience('${table}', 'audience', 'nobody')`),
        ).rejects.toThrow(/no column "nobody"/);
      },
      TEST_TIMEOUT,
    );

    it(
      'only the owner role may call the template and the backstop',
      async () => {
        for (const db of [harness.appDb, worker]) {
          await expect(
            db.raw(`SELECT sys_apply_audience('${table}', 'audience', 'owner_user_id')`),
          ).rejects.toThrow(NO_PRIVILEGE);
          await expect(db.raw(`SELECT sys_apply_rls('${table}', 'system')`)).rejects.toThrow(
            NO_PRIVILEGE,
          );
        }
      },
      TEST_TIMEOUT,
    );
  });
});
