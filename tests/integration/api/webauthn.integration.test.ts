// tests/integration/api/webauthn.integration.test.ts
/**
 * WebAuthn Integration Tests
 *
 * Tests the `@bslt/identity/server` WebAuthn/Passkey API routes through `fastify.inject()`,
 * verifying route existence, auth guards, method enforcement, and schema validation.
 */

import { defineModule } from '@bslt/contract';
import { createAuthGuard, identityServer } from '@bslt/identity/server';
import {
  implementServer,
  registerServerModules,
  type AnyServerModule,
} from '@bslt/server-system/module';
import {
  buildTestServer,
  createMockLogger,
  createTestConfig,
  parseJsonResponse,
  type TestServer,
} from '@bslt/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbClient } from '@bslt/db';

function createMockDbClient() {
  const db = {
    query: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn().mockResolvedValue(null),
    execute: vi.fn().mockResolvedValue(0),
    raw: vi.fn().mockResolvedValue([]),
    transaction: vi.fn(),
    withSession: () => db,
  };
  db.transaction.mockImplementation(async (cb: (tx: typeof db) => Promise<unknown>) => cb(db));
  return db;
}

describe('WebAuthn API Integration Tests', () => {
  let testServer: TestServer;
  let mockDb: ReturnType<typeof createMockDbClient>;

  beforeAll(async () => {
    const baseConfig = createTestConfig();

    testServer = await buildTestServer({
      config: {
        auth: {
          ...baseConfig.auth,
          strategies: ['local', 'webauthn'],
          webauthn: {
            rpName: 'Test App',
            rpId: 'localhost',
            origin: 'http://localhost:5173',
          },
        },
      },
    });

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
          AUTH_STRATEGIES: 'local,webauthn',
          WEBAUTHN_RP_NAME: 'Test App',
          WEBAUTHN_RP_ID: 'localhost',
          WEBAUTHN_ORIGIN: 'http://localhost:5173',
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
    mockDb.query.mockReset().mockResolvedValue([]);
    mockDb.queryOne.mockReset().mockResolvedValue(null);
    mockDb.execute.mockReset().mockResolvedValue(0);
    mockDb.raw.mockReset().mockResolvedValue([]);
    mockDb.transaction
      .mockReset()
      .mockImplementation(async (cb: (tx: typeof mockDb) => Promise<unknown>) => cb(mockDb));
  });

  describe('auth guards', () => {
    it('POST /api/auth/webauthn/register/options returns 401 without token', async () => {
      const response = await testServer.inject({
        method: 'POST',
        url: '/api/auth/webauthn/register/options',
      });
      expect(response.statusCode).toBe(401);
      const body = parseJsonResponse(response) as { message: string };
      expect(body.message).toBe('Unauthorized');
    });

    it('POST /api/auth/webauthn/register/verify returns 401 without token', async () => {
      const response = await testServer.inject({
        method: 'POST',
        url: '/api/auth/webauthn/register/verify',
        payload: { credential: {}, name: 'Test' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('GET /api/users/me/passkeys returns 401 without token', async () => {
      const response = await testServer.inject({
        method: 'GET',
        url: '/api/users/me/passkeys',
      });
      expect(response.statusCode).toBe(401);
    });

    it('PATCH /api/users/me/passkeys/pk-1 returns 401 without token', async () => {
      const response = await testServer.inject({
        method: 'PATCH',
        url: '/api/users/me/passkeys/pk-1',
        payload: { name: 'New Name' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('DELETE /api/users/me/passkeys/pk-1/delete returns 401 without token', async () => {
      const response = await testServer.inject({
        method: 'DELETE',
        url: '/api/users/me/passkeys/pk-1/delete',
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('public routes', () => {
    it('POST /api/auth/webauthn/login/options returns 200 with options', async () => {
      const response = await testServer.inject({
        method: 'POST',
        url: '/api/auth/webauthn/login/options',
        payload: {},
      });
      expect(response.statusCode).toBe(200);
      const body = parseJsonResponse(response) as { options?: Record<string, unknown> };
      expect(body.options).toBeDefined();
    });

    it('POST /api/auth/webauthn/login/verify returns error for invalid credential', async () => {
      const response = await testServer.inject({
        method: 'POST',
        url: '/api/auth/webauthn/login/verify',
        payload: {
          credential: { id: 'fake-id' },
          sessionKey: 'invalid-session-key',
        },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('method enforcement', () => {
    it('GET /api/auth/webauthn/register/options returns 404 (only POST)', async () => {
      const response = await testServer.inject({
        method: 'GET',
        url: '/api/auth/webauthn/register/options',
      });
      expect(response.statusCode).toBe(404);
    });

    it('GET /api/auth/webauthn/login/options returns 404 (only POST)', async () => {
      const response = await testServer.inject({
        method: 'GET',
        url: '/api/auth/webauthn/login/options',
      });
      expect(response.statusCode).toBe(404);
    });

    it('POST /api/users/me/passkeys returns 404 (only GET)', async () => {
      const response = await testServer.inject({
        method: 'POST',
        url: '/api/users/me/passkeys',
        payload: {},
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('schema validation', () => {
    it('PATCH /api/users/me/passkeys/:id returns 401 without auth', async () => {
      const response = await testServer.inject({
        method: 'PATCH',
        url: '/api/users/me/passkeys/pk-1',
        payload: {},
      });
      expect([400, 401, 422]).toContain(response.statusCode);
    });
  });

  describe('response format', () => {
    it('auth error responses include message field', async () => {
      const response = await testServer.inject({
        method: 'POST',
        url: '/api/auth/webauthn/register/options',
      });
      expect(response.statusCode).toBe(401);
      const body = parseJsonResponse(response) as Record<string, unknown>;
      expect(body).toHaveProperty('message');
      expect(typeof body['message']).toBe('string');
    });
  });
});
