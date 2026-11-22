// main/kernel/realtime/src/service.test.ts
/**
 * Realtime Service Unit Tests
 *
 * The realtime record API is a generic read/write proxy onto database tables,
 * so this service is the whole of its authorization. Risks covered here:
 *
 * 1. A table reachable without anyone registering it (the `users` default).
 * 2. A read returning columns nobody allowlisted (password hashes, TOTP secrets).
 * 3. A row loaded or updated without the caller-ownership predicate.
 * 4. A write persisting a field outside the writable allowlist.
 * 5. A client value that the SQL builder would inline as raw SQL.
 *
 * Pure operation logic tests are in ./operations.test.ts.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
  isFieldWritable,
  isTableAllowed,
  loadRecords,
  registerRealtimeTable,
  resolveTableName,
  saveRecords,
} from './service';

import type { RealtimeTablePolicy } from './types';

// ============================================================================
// Fixtures
// ============================================================================

interface MockDbClient {
  query: ReturnType<typeof vi.fn>;
  queryOne: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  raw: ReturnType<typeof vi.fn>;
}

interface CapturedQuery {
  text: string;
  values: unknown[];
}

function createMockDb(): MockDbClient {
  return {
    query: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn().mockResolvedValue(null),
    execute: vi.fn().mockResolvedValue(0),
    raw: vi.fn().mockResolvedValue([]),
  };
}

function capturedQuery(db: MockDbClient, call = 0): CapturedQuery {
  return db.query.mock.calls[call]?.[0] as CapturedQuery;
}

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const NOTE_1 = '33333333-3333-4333-8333-333333333333';
const NOTE_2 = '44444444-4444-4444-8444-444444444444';

const NOTES_POLICY: RealtimeTablePolicy = {
  tableName: 'notes',
  readableColumns: ['id', 'version', 'owner_id', 'title', 'prefs'],
  writableFields: ['title', 'prefs'],
  ownerColumn: 'owner_id',
};

registerRealtimeTable('notes', NOTES_POLICY);

function validPolicy(overrides: Partial<RealtimeTablePolicy> = {}): RealtimeTablePolicy {
  return { ...NOTES_POLICY, tableName: 'scratch', ...overrides };
}

// ============================================================================
// Tests
// ============================================================================

describe('Realtime Service', () => {
  let db: MockDbClient;

  beforeEach(() => {
    db = createMockDb();
  });

  describe('default registry', () => {
    test('registers no tables, so the users table is unreachable', () => {
      expect(isTableAllowed('users')).toBe(false);
      expect(resolveTableName('users')).toBeUndefined();
      expect(isFieldWritable('users', 'role')).toBe(false);
    });

    test('refuses to load an unregistered table without touching the database', async () => {
      await expect(
        loadRecords(db as never, [{ table: 'users', id: USER_B }], USER_A),
      ).rejects.toThrow("Table 'users' is not allowed for realtime operations");
      expect(db.query).not.toHaveBeenCalled();
    });

    test('rejects tables that look like prototype keys', () => {
      expect(isTableAllowed('__proto__')).toBe(false);
      expect(isTableAllowed('constructor')).toBe(false);
      expect(isTableAllowed('toString')).toBe(false);
    });
  });

  describe('registerRealtimeTable', () => {
    test('admits a registered table and resolves its database name', () => {
      expect(isTableAllowed('notes')).toBe(true);
      expect(resolveTableName('notes')).toBe('notes');
    });

    test('refuses a writable field that is not readable', () => {
      expect(() => {
        registerRealtimeTable('t_hidden', validPolicy({ writableFields: ['role'] }));
      }).toThrow(/writable field 'role' must be readable/);
      expect(isTableAllowed('t_hidden')).toBe(false);
    });

    test.each(['id', 'version', 'created_at', 'updated_at', 'password_hash'])(
      'refuses protected column %s as writable',
      (column) => {
        expect(() => {
          registerRealtimeTable(
            `t_protected_${column}`,
            validPolicy({
              readableColumns: ['id', 'version', 'owner_id', column],
              writableFields: [column],
            }),
          );
        }).toThrow(/is protected/);
      },
    );

    test('refuses a writable owner column, which would hand rows to other users', () => {
      expect(() => {
        registerRealtimeTable('t_owner', validPolicy({ writableFields: ['owner_id'] }));
      }).toThrow(/owner column/);
    });

    test('refuses a policy whose readable columns omit id or version', () => {
      expect(() => {
        registerRealtimeTable('t_noid', validPolicy({ readableColumns: ['version', 'title'] }));
      }).toThrow(/must include 'id'/);
      expect(() => {
        registerRealtimeTable('t_nover', validPolicy({ readableColumns: ['id', 'title'] }));
      }).toThrow(/must include 'version'/);
    });

    test.each([
      ['table', '__proto__', validPolicy()],
      ['table', 'users; drop table users', validPolicy()],
      ['tableName', 't_bad_name', validPolicy({ tableName: 'notes"; --' })],
      ['column', 't_bad_col', validPolicy({ readableColumns: ['id', 'version', 'a b'] })],
      ['owner', 't_bad_owner', validPolicy({ ownerColumn: '' })],
    ])('refuses an unsafe %s identifier (%s)', (_kind, table, policy) => {
      expect(() => {
        registerRealtimeTable(table, policy);
      }).toThrow(/Invalid/);
      expect(isTableAllowed(table)).toBe(false);
    });

    test('refuses to silently replace an existing policy', () => {
      expect(() => {
        registerRealtimeTable('notes', {
          ...NOTES_POLICY,
          readableColumns: [...NOTES_POLICY.readableColumns, 'role'],
          writableFields: ['title', 'role'],
        });
      }).toThrow(/already registered/);
      expect(isFieldWritable('notes', 'role')).toBe(false);
    });

    test('is not widened by mutating the arrays after registration', () => {
      const readable = ['id', 'version', 'owner_id', 'title'];
      const writable = ['title'];
      registerRealtimeTable(
        't_frozen',
        validPolicy({ readableColumns: readable, writableFields: writable }),
      );

      readable.push('role');
      writable.push('role');

      expect(isFieldWritable('t_frozen', 'role')).toBe(false);
    });
  });

  describe('isFieldWritable', () => {
    test('allows an allowlisted field and paths nested under it', () => {
      expect(isFieldWritable('notes', 'title')).toBe(true);
      expect(isFieldWritable('notes', 'prefs.theme.color')).toBe(true);
    });

    test.each([
      'role',
      'email',
      'password_hash',
      'owner_id',
      'id',
      'version',
      '',
      '.title',
      'titles',
      '__proto__',
    ])('refuses %j', (key) => {
      expect(isFieldWritable('notes', key)).toBe(false);
    });
  });

  describe('loadRecords', () => {
    test('returns an empty map for empty pointers without a query', async () => {
      const result = await loadRecords(db as never, [], USER_A);

      expect(result).toEqual({});
      expect(db.query).not.toHaveBeenCalled();
    });

    test('refuses to load without a caller identity', async () => {
      await expect(loadRecords(db as never, [{ table: 'notes', id: NOTE_1 }], '')).rejects.toThrow(
        /user id/,
      );
      expect(db.query).not.toHaveBeenCalled();
    });

    test('selects only readable columns and scopes rows to the caller', async () => {
      await loadRecords(
        db as never,
        [
          { table: 'notes', id: NOTE_1 },
          { table: 'notes', id: NOTE_2 },
        ],
        USER_A,
      );

      const query = capturedQuery(db);
      expect(query.text).toBe(
        'SELECT id, version, owner_id, title, prefs FROM notes WHERE (id IN ($1, $2) AND owner_id = $3)',
      );
      expect(query.values).toEqual([NOTE_1, NOTE_2, USER_A]);
    });

    test('strips any column the database returns outside the allowlist', async () => {
      db.query.mockResolvedValue([
        {
          id: NOTE_1,
          version: 3,
          owner_id: USER_A,
          title: 'mine',
          prefs: null,
          password_hash: '$argon2id$secret',
          totp_secret: 'JBSWY3DPEHPK3PXP',
          role: 'admin',
        },
      ]);

      const result = await loadRecords(db as never, [{ table: 'notes', id: NOTE_1 }], USER_A);

      expect(result['notes']?.[NOTE_1]).toEqual({
        id: NOTE_1,
        version: 3,
        owner_id: USER_A,
        title: 'mine',
        prefs: null,
      });
    });

    test('deduplicates repeated pointers into one bound id', async () => {
      await loadRecords(
        db as never,
        [
          { table: 'notes', id: NOTE_1 },
          { table: 'notes', id: NOTE_1 },
          { table: 'notes', id: NOTE_1 },
        ],
        USER_A,
      );

      expect(db.query).toHaveBeenCalledTimes(1);
      expect(capturedQuery(db).values.filter((v) => v === NOTE_1)).toHaveLength(1);
    });

    test('rejects the whole batch if any pointer names an unregistered table', async () => {
      await expect(
        loadRecords(
          db as never,
          [
            { table: 'notes', id: NOTE_1 },
            { table: 'users', id: USER_B },
          ],
          USER_A,
        ),
      ).rejects.toThrow("Table 'users' is not allowed");
      expect(db.query).not.toHaveBeenCalled();
    });
  });

  describe('saveRecords', () => {
    const original = { id: NOTE_1, version: 1, owner_id: USER_A, title: 'old', prefs: null };

    test('writes only allowlisted fields and scopes the update to caller and version', async () => {
      db.query.mockResolvedValue([{ id: NOTE_1 }]);
      const tampered = {
        ...original,
        version: 2,
        title: 'new',
        owner_id: USER_B,
        role: 'admin',
      };

      await saveRecords(
        db as never,
        { notes: { [NOTE_1]: tampered } },
        { notes: { [NOTE_1]: original } },
        USER_A,
      );

      const query = capturedQuery(db);
      expect(query.text).toMatch(
        /^UPDATE notes SET title = \$1, prefs = \$2, version = \$3, updated_at = \$4 WHERE \(id = \$5 AND version = \$6 AND owner_id = \$7\) RETURNING id$/,
      );
      expect(query.values.slice(0, 3)).toEqual(['new', null, 2]);
      expect(query.values.slice(4)).toEqual([NOTE_1, 1, USER_A]);
      expect(query.values).not.toContain('admin');
      expect(query.values).not.toContain(USER_B);
    });

    test('binds a value shaped like a SQL fragment instead of inlining it', async () => {
      db.query.mockResolvedValue([{ id: NOTE_1 }]);
      const injection = { text: "'pwned', role = 'admin'", values: [] };

      await saveRecords(
        db as never,
        { notes: { [NOTE_1]: { ...original, version: 2, title: injection } } },
        { notes: { [NOTE_1]: original } },
        USER_A,
      );

      const query = capturedQuery(db);
      expect(query.text).not.toContain('pwned');
      expect(query.text).not.toContain('role');
      expect(query.values[0]).toBe(injection);
    });

    test('refuses to create a record that was never loaded', async () => {
      await expect(
        saveRecords(
          db as never,
          { notes: { [NOTE_2]: { id: NOTE_2, version: 1, owner_id: USER_A, title: 'x' } } },
          { notes: {} },
          USER_A,
        ),
      ).rejects.toThrow(/cannot create/);
      expect(db.query).not.toHaveBeenCalled();
      expect(db.execute).not.toHaveBeenCalled();
    });

    test('refuses to save an unregistered table', async () => {
      await expect(
        saveRecords(
          db as never,
          { users: { [USER_B]: { id: USER_B, version: 2, role: 'admin' } } },
          { users: { [USER_B]: { id: USER_B, version: 1, role: 'user' } } },
          USER_A,
        ),
      ).rejects.toThrow("Table 'users' is not allowed");
      expect(db.query).not.toHaveBeenCalled();
    });

    test('reports a concurrent modification when no owned row matched the version', async () => {
      db.query.mockResolvedValue([]);

      await expect(
        saveRecords(
          db as never,
          { notes: { [NOTE_1]: { ...original, version: 2, title: 'new' } } },
          { notes: { [NOTE_1]: original } },
          USER_A,
        ),
      ).rejects.toThrow(`Concurrent modification detected for notes:${NOTE_1}`);
    });

    test('skips records whose version did not advance', async () => {
      await saveRecords(
        db as never,
        { notes: { [NOTE_1]: original } },
        { notes: { [NOTE_1]: original } },
        USER_A,
      );

      expect(db.query).not.toHaveBeenCalled();
    });
  });
});
