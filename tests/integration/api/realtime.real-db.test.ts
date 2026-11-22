// tests/integration/api/realtime.real-db.test.ts
import { randomUUID } from 'node:crypto';

import {
  handleGetRecords,
  handleWrite,
  isTableAllowed,
  registerRealtimeTable,
  type RealtimeModuleDeps,
  type RealtimeRequest,
  type RealtimeTransaction,
} from '@bslt/realtime';
import { scopeSessionDb } from '@bslt/server/bootstrap/phases/data';
import { describeRealDb, type TestDatabase } from '@bslt/testing/real-db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const SECRET_MARKERS = [
  'hash-marker-attacker',
  'hash-marker-victim',
  'totp-marker-attacker',
  'totp-marker-victim',
] as const;

interface UserRow {
  id: string;
  role: string;
  email: string;
  phone: string | null;
  version: number;
  token_version: number;
  email_verified: boolean;
  locked_until: Date | null;
  totp_enabled: boolean;
}

describeRealDb('Realtime record API (Real DB)', (realDb) => {
  let harness: TestDatabase;
  let ctx: RealtimeModuleDeps;
  let attackerId: string;
  let victimId: string;

  async function seedUser(name: string): Promise<string> {
    const rows = await harness.db.raw<{ id: string }>(
      `INSERT INTO identity_users (email, canonical_email, username, role, phone)
       VALUES ($1, $1, $2, 'user', $3)
       RETURNING id`,
      [`${name}@realtime.test`, name, `note of ${name}`],
    );
    const id = String(rows[0]?.id);
    await harness.db.raw(
      `INSERT INTO identity_credentials (user_id, password_hash, totp_secret)
       VALUES ($1, $2, $3)`,
      [id, `hash-marker-${name}`, `totp-marker-${name}`],
    );
    await harness.db.raw(`INSERT INTO identity_profiles (user_id) VALUES ($1)`, [id]);
    await harness.db.raw(`INSERT INTO identity_lockouts (user_id) VALUES ($1)`, [id]);
    return id;
  }

  async function readUser(id: string): Promise<UserRow> {
    const rows = await harness.db.raw<UserRow>(
      `SELECT u.id, u.role, u.email, u.phone, u.version, u.token_version, u.email_verified,
              l.locked_until, COALESCE(c.totp_enabled, false) AS totp_enabled
         FROM identity_users u
         LEFT JOIN identity_lockouts l ON l.user_id = u.id
         LEFT JOIN identity_credentials c ON c.user_id = u.id
        WHERE u.id = $1`,
      [id],
    );
    const row = rows[0];
    if (row === undefined) throw new Error(`seeded user ${id} vanished`);
    return row;
  }

  function as(userId: string): RealtimeRequest {
    return {
      user: { userId, email: 'ignored@realtime.test', role: 'user' },
      cookies: {},
      headers: {},
      requestInfo: { ipAddress: '127.0.0.1', userAgent: 'realtime-real-db' },
    } as RealtimeRequest;
  }

  function ctxFor(userId: string): RealtimeModuleDeps {
    return {
      ...ctx,
      db: scopeSessionDb({ app: harness.appDb, system: harness.db }, { userId, role: 'user' }),
    };
  }

  function write(
    authorId: string,
    targetId: string,
    key: string,
    value: unknown,
  ): RealtimeTransaction {
    return {
      txId: randomUUID(),
      authorId,
      clientTimestamp: Date.now(),
      operations: [{ type: 'set', table: 'users', id: targetId, key, value }],
    };
  }

  function expectNoSecrets(body: unknown): void {
    const json = JSON.stringify(body);
    for (const marker of SECRET_MARKERS) {
      expect(json).not.toContain(marker);
    }
  }

  beforeAll(async () => {
    harness = realDb.database;

    attackerId = await seedUser('attacker');
    victimId = await seedUser('victim');

    ctx = {
      db: harness.db,
      pubsub: { publish: vi.fn() },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      config: {
        env: 'test',
        auth: { cookie: { secret: 'unused' }, jwt: { secret: 'unused' } },
      },
    } as unknown as RealtimeModuleDeps;
  }, 120_000);

  afterAll(async () => {});

  describe('default registry', () => {
    it('does not expose users for reading', async () => {
      expect(isTableAllowed('users')).toBe(false);

      const result = await handleGetRecords(
        ctxFor(attackerId),
        { pointers: [{ table: 'users', id: victimId }] },
        as(attackerId),
      );

      expect(result.status).toBe(400);
      expectNoSecrets(result.body);
    });

    it('does not let anyone promote a user to admin', async () => {
      const before = await readUser(victimId);

      const result = await handleWrite(
        ctxFor(attackerId),
        write(attackerId, victimId, 'role', 'admin'),
        as(attackerId),
      );

      expect(result.status).toBe(400);
      expect(await readUser(victimId)).toEqual(before);
    });
  });

  describe('with an app-registered users policy', () => {
    beforeAll(() => {
      registerRealtimeTable('users', {
        tableName: 'identity_users',
        readableColumns: ['id', 'version', 'phone'],
        writableFields: ['phone'],
        ownerColumn: 'id',
      });
    });

    it('returns only the caller own row, with only allowlisted columns', async () => {
      const result = await handleGetRecords(
        ctxFor(attackerId),
        {
          pointers: [
            { table: 'users', id: attackerId },
            { table: 'users', id: victimId },
          ],
        },
        as(attackerId),
      );

      expect(result.status).toBe(200);
      const users = (result.body as { recordMap: Record<string, Record<string, object>> })
        .recordMap['users'];
      expect(Object.keys(users ?? {})).toEqual([attackerId]);
      expect(Object.keys(users?.[attackerId] ?? {}).sort()).toEqual(['id', 'phone', 'version']);
      expectNoSecrets(result.body);
    });

    it('cannot read another user row by asking for it alone', async () => {
      const result = await handleGetRecords(
        ctxFor(attackerId),
        { pointers: [{ table: 'users', id: victimId }] },
        as(attackerId),
      );

      expect(result.status).toBe(200);
      expect(result.body).toEqual({ recordMap: { users: {} } });
    });

    it('cannot write another user row, even an allowlisted field', async () => {
      const before = await readUser(victimId);

      const result = await handleWrite(
        ctxFor(attackerId),
        write(attackerId, victimId, 'phone', 'defaced'),
        as(attackerId),
      );

      expect(result.status).toBe(400);
      expect(await readUser(victimId)).toEqual(before);
      expectNoSecrets(result.body);
    });

    it('scopes reads and writes to the caller by its own owner filter where RLS does not', async () => {
      const unscoped = { ...ctx, db: harness.db };
      const [visible] = await harness.db.raw<{ count: number }>(
        'SELECT COUNT(*)::int AS count FROM identity_users WHERE id = $1',
        [victimId],
      );
      expect(visible?.count).toBe(1);
      const before = await readUser(victimId);

      const read = await handleGetRecords(
        unscoped,
        { pointers: [{ table: 'users', id: victimId }] },
        as(attackerId),
      );
      expect(read.status).toBe(200);
      expect(read.body).toEqual({ recordMap: { users: {} } });

      const written = await handleWrite(
        unscoped,
        write(attackerId, victimId, 'phone', 'defaced'),
        as(attackerId),
      );
      expect(written.status).toBe(400);
      expect(await readUser(victimId)).toEqual(before);
    });

    it.each([
      ['role', 'admin'],
      ['email', 'takeover@evil.test'],
      ['token_version', 0],
      ['email_verified', true],
      ['locked_until', null],
      ['totp_enabled', false],
      ['password_hash', 'x'],
      ['version', 999],
    ])('cannot write %s on the caller own row', async (key, value) => {
      const before = await readUser(attackerId);

      const result = await handleWrite(
        ctxFor(attackerId),
        write(attackerId, attackerId, key, value),
        as(attackerId),
      );

      expect(result.status).toBe(403);
      expect(await readUser(attackerId)).toEqual(before);
    });

    it('writes an allowlisted field on the caller own row and returns only allowlisted columns', async () => {
      const before = await readUser(attackerId);

      const result = await handleWrite(
        ctxFor(attackerId),
        write(attackerId, attackerId, 'phone', 'hello'),
        as(attackerId),
      );

      expect(result.status).toBe(200);
      const after = await readUser(attackerId);
      expect(after).toEqual({ ...before, phone: 'hello', version: before.version + 1 });
      const record = (result.body as { recordMap: Record<string, Record<string, object>> })
        .recordMap['users']?.[attackerId];
      expect(record).toEqual({ id: attackerId, version: before.version + 1, phone: 'hello' });
      expectNoSecrets(result.body);
    });

    it('binds a value shaped like a SQL fragment instead of executing it', async () => {
      const before = await readUser(attackerId);
      const injection = { text: "'pwned', role = 'admin'", values: [] };

      const result = await handleWrite(
        ctxFor(attackerId),
        write(attackerId, attackerId, 'phone', injection),
        as(attackerId),
      );

      expect(result.status).toBe(200);
      const after = await readUser(attackerId);
      expect(after.role).toBe('user');
      expect(after.role).toBe(before.role);
      expect(after.phone).not.toBe('pwned');
      expect(after.phone).toContain("'pwned', role = 'admin'");
    });
  });
});
