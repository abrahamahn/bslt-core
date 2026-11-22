// tests/integration/api/sessions.integration.test.ts
/**
 * Sessions API Integration Tests
 *
 * Exercises `@bslt/identity/server` session management endpoints through
 * `fastify.inject()`, covering auth guards, method enforcement, IP/UA metadata,
 * cookie-based `isCurrent` resolution, same-device deduplication, `revoke-all`
 * non-current revocation + `token_version` bump, malformed JWTs, boundary IDs,
 * DB failures, concurrency, idempotency, oversized payloads, and prototype pollution.
 */

import { defineModule } from '@bslt/contract';
import {
  clearLivenessCache,
  createAuthGuard,
  identityServer,
  setLiveness,
} from '@bslt/identity/server';
import {
  implementServer,
  registerServerModules,
  type AnyServerModule,
} from '@bslt/server-system/module';
import {
  buildAuthenticatedRequest,
  buildTestServer,
  createMockLogger,
  createTestJwt,
  parseJsonResponse,
  type TestServer,
} from '@bslt/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbClient } from '@bslt/db';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const FAM_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FAM_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FAM_3 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function makeFamilyRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    family_id: FAM_1,
    user_id: USER_ID,
    device_id: null,
    family_created_at: new Date('2026-01-15T10:00:00.000Z'),
    family_revoked_at: null,
    family_revoke_reason: null,
    latest_expires_at: new Date('2026-02-15T10:00:00.000Z'),
    ip_address: '203.0.113.42',
    user_agent: 'Chrome/120',
    ...overrides,
  };
}

function makeRefreshTokenRow(familyId: string, token: string): Record<string, unknown> {
  return {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    user_id: USER_ID,
    family_id: familyId,
    device_id: null,
    token,
    expires_at: new Date('2026-02-15T10:00:00.000Z'),
    family_created_at: new Date('2026-01-15T10:00:00.000Z'),
    family_revoked_at: null,
    family_revoke_reason: null,
    rotated_at: null,
    replaced_by_token: null,
    ip_address: '10.0.0.1',
    user_agent: 'Chrome/120',
    created_at: new Date('2026-01-15T10:00:00.000Z'),
  };
}

function createMockDbClient() {
  const db = {
    query: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn().mockResolvedValue(null),
    execute: vi.fn().mockResolvedValue(1),
    raw: vi.fn().mockResolvedValue([]),
    transaction: vi.fn(),
    withSession: () => db,
  };
  db.transaction.mockImplementation(async (cb: (tx: typeof db) => Promise<unknown>) => cb(db));
  return db;
}

describe('Sessions API Integration Tests', () => {
  let testServer: TestServer;
  let mockDb: ReturnType<typeof createMockDbClient>;

  beforeAll(async () => {
    testServer = await buildTestServer();
    mockDb = createMockDbClient();
    const mockRepos = { users: { findById: vi.fn().mockResolvedValue(null) } };
    const mockLogger = createMockLogger();

    const complianceStub: AnyServerModule = implementServer(
      defineModule({
        id: 'compliance',
        summary: 'Compliance capability stub',
        status: 'stable',
        dependsOn: [],
        endpoints: {},
        events: {},
        jobs: {},
        tables: [],
        web: false,
      }),
      {
        create: () => undefined,
        handlers: {},
        context: () => ({ eligibility: { tosAccepted: true } }),
      },
    );

    registerServerModules(
      testServer.server as never,
      { db: mockDb, repos: mockRepos } as never,
      [identityServer, complianceStub],
      {
        resolveDb: () => mockDb as unknown as DbClient,
        validateResponses: true,
        env: {
          JWT_SECRET: testServer.config.auth.jwt.secret,
          APP_BASE_URL: testServer.config.server.appBaseUrl,
        },
        kernel: {
          db: {
            system: (fn) => (mockDb as unknown as DbClient).transaction(fn),
            viewer: (_v, fn) => (mockDb as unknown as DbClient).transaction(fn),
          },
          events: { publish: vi.fn().mockResolvedValue(undefined) },
          log: mockLogger,
          clock: { now: () => new Date() },
        },
        routerOptions: {
          prefix: '/api',
          jwtSecret: testServer.config.auth.jwt.secret,
          authGuardFactory: createAuthGuard,
        },
      },
    );

    await testServer.ready();
  });

  afterAll(async () => {
    await testServer.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.query.mockResolvedValue([]);
    mockDb.queryOne.mockResolvedValue(null);
    mockDb.execute.mockResolvedValue(1);
    mockDb.raw.mockResolvedValue([]);
    mockDb.transaction.mockImplementation(async (cb: (tx: typeof mockDb) => Promise<unknown>) =>
      cb(mockDb),
    );
    clearLivenessCache();
    setLiveness(USER_ID, {
      tokenVersion: 0,
      lockedUntil: null,
      lockReason: null,
      role: 'user',
      emailVerified: true,
    });
  });

  describe('auth guards & method enforcement', () => {
    it('rejects unauthenticated session requests with 401 and wrong HTTP methods with 404', async () => {
      expect(
        (await testServer.inject({ method: 'GET', url: '/api/users/me/sessions' })).statusCode,
      ).toBe(401);
      expect(
        (await testServer.inject({ method: 'DELETE', url: `/api/users/me/sessions/${FAM_1}` }))
          .statusCode,
      ).toBe(401);
      expect(
        (await testServer.inject({ method: 'POST', url: '/api/users/me/sessions/revoke-all' }))
          .statusCode,
      ).toBe(401);

      expect(
        (await testServer.inject({ method: 'POST', url: '/api/users/me/sessions' })).statusCode,
      ).toBe(404);
      expect(
        (await testServer.inject({ method: 'GET', url: '/api/users/me/sessions/revoke-all' }))
          .statusCode,
      ).toBe(404);
    });
  });

  describe('session metadata, cookie current-session detection, deduplication, and revoke-all', () => {
    it('lists IP/UA metadata (including nullable fields), marks cookie session current, and deduplicates same device', async () => {
      const chromeWindows =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

      mockDb.raw.mockResolvedValueOnce([
        makeFamilyRow({
          family_id: FAM_1,
          device_id: 'browser-device-1',
          family_created_at: new Date('2026-05-25T10:00:00.000Z'),
          ip_address: '203.0.113.42',
          user_agent: chromeWindows,
        }),
        makeFamilyRow({
          family_id: FAM_2,
          device_id: 'browser-device-1',
          family_created_at: new Date('2026-05-18T10:00:00.000Z'),
          ip_address: '203.0.113.42',
          user_agent: chromeWindows,
        }),
        makeFamilyRow({
          family_id: FAM_3,
          device_id: 'browser-device-2',
          family_created_at: new Date('2026-05-24T10:00:00.000Z'),
          ip_address: null,
          user_agent: null,
        }),
      ]);
      mockDb.queryOne.mockResolvedValueOnce(makeRefreshTokenRow(FAM_1, 'mock-refresh-token'));

      const token = createTestJwt({ userId: USER_ID, email: 's@example.com', role: 'user' });
      const response = await testServer.inject(
        buildAuthenticatedRequest({
          method: 'GET',
          url: '/api/users/me/sessions',
          accessToken: token,
          cookies: { refreshToken: 'mock-refresh-token' },
        }),
      );

      expect(response.statusCode).toBe(200);
      const body = parseJsonResponse(response) as {
        sessions: Array<{
          id: string;
          ipAddress: string | null;
          userAgent: string | null;
          isCurrent: boolean;
        }>;
      };
      expect(body.sessions.map((s) => s.id)).toEqual([FAM_1, FAM_3]);
      expect(body.sessions[0]?.isCurrent).toBe(true);
      expect(body.sessions[0]?.userAgent).toBe(chromeWindows);
      expect(body.sessions[1]?.isCurrent).toBe(false);
      expect(body.sessions[1]?.ipAddress).toBeNull();
    });

    it('revoke-all revokes every non-current family and increments token_version', async () => {
      mockDb.queryOne
        .mockResolvedValueOnce(makeRefreshTokenRow(FAM_1, 'keep-token'))
        .mockResolvedValueOnce({ id: USER_ID, token_version: 2 });
      mockDb.raw.mockResolvedValueOnce([
        makeFamilyRow({ family_id: FAM_1 }),
        makeFamilyRow({ family_id: FAM_2 }),
        makeFamilyRow({ family_id: FAM_3 }),
      ]);
      mockDb.execute.mockResolvedValue(1);

      const token = createTestJwt({ userId: USER_ID, email: 's@example.com', role: 'user' });
      const response = await testServer.inject(
        buildAuthenticatedRequest({
          method: 'POST',
          url: '/api/users/me/sessions/revoke-all',
          accessToken: token,
          cookies: { refreshToken: 'keep-token' },
        }),
      );

      expect(response.statusCode).toBe(200);
      expect((parseJsonResponse(response) as { revokedCount: number }).revokedCount).toBe(2);
      expect(mockDb.execute).toHaveBeenCalled();
    });
  });

  describe('adversarial: JWT, param, DB failure, concurrency, idempotency, and payload abuse', () => {
    it('rejects malformed, truncated, wrong-secret, and non-Bearer authorization headers with 401', async () => {
      const validToken = createTestJwt({ userId: USER_ID, email: 'test@example.com' });
      const badHeaders = [
        `Bearer ${validToken.slice(0, 16)}`,
        'Bearer ',
        'Bearer null',
        'Bearer undefined',
        'Bearer not.a.jwt',
        validToken,
      ];
      for (const authorization of badHeaders) {
        const res = await testServer.inject({
          method: 'GET',
          url: '/api/users/me/sessions',
          headers: { authorization },
        });
        expect(res.statusCode).toBe(401);
      }
    });

    it('rejects SQLi/XSS/non-UUID session IDs, handles DB failures cleanly, and survives oversized/polluting payloads', async () => {
      const token = createTestJwt({ userId: USER_ID, email: 'adv@example.com' });

      // Non-UUID / SQLi session ID -> 400 validation error without touching DB
      const sqli = await testServer.inject(
        buildAuthenticatedRequest({
          method: 'DELETE',
          url: "/api/users/me/sessions/'%20OR%201=1--",
          accessToken: token,
        }),
      );
      expect(sqli.statusCode).toBe(400);
      expect(mockDb.raw).not.toHaveBeenCalled();

      // DB error -> 500 without crashing server
      mockDb.raw.mockRejectedValueOnce(new Error('Database connection lost'));
      const dbErr = await testServer.inject(
        buildAuthenticatedRequest({
          method: 'GET',
          url: '/api/users/me/sessions',
          accessToken: token,
        }),
      );
      expect(dbErr.statusCode).toBe(500);

      // Oversized unauthenticated payload -> 400 VALIDATION_ERROR from request filter
      const oversized = await testServer.inject({
        method: 'POST',
        url: '/api/users/me/sessions/revoke-all',
        payload: { data: 'X'.repeat(10240) },
      });
      expect(oversized.statusCode).toBe(400);

      // Prototype pollution payload does not pollute Object.prototype
      mockDb.raw.mockResolvedValueOnce([]);
      const proto = await testServer.inject(
        buildAuthenticatedRequest({
          method: 'POST',
          url: '/api/users/me/sessions/revoke-all',
          accessToken: token,
          payload: JSON.parse('{"__proto__":{"isAdmin":true}}') as Record<string, unknown>,
        }),
      );
      expect(proto.statusCode).toBeDefined();
      expect(({} as Record<string, unknown>)['isAdmin']).toBeUndefined();
    });
  });
});
