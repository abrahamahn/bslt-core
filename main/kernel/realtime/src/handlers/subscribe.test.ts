// main/kernel/realtime/src/handlers/subscribe.test.ts
/**
 * Realtime Subscribe Handler Unit Tests
 *
 * Only the database is faked; the table registry and policy run for real. The
 * fake honours the ownership predicate the service binds last and returns every
 * stored column, so a missing projection or ownership filter shows up as a
 * leaked row or column in the response.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';

import { registerRealtimeTable } from '../service';

import { handleGetRecords } from './subscribe';

import type { RealtimeModuleDeps, RealtimeRequest } from '../types';

// ============================================================================
// Fixtures
// ============================================================================

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const NOTE_A = '33333333-3333-4333-8333-333333333333';
const NOTE_B = '44444444-4444-4444-8444-444444444444';

registerRealtimeTable('notes', {
  tableName: 'notes',
  readableColumns: ['id', 'version', 'owner_id', 'title'],
  writableFields: ['title'],
  ownerColumn: 'owner_id',
});

interface CapturedQuery {
  text: string;
  values: unknown[];
}

const ROWS = [
  {
    id: NOTE_A,
    version: 1,
    owner_id: USER_A,
    title: 'a',
    password_hash: 'hash-a',
    totp_secret: 'totp-a',
  },
  {
    id: NOTE_B,
    version: 4,
    owner_id: USER_B,
    title: 'b',
    password_hash: 'hash-b',
    totp_secret: 'totp-b',
  },
];

function createFakeDb() {
  const query = vi.fn((q: CapturedQuery): Promise<unknown[]> => {
    const owner = q.values[q.values.length - 1];
    const ids = new Set(q.values.slice(0, -1));
    return Promise.resolve(
      ROWS.filter((row) => ids.has(row.id) && row.owner_id === owner).map((row) => ({ ...row })),
    );
  });
  return { query, queryOne: vi.fn(), execute: vi.fn(), raw: vi.fn() };
}

function createMockContext(db: unknown = createFakeDb()): RealtimeModuleDeps {
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

function recordMapOf(body: unknown): Record<string, Record<string, unknown>> {
  return (body as { recordMap: Record<string, Record<string, unknown>> }).recordMap;
}

// ============================================================================
// Tests
// ============================================================================

describe('Realtime Subscribe Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleGetRecords', () => {
    describe('Authentication', () => {
      test('rejects unauthenticated requests', async () => {
        const result = await handleGetRecords(
          createMockContext(),
          { pointers: [{ table: 'notes', id: NOTE_A }] },
          createMockRequest(),
        );

        expect(result.status).toBe(403);
        expect(result.body).toEqual({ code: 'FORBIDDEN', message: 'Authentication required' });
      });
    });

    describe('Table registry', () => {
      test.each(['users', 'secret_table', 'constructor'])(
        'rejects table %s, which no policy registered, before touching the database',
        async (table) => {
          const db = createFakeDb();
          const result = await handleGetRecords(
            createMockContext(db),
            { pointers: [{ table, id: USER_B }] },
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

    describe('Row ownership and column allowlist', () => {
      test('returns the caller own record with only readable columns', async () => {
        const result = await handleGetRecords(
          createMockContext(),
          { pointers: [{ table: 'notes', id: NOTE_A }] },
          createMockRequest(USER_A),
        );

        expect(result.status).toBe(200);
        expect(recordMapOf(result.body)).toEqual({
          notes: { [NOTE_A]: { id: NOTE_A, version: 1, owner_id: USER_A, title: 'a' } },
        });
      });

      test('never returns another user record, even when asked by id', async () => {
        const result = await handleGetRecords(
          createMockContext(),
          { pointers: [{ table: 'notes', id: NOTE_B }] },
          createMockRequest(USER_A),
        );

        expect(result.status).toBe(200);
        expect(recordMapOf(result.body)).toEqual({ notes: {} });
        expect(JSON.stringify(result.body)).not.toMatch(/hash-b|totp-b|"b"/);
      });

      test('filters foreign rows out of a mixed request and leaks no secret column', async () => {
        const result = await handleGetRecords(
          createMockContext(),
          {
            pointers: [
              { table: 'notes', id: NOTE_A },
              { table: 'notes', id: NOTE_B },
            ],
          },
          createMockRequest(USER_A),
        );

        expect(Object.keys(recordMapOf(result.body)['notes'] ?? {})).toEqual([NOTE_A]);
        expect(JSON.stringify(result.body)).not.toMatch(/password_hash|totp_secret|hash-|totp-/);
      });

      test('binds the authenticated user, not anything in the request body, as owner', async () => {
        const db = createFakeDb();

        await handleGetRecords(
          createMockContext(db),
          { pointers: [{ table: 'notes', id: NOTE_B }] },
          createMockRequest(USER_A),
        );

        const query = db.query.mock.calls[0]?.[0];
        expect(query?.values).toEqual([NOTE_B, USER_A]);
        expect(query?.text).toBe(
          'SELECT id, version, owner_id, title FROM notes WHERE (id IN ($1) AND owner_id = $2)',
        );
      });
    });

    describe('Logging', () => {
      test('logs the request without record contents', async () => {
        const ctx = createMockContext();

        await handleGetRecords(
          ctx,
          { pointers: [{ table: 'notes', id: NOTE_A }] },
          createMockRequest(USER_A),
        );

        expect(ctx.log.debug).toHaveBeenCalledWith(
          'GetRecords request',
          expect.objectContaining({ userId: USER_A, pointerCount: 1 }),
        );
      });
    });

    describe('Error handling', () => {
      test('returns 500 for unexpected database errors', async () => {
        const db = createFakeDb();
        db.query.mockRejectedValue(new Error('Database error'));
        const ctx = createMockContext(db);

        const result = await handleGetRecords(
          ctx,
          { pointers: [{ table: 'notes', id: NOTE_A }] },
          createMockRequest(USER_A),
        );

        expect(result.status).toBe(500);
        expect(result.body).toEqual({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
        expect(ctx.log.error).toHaveBeenCalled();
      });
    });
  });
});
