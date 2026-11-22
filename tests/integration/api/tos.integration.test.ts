// tests/integration/api/tos.integration.test.ts
/**
 * ToS API Integration Tests
 *
 * Tests the Terms of Service endpoints (`@bslt/compliance/server`) through
 * `fastify.inject()`, verifying routing, auth guards, schema validation,
 * method enforcement, and version gating.
 */

import { complianceServer } from '@bslt/compliance/server';
import { identityModule } from '@bslt/identity/module';
import { createAuthGuard } from '@bslt/identity/server';
import { implementServer, registerServerModules } from '@bslt/server-system/module';
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

const TOS_DOC_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '11111111-1111-4111-8111-111111111111';

interface MockState {
  latestTos: {
    id: string;
    type: string;
    title: string;
    content: string;
    version: number;
    effective_at: Date;
    created_at: Date;
  } | null;
  acceptedDocIds: Set<string>;
}

function createMockComplianceDb(state: MockState) {
  const mockTx = {
    query: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn(async (sql: { text: string; values: unknown[] }) => {
      if (sql.text.includes('compliance_legal_documents') && sql.text.includes('ORDER BY')) {
        return Promise.resolve(state.latestTos);
      }
      if (sql.text.includes('compliance_legal_documents')) {
        const id = sql.values[0];
        return Promise.resolve(
          state.latestTos !== null && state.latestTos.id === id ? state.latestTos : null,
        );
      }
      if (sql.text.includes('compliance_consents')) {
        const docId = String(sql.values[2] ?? '');
        return Promise.resolve(
          state.acceptedDocIds.has(docId)
            ? {
                id: '33333333-3333-4333-8333-333333333333',
                user_id: USER_ID,
                record_type: 'legal_document',
                document_id: docId,
                consent_type: null,
                granted: null,
                ip_address: null,
                user_agent: null,
                metadata: {},
                created_at: new Date('2026-11-20T00:00:00.000Z'),
              }
            : null,
        );
      }
      return Promise.resolve(null);
    }),
    execute: vi.fn().mockResolvedValue(0),
    raw: vi.fn(async (text: string, values?: unknown[]) => {
      if (text.includes('INSERT INTO compliance_consents')) {
        const docId = String(values?.[1] ?? '');
        state.acceptedDocIds.add(docId);
        return Promise.resolve([
          {
            id: '44444444-4444-4444-8444-444444444444',
            user_id: String(values?.[0] ?? USER_ID),
            record_type: 'legal_document',
            document_id: docId,
            consent_type: null,
            granted: null,
            ip_address: values?.[2] ?? null,
            user_agent: values?.[3] ?? null,
            metadata: {},
            created_at: new Date('2026-11-20T00:00:00.000Z'),
          },
        ]);
      }
      return Promise.resolve([]);
    }),
    transaction: vi.fn(),
    withSession: () => mockTx,
    healthCheck: vi.fn().mockResolvedValue(true),
    close: vi.fn().mockResolvedValue(undefined),
    getClient: vi.fn(),
  };
  mockTx.transaction.mockImplementation(async (cb: (tx: typeof mockTx) => Promise<unknown>) =>
    cb(mockTx),
  );
  return mockTx;
}

describe('ToS API Integration Tests', () => {
  let testServer: TestServer;
  let mockDb: ReturnType<typeof createMockComplianceDb>;
  const state: MockState = { latestTos: null, acceptedDocIds: new Set() };
  const mockUsersRepo = {
    findById: vi.fn().mockResolvedValue({
      id: USER_ID,
      lockedUntil: null,
      lockReason: null,
    }),
  };

  beforeAll(async () => {
    testServer = await buildTestServer();
    mockDb = createMockComplianceDb(state);
    const mockLogger = createMockLogger();

    const identityStub = implementServer(identityModule, {
      create: () => ({}),
      handlers: {} as never,
      jobs: {} as never,
    });

    const ctx = {
      db: mockDb,
      repos: { users: mockUsersRepo },
      log: mockLogger,
      config: testServer.config,
    };

    registerServerModules(
      testServer.server as never,
      ctx as never,
      [identityStub, complianceServer],
      {
        resolveDb: () => mockDb as unknown as DbClient,
        validateResponses: true,
        kernel: {
          db: {
            system: (fn) => (mockDb as unknown as DbClient).transaction(fn),
            viewer: (_v, fn) => (mockDb as unknown as DbClient).transaction(fn),
          },
          jobs: { enqueue: vi.fn().mockResolvedValue('job-1') },
          events: { publish: vi.fn().mockResolvedValue(undefined) },
          log: mockLogger,
          clock: { now: () => new Date('2026-11-20T00:00:00.000Z') },
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
    state.latestTos = null;
    state.acceptedDocIds.clear();
    mockUsersRepo.findById.mockResolvedValue({
      id: USER_ID,
      lockedUntil: null,
      lockReason: null,
    });
  });

  describe('auth guards', () => {
    it('GET /api/auth/tos/status returns 401 without token', async () => {
      const response = await testServer.inject({
        method: 'GET',
        url: '/api/auth/tos/status',
      });
      expect(response.statusCode).toBe(401);
      const body = parseJsonResponse(response) as { message: string };
      expect(body.message).toBe('Unauthorized');
    });

    it('POST /api/auth/tos/accept returns 401 without token', async () => {
      const response = await testServer.inject({
        method: 'POST',
        url: '/api/auth/tos/accept',
        payload: { documentId: TOS_DOC_ID },
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('schema validation', () => {
    it('POST /api/auth/tos/accept with empty body returns 400 or 401', async () => {
      const response = await testServer.inject({
        method: 'POST',
        url: '/api/auth/tos/accept',
        payload: {},
      });
      expect([400, 401]).toContain(response.statusCode);
    });

    it('POST /api/auth/tos/accept with authenticated empty body returns 400', async () => {
      const userJwt = createTestJwt({ userId: USER_ID });
      const response = await testServer.inject(
        buildAuthenticatedRequest({
          method: 'POST',
          url: '/api/auth/tos/accept',
          accessToken: userJwt,
          payload: {},
        }),
      );
      expect(response.statusCode).toBe(400);
    });
  });

  describe('method enforcement', () => {
    it('POST /api/auth/tos/status returns 404 (only GET)', async () => {
      const response = await testServer.inject({
        method: 'POST',
        url: '/api/auth/tos/status',
        payload: {},
      });
      expect(response.statusCode).toBe(404);
    });

    it('GET /api/auth/tos/accept returns 404 (only POST)', async () => {
      const response = await testServer.inject({
        method: 'GET',
        url: '/api/auth/tos/accept',
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('ToS version gating', () => {
    it('GET /api/auth/tos/status with valid token returns ToS status', async () => {
      const userJwt = createTestJwt({ userId: USER_ID });
      state.latestTos = {
        id: TOS_DOC_ID,
        type: 'terms_of_service',
        title: 'Terms v2',
        content: 'New terms...',
        version: 2,
        effective_at: new Date('2026-11-20T00:00:00.000Z'),
        created_at: new Date('2026-11-20T00:00:00.000Z'),
      };
      state.acceptedDocIds.add(TOS_DOC_ID);

      const response = await testServer.inject(
        buildAuthenticatedRequest({
          method: 'GET',
          url: '/api/auth/tos/status',
          accessToken: userJwt,
        }),
      );

      expect(response.statusCode).toBe(200);
      expect(parseJsonResponse(response)).toEqual({
        accepted: true,
        requiredVersion: 2,
        documentId: TOS_DOC_ID,
      });
    });

    it('POST /api/auth/tos/accept with unknown documentId returns 404', async () => {
      const userJwt = createTestJwt({ userId: USER_ID });
      const response = await testServer.inject(
        buildAuthenticatedRequest({
          method: 'POST',
          url: '/api/auth/tos/accept',
          accessToken: userJwt,
          payload: { documentId: TOS_DOC_ID },
        }),
      );
      expect(response.statusCode).toBe(404);
    });

    it('POST /api/auth/tos/accept with valid documentId records agreement', async () => {
      const userJwt = createTestJwt({ userId: USER_ID });
      state.latestTos = {
        id: TOS_DOC_ID,
        type: 'terms_of_service',
        title: 'Terms v2',
        content: 'New terms...',
        version: 2,
        effective_at: new Date('2026-11-20T00:00:00.000Z'),
        created_at: new Date('2026-11-20T00:00:00.000Z'),
      };

      const response = await testServer.inject(
        buildAuthenticatedRequest({
          method: 'POST',
          url: '/api/auth/tos/accept',
          accessToken: userJwt,
          payload: { documentId: TOS_DOC_ID },
        }),
      );

      expect(response.statusCode).toBe(200);
      const body = parseJsonResponse(response) as { agreedAt: string };
      expect(typeof body.agreedAt).toBe('string');
      expect(state.acceptedDocIds.has(TOS_DOC_ID)).toBe(true);
    });

    it('user with old ToS version gets blocked status', async () => {
      const userJwt = createTestJwt({ userId: USER_ID });
      state.latestTos = {
        id: TOS_DOC_ID,
        type: 'terms_of_service',
        title: 'Terms v2',
        content: 'Updated terms...',
        version: 2,
        effective_at: new Date('2026-11-20T00:00:00.000Z'),
        created_at: new Date('2026-11-20T00:00:00.000Z'),
      };

      const response = await testServer.inject(
        buildAuthenticatedRequest({
          method: 'GET',
          url: '/api/auth/tos/status',
          accessToken: userJwt,
        }),
      );

      expect(response.statusCode).toBe(200);
      expect(parseJsonResponse(response)).toEqual({
        accepted: false,
        requiredVersion: 2,
        documentId: TOS_DOC_ID,
      });
    });
  });
});
