// main/kernel/server/src/testing/real-db/index.ts
/**
 * `describeRealDb` and `describeOwnerIsolation` for module and integration
 * real-DB suites. Lives in `@bslt/server-system/testing/real-db` (and is
 * re-exported by `@bslt/testing/real-db`) so native modules under
 * `main/modules/*` can test owner isolation without forming a workspace cycle
 * through `@bslt/server`.
 */

import { randomUUID } from 'node:crypto';

import { buildConnectionString, createRawDb, type DbClient } from '@bslt/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initEnv } from '../../config/factory';
import { createTestDatabase, type TestDatabase } from '../database/lifecycle';

export { createTestDatabase, type TestDatabase } from '../database/lifecycle';

const realDbRequired = process.env['CI'] !== undefined || process.env['REQUIRE_REAL_DB'] === '1';

await initEnv();

export const baseConnectionString: string = buildConnectionString();

async function canReachDatabase(): Promise<boolean> {
  try {
    const db = createRawDb({ connectionString: baseConnectionString });
    await db.raw('SELECT 1');
    await db.close();
    return true;
  } catch {
    return false;
  }
}

export const realDbAvailable: boolean = realDbRequired || (await canReachDatabase());

export interface RealDbSuite {
  readonly database: TestDatabase;
  readonly baseConnectionString: string;
}

export interface DescribeRealDbOptions {
  readonly migrate?: boolean;
  readonly setupTimeoutMs?: number;
}

export function describeRealDb(
  name: string,
  suite: (realDb: RealDbSuite) => void,
  options: DescribeRealDbOptions = {},
): void {
  if (!realDbAvailable) {
    process.stderr.write(`[real-db] No reachable Postgres: skipping "${name}".\n`);
  }

  describe.runIf(realDbAvailable)(name, () => {
    let database: TestDatabase | undefined;

    beforeAll(async () => {
      database = await createTestDatabase({ baseConnectionString });
      if (options.migrate !== false) {
        await database.migrate();
      }
    }, options.setupTimeoutMs ?? 120_000);

    afterAll(async () => {
      await database?.destroy();
    });

    suite({
      get database(): TestDatabase {
        if (database === undefined) {
          throw new Error(
            'describeRealDb: the database is created in beforeAll. Read `realDb.database` inside a hook or a test.',
          );
        }
        return database;
      },
      baseConnectionString,
    });
  });
}

export interface OwnerIsolationCase {
  readonly table: string;
  readonly owner?: 'user' | 'org';
  seedRow(admin: DbClient, ownerId: string): Promise<string>;
  readonly idColumn?: string;
  readonly update?: string;
  readonly ownerMayDelete?: boolean;
}

async function seedIsolationUser(admin: DbClient, name: string): Promise<string> {
  const id = randomUUID();
  const email = `${name}-${id}@owner-isolation.test`;
  await admin.raw(
    `INSERT INTO identity_users (id, email, canonical_email, username, role,
                                 email_verified, email_verified_at)
     VALUES ($1, $2, $2, $3, 'user', true, now())`,
    [id, email, `${name}_${id.slice(0, 8)}`],
  );
  await admin.raw(`INSERT INTO identity_credentials (user_id, password_hash) VALUES ($1, 'x')`, [
    id,
  ]);
  await admin.raw(`INSERT INTO identity_profiles (user_id) VALUES ($1)`, [id]);
  await admin.raw(`INSERT INTO identity_lockouts (user_id) VALUES ($1)`, [id]);
  return id;
}

async function seedIsolationOrg(admin: DbClient, userId: string): Promise<string> {
  const id = randomUUID();
  await admin.raw(`INSERT INTO orgs (id, name, slug, owner_id) VALUES ($1, $2, $2, $3)`, [
    id,
    `isolation-${id}`,
    userId,
  ]);
  await admin.raw(`INSERT INTO orgs_members (org_id, user_id, role) VALUES ($1, $2, 'owner')`, [
    id,
    userId,
  ]);
  return id;
}

export function describeOwnerIsolation(
  realDb: RealDbSuite,
  cases: OwnerIsolationCase | readonly OwnerIsolationCase[],
): void {
  const list: OwnerIsolationCase[] = Array.isArray(cases)
    ? [...(cases as readonly OwnerIsolationCase[])]
    : [cases as OwnerIsolationCase];

  describe.each(list)('owner isolation: $table', (isolation: OwnerIsolationCase) => {
    const { table } = isolation;
    const idColumn = isolation.idColumn ?? 'id';
    let admin: DbClient;
    let owner: string;
    let other: string;
    let rowId: string;
    let ownerOrg: string | undefined;

    const session = (userId: string): DbClient =>
      realDb.database.appDb.withSession({ userId, role: 'user' });

    const visibleTo = async (userId: string): Promise<number> => {
      const rows = await session(userId).raw<{ count: number }>(
        `SELECT count(*)::int AS count FROM ${table} WHERE ${idColumn} = $1`,
        [rowId],
      );
      return rows[0]?.count ?? Number.NaN;
    };

    const truth = async (): Promise<string | null> => {
      const rows = await admin.raw<{ row: string }>(
        `SELECT to_jsonb(t)::text AS row FROM ${table} t WHERE ${idColumn} = $1`,
        [rowId],
      );
      return rows[0]?.row ?? null;
    };

    beforeAll(async () => {
      admin = realDb.database.adminDb;
      owner = await seedIsolationUser(admin, 'owner');
      other = await seedIsolationUser(admin, 'other');
      if (isolation.owner === 'org') {
        ownerOrg = await seedIsolationOrg(admin, owner);
        await seedIsolationOrg(admin, other);
        rowId = await isolation.seedRow(admin, ownerOrg);
      } else {
        rowId = await isolation.seedRow(admin, owner);
      }
    });

    it('the owner sees its row', async () => {
      expect(await visibleTo(owner)).toBe(1);
    });

    it('another user does not see the row', async () => {
      expect(await visibleTo(other)).toBe(0);
    });

    if (isolation.owner === 'org') {
      it("naming the owner's org in the session does not show the row", async () => {
        const claiming = realDb.database.appDb.withSession({
          userId: other,
          orgId: String(ownerOrg),
          role: 'user',
        });
        const rows = await claiming.raw<{ count: string }>(
          `SELECT count(*) AS count FROM ${table} WHERE ${idColumn} = $1`,
          [rowId],
        );
        expect(Number(rows[0]?.count)).toBe(0);
      });
    }

    if (isolation.update !== undefined) {
      const assignment = isolation.update;
      it("another user's update changes nothing; the owner's does", async () => {
        const text = `UPDATE ${table} SET ${assignment} WHERE ${idColumn} = $1`;
        const before = await truth();

        expect(await session(other).execute({ text, values: [rowId] })).toBe(0);
        expect(await truth()).toBe(before);

        expect(await session(owner).execute({ text, values: [rowId] })).toBe(1);
      });
    }

    it("another user's delete removes nothing", async () => {
      const text = `DELETE FROM ${table} WHERE ${idColumn} = $1`;
      const before = await truth();
      expect(before).not.toBeNull();

      const removed = await session(other)
        .execute({ text, values: [rowId] })
        .catch((error: unknown) => {
          expect(String((error as { code?: string }).code)).toBe('42501');
          return 0;
        });

      expect(removed).toBe(0);
      expect(await truth()).toBe(before);
    });

    if (isolation.ownerMayDelete === true) {
      it('the owner deletes its row', async () => {
        const text = `DELETE FROM ${table} WHERE ${idColumn} = $1`;
        expect(await session(owner).execute({ text, values: [rowId] })).toBe(1);
        expect(await truth()).toBeNull();
      });
    }
  });
}
