// main/kernel/realtime/src/handlers/sync.test.ts
/**
 * Realtime Sync Handler Unit Tests
 *
 * Only the database is faked. The table registry, the policy checks and the
 * shared operation logic all run for real — the previous suite mocked the
 * service away and so never noticed that any user could write any user's row.
 *
 * The fake database honours the ownership predicate the service puts in its
 * SQL (the last bound value of a SELECT, the last of an UPDATE) and returns
 * every stored column on read, including ones no policy allowlists, so a
 * missing projection shows up as a leaked column.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@bslt/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bslt/db')>();
  return {
    ...actual,
    withTransaction: vi.fn((db: unknown, callback: (tx: unknown) => Promise<unknown>) =>
      callback(db),
    ),
  };
});

import { registerRealtimeTable } from '../service';

import { handleWrite, RecordNotFoundError, VersionConflictError } from './sync';

import type { RealtimeTransaction, RecordPointer } from '../operations';
import type { RealtimeModuleDeps, RealtimeRequest } from '../types';

// ============================================================================
// Fixtures
// ============================================================================

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const NOTE_A = '33333333-3333-4333-8333-333333333333';
const NOTE_B = '44444444-4444-4444-8444-444444444444';
const MISSING = '55555555-5555-4555-8555-555555555555';
const TX_ID = '66666666-6666-4666-8666-666666666666';

registerRealtimeTable('notes', {
  tableName: 'notes',
  readableColumns: ['id', 'version', 'owner_id', 'title', 'tags'],
  writableFields: ['title', 'tags'],
  ownerColumn: 'owner_id',
});

interface NoteRow {
  id: string;
  version: number;
  owner_id: string;
  title: string;
  tags: string[];
  secret_token: string;
  role: string;
}

interface CapturedQuery {
  text: string;
  values: unknown[];
}

function createFakeDb(rows: NoteRow[]) {
  const store = new Map(rows.map((row) => [row.id, { ...row }]));
  const hooks: { afterFirstSelect?: () => void } = {};
  const updates: CapturedQuery[] = [];
  let selects = 0;

  const query = vi.fn((q: CapturedQuery): Promise<unknown[]> => {
    if (q.text.startsWith('SELECT')) {
      selects += 1;
      const owner = q.values[q.values.length - 1];
      const ids = new Set(q.values.slice(0, -1));
      const found = [...store.values()]
        .filter((row) => ids.has(row.id) && row.owner_id === owner)
        .map((row) => ({ ...row }));
      if (selects === 1) hooks.afterFirstSelect?.();
      return Promise.resolve(found);
    }
    if (q.text.startsWith('UPDATE')) {
      updates.push(q);
      const [id, version, owner] = q.values.slice(-3);
      const row = store.get(String(id));
      if (row === undefined || row.version !== version || row.owner_id !== owner) {
        return Promise.resolve([]);
      }
      return Promise.resolve([{ id }]);
    }
    return Promise.reject(new Error(`unexpected query: ${q.text}`));
  });

  return {
    db: { query, queryOne: vi.fn(), execute: vi.fn(), raw: vi.fn() },
    store,
    hooks,
    updates,
  };
}

function note(id: string, owner: string, overrides: Partial<NoteRow> = {}): NoteRow {
  return {
    id,
    version: 1,
    owner_id: owner,
    title: `title-${id.slice(0, 4)}`,
    tags: [],
    secret_token: `secret-${id.slice(0, 4)}`,
    role: 'user',
    ...overrides,
  };
}

function createMockContext(db: unknown = {}): RealtimeModuleDeps {
  return {
    db,
    pubsub: { publish: vi.fn() },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    config: {
      env: 'test',
      auth: { cookie: { secret: 'test-secret' }, jwt: { secret: 'test-jwt-secret' } },
    },
  } as unknown as RealtimeModuleDeps;
}

function createMockRequest(userId?: string): RealtimeRequest {
  return {
    ...(userId !== undefined ? { user: { userId, email: 'test@example.com', role: 'user' } } : {}),
    cookies: {},
    headers: {},
    requestInfo: { ipAddress: '127.0.0.1', userAgent: 'test-agent' },
  } as RealtimeRequest;
}

function tx(authorId: string, operations: RealtimeTransaction['operations']): RealtimeTransaction {
  return { txId: TX_ID, authorId, clientTimestamp: Date.now(), operations };
}

function setTitle(
  id: string,
  value: unknown = 'Updated',
): RealtimeTransaction['operations'][number] {
  return { type: 'set', table: 'notes', id, key: 'title', value };
}

const flushPublish = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

// ============================================================================
// Tests
// ============================================================================

describe('Realtime Sync Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleWrite', () => {
    describe('Authentication', () => {
      test('rejects unauthenticated requests', async () => {
        const result = await handleWrite(createMockContext(), tx(USER_A, []), createMockRequest());

        expect(result.status).toBe(403);
        expect(result.body).toEqual({ code: 'FORBIDDEN', message: 'Authentication required' });
      });

      test('rejects a transaction authored as someone else', async () => {
        const ctx = createMockContext();
        const result = await handleWrite(
          ctx,
          tx(USER_B, [setTitle(NOTE_B)]),
          createMockRequest(USER_A),
        );

        expect(result.status).toBe(403);
        expect(result.body).toEqual({
          code: 'FORBIDDEN',
          message: 'Author ID must match authenticated user',
        });
        expect(ctx.log.warn).toHaveBeenCalled();
      });
    });

    describe('Table registry', () => {
      test.each(['users', 'secret_table', '__proto__'])(
        'rejects table %s, which no policy registered, before touching the database',
        async (table) => {
          const { db } = createFakeDb([]);
          const result = await handleWrite(
            createMockContext(db),
            tx(USER_A, [{ type: 'set', table, id: USER_A, key: 'role', value: 'admin' }]),
            createMockRequest(USER_A),
          );

          expect(result.status).toBe(400);
          expect(result.body).toEqual({
            code: 'BAD_REQUEST',
            message: `Table '${table}' is not allowed for realtime operations`,
          });
          expect(db.query).not.toHaveBeenCalled();
        },
      );
    });

    describe('Field allowlist', () => {
      test.each([
        'role',
        'owner_id',
        'secret_token',
        'version',
        'id',
        'password_hash',
        'role.nested',
      ])('refuses to write %s on the caller own row', async (key) => {
        const { db } = createFakeDb([note(NOTE_A, USER_A)]);
        const ctx = createMockContext(db);

        const result = await handleWrite(
          ctx,
          tx(USER_A, [{ type: 'set', table: 'notes', id: NOTE_A, key, value: 'admin' }]),
          createMockRequest(USER_A),
        );

        expect(result.status).toBe(403);
        expect(result.body).toEqual({
          code: 'FORBIDDEN',
          message: `Field '${key.split('.')[0] ?? key}' is not writable on table 'notes'`,
        });
        // Refused before any row is read, so not even a version check runs.
        expect(db.query).not.toHaveBeenCalled();
      });

      test('rejects the whole transaction when one of several operations is not writable', async () => {
        const { db, updates } = createFakeDb([note(NOTE_A, USER_A)]);

        const result = await handleWrite(
          createMockContext(db),
          tx(USER_A, [
            setTitle(NOTE_A),
            { type: 'set', table: 'notes', id: NOTE_A, key: 'owner_id', value: USER_B },
          ]),
          createMockRequest(USER_A),
        );

        expect(result.status).toBe(403);
        expect(updates).toEqual([]);
      });
    });

    describe('Row ownership', () => {
      test('treats another user row as not found and never updates it', async () => {
        const { db, updates } = createFakeDb([note(NOTE_B, USER_B)]);
        const ctx = createMockContext(db);

        const result = await handleWrite(
          ctx,
          tx(USER_A, [setTitle(NOTE_B, 'hijacked')]),
          createMockRequest(USER_A),
        );
        await flushPublish();

        expect(result.status).toBe(400);
        expect((result.body as { message: string }).message).toBe(
          `Record not found: notes:${NOTE_B}`,
        );
        expect(JSON.stringify(result.body)).not.toContain('secret-');
        expect(updates).toEqual([]);
        expect(ctx.pubsub.publish).not.toHaveBeenCalled();
      });

      test('answers a foreign row exactly like a missing one, so existence does not leak', async () => {
        const { db } = createFakeDb([note(NOTE_B, USER_B)]);
        const foreign = await handleWrite(
          createMockContext(db),
          tx(USER_A, [setTitle(NOTE_B)]),
          createMockRequest(USER_A),
        );
        const missing = await handleWrite(
          createMockContext(db),
          tx(USER_A, [setTitle(MISSING)]),
          createMockRequest(USER_A),
        );

        expect(foreign.status).toBe(missing.status);
        expect((foreign.body as { message: string }).message.replace(NOTE_B, 'X')).toBe(
          (missing.body as { message: string }).message.replace(MISSING, 'X'),
        );
      });

      test('rejects a transaction that mixes an owned row with a foreign one, writing neither', async () => {
        const { db, updates } = createFakeDb([note(NOTE_A, USER_A), note(NOTE_B, USER_B)]);

        const result = await handleWrite(
          createMockContext(db),
          tx(USER_A, [setTitle(NOTE_A), setTitle(NOTE_B)]),
          createMockRequest(USER_A),
        );

        expect(result.status).toBe(400);
        expect(updates).toEqual([]);
      });

      test('scopes every query to the authenticated user, not the client-supplied author', async () => {
        const { db } = createFakeDb([note(NOTE_A, USER_A)]);

        await handleWrite(
          createMockContext(db),
          tx(USER_A, [setTitle(NOTE_A)]),
          createMockRequest(USER_A),
        );

        const queries = db.query.mock.calls.map(([q]) => q);
        expect(queries).toHaveLength(3);
        for (const q of queries) {
          expect(q.values[q.values.length - 1]).toBe(USER_A);
          expect(q.text).toMatch(/owner_id = \$\d+\)/);
        }
      });
    });

    describe('Version conflicts', () => {
      test('returns 409 when the row moved between load and reload', async () => {
        const { db, store, hooks, updates } = createFakeDb([note(NOTE_A, USER_A)]);
        hooks.afterFirstSelect = () => {
          const row = store.get(NOTE_A);
          if (row !== undefined) row.version = 5;
        };

        const result = await handleWrite(
          createMockContext(db),
          tx(USER_A, [setTitle(NOTE_A)]),
          createMockRequest(USER_A),
        );

        expect(result.status).toBe(409);
        expect((result.body as { message: string }).message).toContain('Version conflict');
        expect(
          (result.body as { conflictingRecords?: RecordPointer[] }).conflictingRecords,
        ).toEqual([{ table: 'notes', id: NOTE_A }]);
        expect(updates).toEqual([]);
      });

      test('returns 500, not 200, when the guarded update matches no owned row', async () => {
        const { db, store, updates } = createFakeDb([note(NOTE_A, USER_A)]);
        // Ownership flips after both reads but before the UPDATE runs: the
        // UPDATE's own owner predicate is the last line of defence.
        db.query.mockImplementationOnce((q: CapturedQuery) => {
          const row = store.get(NOTE_A);
          return Promise.resolve(
            row !== undefined && q.values.includes(USER_A) ? [{ ...row }] : [],
          );
        });
        db.query.mockImplementationOnce((q: CapturedQuery) => {
          const row = store.get(NOTE_A);
          const result = row !== undefined && q.values.includes(USER_A) ? [{ ...row }] : [];
          if (row !== undefined) row.owner_id = USER_B;
          return Promise.resolve(result);
        });

        const ctx = createMockContext(db);
        const result = await handleWrite(
          ctx,
          tx(USER_A, [setTitle(NOTE_A, 'late')]),
          createMockRequest(USER_A),
        );

        expect(result.status).toBe(500);
        // The UPDATE was attempted, bound to the caller, and matched nothing.
        expect(updates).toHaveLength(1);
        expect(updates[0]?.values[updates[0].values.length - 1]).toBe(USER_A);
        expect(ctx.pubsub.publish).not.toHaveBeenCalled();
        expect(ctx.log.error).toHaveBeenCalled();
      });
    });

    describe('Success path', () => {
      test('updates the caller own row and returns only readable columns', async () => {
        const { db, updates } = createFakeDb([note(NOTE_A, USER_A)]);
        const ctx = createMockContext(db);

        const result = await handleWrite(
          ctx,
          tx(USER_A, [setTitle(NOTE_A, 'Updated')]),
          createMockRequest(USER_A),
        );

        expect(result.status).toBe(200);
        expect((result.body as { recordMap: unknown }).recordMap).toEqual({
          notes: {
            [NOTE_A]: { id: NOTE_A, version: 2, owner_id: USER_A, title: 'Updated', tags: [] },
          },
        });
        expect(JSON.stringify(result.body)).not.toContain('secret-');
        expect(updates).toHaveLength(1);
        const text = updates[0]?.text ?? '';
        const setClause = text.slice(text.indexOf(' SET '), text.indexOf(' WHERE '));
        expect(setClause).toBe(' SET title = $1, tags = $2, version = $3, updated_at = $4');
      });

      test('publishes the new version on the record key after responding', async () => {
        const { db } = createFakeDb([note(NOTE_A, USER_A)]);
        const ctx = createMockContext(db);

        await handleWrite(ctx, tx(USER_A, [setTitle(NOTE_A)]), createMockRequest(USER_A));
        await flushPublish();

        expect(ctx.pubsub.publish).toHaveBeenCalledWith(`record:notes:${NOTE_A}`, 2);
      });

      test('logs transaction start and completion', async () => {
        const { db } = createFakeDb([note(NOTE_A, USER_A)]);
        const ctx = createMockContext(db);
        const body = tx(USER_A, [setTitle(NOTE_A)]);

        await handleWrite(ctx, body, createMockRequest(USER_A));

        expect(ctx.log.debug).toHaveBeenCalledWith(
          'Write transaction started',
          expect.objectContaining({ txId: body.txId }),
        );
        expect(ctx.log.debug).toHaveBeenCalledWith(
          'Write transaction completed',
          expect.objectContaining({ txId: body.txId, modifiedCount: 1 }),
        );
      });
    });

    describe('Error handling', () => {
      test('returns 500 for unexpected database errors', async () => {
        const { db } = createFakeDb([]);
        db.query.mockRejectedValue(new Error('Database connection failed'));
        const ctx = createMockContext(db);

        const result = await handleWrite(
          ctx,
          tx(USER_A, [setTitle(NOTE_A)]),
          createMockRequest(USER_A),
        );

        expect(result.status).toBe(500);
        expect(result.body).toEqual({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
        expect(ctx.log.error).toHaveBeenCalled();
      });
    });
  });

  describe('Error Classes', () => {
    test('RecordNotFoundError includes table and id', () => {
      const error = new RecordNotFoundError('notes', NOTE_A);

      expect(error.message).toBe(`Record not found: notes:${NOTE_A}`);
      expect(error.name).toBe('RecordNotFoundError');
      expect(error.table).toBe('notes');
      expect(error.id).toBe(NOTE_A);
    });

    test('VersionConflictError includes conflicting records', () => {
      const conflicts = [
        { table: 'notes', id: NOTE_A },
        { table: 'notes', id: NOTE_B },
      ];
      const error = new VersionConflictError(conflicts);

      expect(error.message).toBe('Version conflict detected');
      expect(error.name).toBe('VersionConflictError');
      expect(error.conflictingRecords).toEqual(conflicts);
    });
  });
});
