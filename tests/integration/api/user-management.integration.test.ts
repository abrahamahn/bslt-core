// tests/integration/api/user-management.integration.test.ts
/**
 * User Management API Integration Tests
 *
 * Tests `@bslt/identity/server` user endpoints through `fastify.inject()`,
 * verifying routing, auth guards, method enforcement, sudo elevation, and
 * response schema validation.
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
import { sign } from '@bslt/server-system/security';
import {
  buildTestServer,
  createMockLogger,
  createTestJwt,
  parseJsonResponse,
  type TestServer,
} from '@bslt/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbClient } from '@bslt/db';

const USER_AUTH_ID = '11111111-1111-4111-8111-111111111111';
const USER_AVATAR_ID = '22222222-2222-4222-8222-222222222222';
const USER_USERNAME_ID = '33333333-3333-4333-8333-333333333333';
const USER_SUDO_ID = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2024-01-01T00:00:00.000Z');

function makeUserRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const email = typeof overrides['email'] === 'string' ? overrides['email'] : 'test@example.com';
  return {
    id: USER_AUTH_ID,
    email,
    canonical_email: email,
    username: 'authuser',
    password_hash: 'hash',
    first_name: 'Auth',
    last_name: 'User',
    avatar_url: null,
    role: 'user',
    email_verified: true,
    email_verified_at: NOW,
    locked_until: null,
    lock_reason: null,
    failed_login_attempts: 0,
    totp_secret: null,
    totp_enabled: false,
    phone: null,
    phone_verified: null,
    date_of_birth: null,
    gender: null,
    city: null,
    state: null,
    country: null,
    bio: null,
    language: null,
    website: null,
    eligibility_attested_at: null,
    eligibility_attestation_version: null,
    last_username_change: null,
    deactivated_at: null,
    deleted_at: null,
    deletion_grace_period_ends: null,
    token_version: 0,
    created_at: NOW,
    updated_at: NOW,
    version: 1,
    ...overrides,
  };
}

function createMockRepos() {
  return {
    users: {
      findById: vi.fn().mockResolvedValue(null),
    },
  };
}

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

describe('User Management API Integration Tests', () => {
  let testServer: TestServer;
  let mockDb: ReturnType<typeof createMockDbClient>;
  let mockRepos: ReturnType<typeof createMockRepos>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeAll(async () => {
    testServer = await buildTestServer();
    mockDb = createMockDbClient();
    mockRepos = createMockRepos();
    mockLogger = createMockLogger();

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
    mockDb.transaction.mockImplementation(async (cb: (tx: typeof mockDb) => Promise<unknown>) =>
      cb(mockDb),
    );
    clearLivenessCache();
    for (const id of [
      USER_AUTH_ID,
      USER_AVATAR_ID,
      USER_USERNAME_ID,
      USER_SUDO_ID,
      'user-test-123',
    ]) {
      setLiveness(id, {
        tokenVersion: 0,
        lockedUntil: null,
        lockReason: null,
        role: 'user',
        emailVerified: true,
      });
    }
  });

  describe('GET /api/users/me', () => {
    it('returns 401 without token and 404 for POST method', async () => {
      const unauth = await testServer.inject({ method: 'GET', url: '/api/users/me' });
      expect(unauth.statusCode).toBe(401);
      expect((parseJsonResponse(unauth) as { message: string }).message).toBe('Unauthorized');

      const wrongMethod = await testServer.inject({
        method: 'POST',
        url: '/api/users/me',
        payload: {},
      });
      expect(wrongMethod.statusCode).toBe(404);
    });

    it('returns canonical raw user shape and omits avatarUrl', async () => {
      mockDb.queryOne.mockResolvedValueOnce(
        makeUserRow({
          id: USER_AVATAR_ID,
          email: 'avatar-read@example.com',
          username: 'avatarread',
          avatar_url: 'avatars/user-avatar-read/avatar.png',
        }),
      );

      const token = createTestJwt({
        userId: USER_AVATAR_ID,
        email: 'avatar-read@example.com',
        role: 'user',
      });

      const response = await testServer.inject({
        method: 'GET',
        url: '/api/users/me',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = parseJsonResponse(response) as Record<string, unknown>;
      expect(body['id']).toBe(USER_AVATAR_ID);
      expect(body['email']).toBe('avatar-read@example.com');
      expect(body['username']).toBe('avatarread');
      expect(body['createdAt']).toBe('2024-01-01T00:00:00.000Z');
      expect(body).not.toHaveProperty('avatarUrl');
      expect(body).not.toHaveProperty('ok');
      expect(body).not.toHaveProperty('data');
      expect(testServer.storage.getSignedUrl).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/users/me/profile-completeness', () => {
    it('returns 401 without token and 404 for POST method', async () => {
      expect(
        (await testServer.inject({ method: 'GET', url: '/api/users/me/profile-completeness' }))
          .statusCode,
      ).toBe(401);
      expect(
        (
          await testServer.inject({
            method: 'POST',
            url: '/api/users/me/profile-completeness',
            payload: {},
          })
        ).statusCode,
      ).toBe(404);
    });
  });

  describe('PATCH /api/users/me/username', () => {
    it('enforces auth, HTTP method, and payload validation', async () => {
      expect(
        (
          await testServer.inject({
            method: 'PATCH',
            url: '/api/users/me/username',
            payload: { username: 'newuser' },
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (await testServer.inject({ method: 'GET', url: '/api/users/me/username' })).statusCode,
      ).toBe(404);

      const token = createTestJwt({
        userId: USER_USERNAME_ID,
        email: 'username@example.com',
        role: 'user',
      });
      const invalidBody = await testServer.inject({
        method: 'PATCH',
        url: '/api/users/me/username',
        headers: { authorization: `Bearer ${token}` },
        payload: {},
      });
      expect(invalidBody.statusCode).toBe(400);
    });

    it('updates username and returns nextChangeAllowedAt', async () => {
      const existing = makeUserRow({
        id: USER_USERNAME_ID,
        email: 'username-cache@example.com',
        username: 'oldname',
        last_username_change: null,
      });
      // 1: findUserById, 2: findUserByUsername (null), 3: updateUser returning row
      mockDb.queryOne
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...existing, username: 'newname' });

      const token = createTestJwt({
        userId: USER_USERNAME_ID,
        email: 'username-cache@example.com',
        role: 'user',
      });

      const response = await testServer.inject({
        method: 'PATCH',
        url: '/api/users/me/username',
        headers: { authorization: `Bearer ${token}` },
        payload: { username: 'newname' },
      });

      expect(response.statusCode).toBe(200);
      const body = parseJsonResponse(response) as { username: string; nextChangeAllowedAt: string };
      expect(body.username).toBe('newname');
      expect(typeof body.nextChangeAllowedAt).toBe('string');
    });
  });

  describe('lifecycle endpoints & sudo enforcement', () => {
    it('enforces auth and method on deactivate, delete, and reactivate', async () => {
      for (const url of [
        '/api/users/me/deactivate',
        '/api/users/me/delete',
        '/api/users/me/reactivate',
      ]) {
        expect((await testServer.inject({ method: 'POST', url, payload: {} })).statusCode).toBe(
          401,
        );
        expect((await testServer.inject({ method: 'GET', url })).statusCode).toBe(404);
      }
    });

    describe.each([
      ['/api/users/me/deactivate', 'deactivated'],
      ['/api/users/me/delete', 'pending_deletion'],
    ] as const)('sudo enforcement for POST %s', (url, expectedStatus) => {
      function authedInject(sudoToken?: string): ReturnType<typeof testServer.inject> {
        const token = createTestJwt({ userId: USER_SUDO_ID, email: 'sudo-user@example.com' });
        return testServer.inject({
          method: 'POST',
          url,
          headers: {
            authorization: `Bearer ${token}`,
            ...(sudoToken !== undefined ? { 'x-sudo-token': sudoToken } : {}),
          },
          payload: {},
        });
      }

      it('returns 403 identity.SUDO_REQUIRED without a sudo token', async () => {
        const response = await authedInject();
        expect(response.statusCode).toBe(403);
        const body = parseJsonResponse(response) as { code?: string };
        expect(body.code).toBe('identity.SUDO_REQUIRED');
        expect(mockDb.queryOne).not.toHaveBeenCalled();
      });

      it('returns 403 identity.SUDO_EXPIRED for an invalid sudo token', async () => {
        const response = await authedInject('not-a-valid-sudo-token');
        expect(response.statusCode).toBe(403);
        const body = parseJsonResponse(response) as { code?: string };
        expect(body.code).toBe('identity.SUDO_EXPIRED');
        expect(mockDb.queryOne).not.toHaveBeenCalled();
      });

      it("returns 403 identity.SUDO_MISMATCH for another user's sudo token", async () => {
        const foreignSudo = sign(
          { userId: USER_AUTH_ID, type: 'sudo' },
          testServer.config.auth.jwt.secret,
          { expiresIn: '5m' },
        );
        const response = await authedInject(foreignSudo);
        expect(response.statusCode).toBe(403);
        const body = parseJsonResponse(response) as { code?: string };
        expect(body.code).toBe('identity.SUDO_MISMATCH');
        expect(mockDb.queryOne).not.toHaveBeenCalled();
      });

      it('succeeds with a valid sudo token', async () => {
        const active = makeUserRow({ id: USER_SUDO_ID, email: 'sudo-user@example.com' });
        mockDb.queryOne.mockResolvedValueOnce(active).mockResolvedValueOnce({
          ...active,
          deactivated_at: expectedStatus === 'deactivated' ? new Date() : null,
          deleted_at: expectedStatus === 'pending_deletion' ? new Date() : null,
          deletion_grace_period_ends:
            expectedStatus === 'pending_deletion'
              ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
              : null,
        });

        const sudoToken = sign(
          { userId: USER_SUDO_ID, type: 'sudo' },
          testServer.config.auth.jwt.secret,
          { expiresIn: '5m' },
        );
        const response = await authedInject(sudoToken);
        expect(response.statusCode).toBe(200);
        const body = parseJsonResponse(response) as { status: string };
        expect(body.status).toBe(expectedStatus);
      });
    });
  });
});
