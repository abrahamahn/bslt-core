// tests/integration/api/consent-export-legal.integration.test.ts
/**
 * Consent, Data Export & Legal Integration Tests
 *
 * Tests the consent, data-export, and legal route modules through fastify.inject(),
 * verifying routing, auth guards, and method enforcement.
 */

import { complianceServer } from '@bslt/compliance/server';
import {
  clearLivenessCache,
  createAuthGuard,
  identityServer,
  setLiveness,
} from '@bslt/identity/server';
import { registerServerModules } from '@bslt/server-system/module';
import { sign } from '@bslt/server-system/security';
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

// ============================================================================
// Mock Factories
// ============================================================================

function createMockRepos() {
  return {
    users: {
      findByEmail: vi.fn().mockResolvedValue(null),
      findByUsername: vi.fn().mockResolvedValue(null),
      findById: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'user-1', email: 'test@example.com' }),
      update: vi.fn().mockResolvedValue(null),
      existsByEmail: vi.fn().mockResolvedValue(false),
      verifyEmail: vi.fn().mockResolvedValue(undefined),
      incrementFailedAttempts: vi.fn().mockResolvedValue(undefined),
      resetFailedAttempts: vi.fn().mockResolvedValue(undefined),
      lockAccount: vi.fn().mockResolvedValue(undefined),
      unlockAccount: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(true),
      updateWithVersion: vi.fn().mockResolvedValue(null),
    },
    refreshTokens: {
      findById: vi.fn().mockResolvedValue(null),
      findByToken: vi.fn().mockResolvedValue(null),
      findByUserId: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'rt-1' }),
      delete: vi.fn().mockResolvedValue(true),
      deleteByToken: vi.fn().mockResolvedValue(true),
      deleteByUserId: vi.fn().mockResolvedValue(0),
      deleteByFamilyId: vi.fn().mockResolvedValue(0),
      deleteExpired: vi.fn().mockResolvedValue(0),
    },
    refreshTokenFamilies: {
      findById: vi.fn().mockResolvedValue(null),
      findActiveByUserId: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'family-1' }),
      revoke: vi.fn().mockResolvedValue(undefined),
      revokeAllForUser: vi.fn().mockResolvedValue(0),
    },
    loginAttempts: {
      create: vi.fn().mockResolvedValue({ id: 'la-1' }),
      countRecentFailures: vi.fn().mockResolvedValue(0),
      findRecentByEmail: vi.fn().mockResolvedValue([]),
      deleteOlderThan: vi.fn().mockResolvedValue(0),
    },
    passwordResetTokens: {
      findById: vi.fn().mockResolvedValue(null),
      findValidByTokenHash: vi.fn().mockResolvedValue(null),
      findValidByUserId: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'prt-1' }),
      markAsUsed: vi.fn().mockResolvedValue(undefined),
      invalidateByUserId: vi.fn().mockResolvedValue(0),
      deleteByUserId: vi.fn().mockResolvedValue(0),
      deleteExpired: vi.fn().mockResolvedValue(0),
    },
    emailVerificationTokens: {
      findById: vi.fn().mockResolvedValue(null),
      findValidByTokenHash: vi.fn().mockResolvedValue(null),
      findValidByUserId: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'evt-1' }),
      markAsUsed: vi.fn().mockResolvedValue(undefined),
      invalidateByUserId: vi.fn().mockResolvedValue(0),
      deleteByUserId: vi.fn().mockResolvedValue(0),
      deleteExpired: vi.fn().mockResolvedValue(0),
    },
    securityEvents: {
      create: vi.fn().mockResolvedValue({ id: 'se-1' }),
      findByUserId: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      findByEmail: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      findByType: vi.fn().mockResolvedValue([]),
      findBySeverity: vi.fn().mockResolvedValue([]),
      countByType: vi.fn().mockResolvedValue(0),
      deleteOlderThan: vi.fn().mockResolvedValue(0),
    },
    magicLinkTokens: {
      findById: vi.fn().mockResolvedValue(null),
      findValidByTokenHash: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'ml-1' }),
      markAsUsed: vi.fn().mockResolvedValue(undefined),
      deleteByUserId: vi.fn().mockResolvedValue(0),
      deleteExpired: vi.fn().mockResolvedValue(0),
      countRecentByEmail: vi.fn().mockResolvedValue(0),
    },
    oauthConnections: {
      findByProviderAndProviderId: vi.fn().mockResolvedValue(null),
      findByUserId: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'oc-1' }),
      delete: vi.fn().mockResolvedValue(true),
      countByUserId: vi.fn().mockResolvedValue(0),
    },
    pushSubscriptions: {
      findByEndpoint: vi.fn().mockResolvedValue(null),
      findByUserId: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'ps-1' }),
      delete: vi.fn().mockResolvedValue(true),
      deleteByUserId: vi.fn().mockResolvedValue(0),
    },
    notificationPreferences: {
      findByUserId: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({ id: 'np-1' }),
    },
    plans: { findById: vi.fn().mockResolvedValue(null), findAll: vi.fn().mockResolvedValue([]) },
    subscriptions: {
      findById: vi.fn().mockResolvedValue(null),
      findByUserId: vi.fn().mockResolvedValue(null),
    },
    customerMappings: { findByUserId: vi.fn().mockResolvedValue(null) },
    invoices: { findByUserId: vi.fn().mockResolvedValue([]) },
    paymentMethods: { findByUserId: vi.fn().mockResolvedValue([]) },
    billingEvents: { create: vi.fn().mockResolvedValue({ id: 'be-1' }) },
    legalDocuments: {
      findAllLatest: vi.fn().mockResolvedValue([]),
      findLatestByType: vi.fn().mockResolvedValue(null),
      findById: vi.fn().mockResolvedValue(null),
    },
    userAgreements: {
      findByUserAndDocument: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'ua-1', agreedAt: new Date() }),
    },
    memberships: {
      findByUserId: vi.fn().mockResolvedValue([]),
      findByTenantId: vi.fn().mockResolvedValue([]),
      findByUserAndTenant: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'mb-1' }),
      update: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue(true),
    },
    tenants: {
      findById: vi.fn().mockResolvedValue(null),
      findBySlug: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'tenant-1' }),
      update: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue(true),
    },
    invitations: {
      findById: vi.fn().mockResolvedValue(null),
      findByTenantId: vi.fn().mockResolvedValue([]),
      findByToken: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'inv-1' }),
      update: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue(true),
    },
    activities: {
      create: vi.fn().mockResolvedValue({ id: 'act-1' }),
      findByTenantId: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    },
    auditEvents: {
      create: vi.fn().mockResolvedValue({ id: 'ae-1' }),
      findByUserId: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    },
    consent: {
      findByUserId: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({ id: 'consent-1' }),
    },
    dataExports: {
      findById: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'export-1' }),
      findByUserId: vi.fn().mockResolvedValue([]),
    },
  };
}

function createMockDbClient() {
  const mockTx = {
    query: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn().mockResolvedValue(null),
    execute: vi.fn().mockResolvedValue(0),
    raw: vi.fn().mockResolvedValue([]),
    transaction: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue(true),
    close: vi.fn().mockResolvedValue(undefined),
    getClient: vi.fn(),
  };

  return {
    query: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn().mockResolvedValue(null),
    execute: vi.fn().mockResolvedValue(0),
    raw: vi.fn().mockResolvedValue([]),
    transaction: vi.fn().mockImplementation(async (cb: (tx: typeof mockTx) => Promise<unknown>) => {
      return cb(mockTx);
    }),
    healthCheck: vi.fn().mockResolvedValue(true),
    close: vi.fn().mockResolvedValue(undefined),
    getClient: vi.fn(),
  };
}

function createMockEmailTemplates() {
  const template = {
    subject: 'Test Subject',
    html: '<p>Test</p>',
    text: 'Test',
    to: 'test@example.com',
  };
  return {
    passwordReset: vi.fn().mockReturnValue(template),
    magicLink: vi.fn().mockReturnValue(template),
    emailVerification: vi.fn().mockReturnValue(template),
    existingAccountRegistrationAttempt: vi.fn().mockReturnValue(template),
    tokenReuseAlert: vi.fn().mockReturnValue(template),
    newLoginAlert: vi.fn().mockReturnValue(template),
    passwordChangedAlert: vi.fn().mockReturnValue(template),
    emailChangedAlert: vi.fn().mockReturnValue(template),
  };
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Consent, Data Export & Legal Integration Tests', () => {
  let testServer: TestServer;
  let mockDb: ReturnType<typeof createMockDbClient>;
  let mockRepos: ReturnType<typeof createMockRepos>;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let fakeComplianceDb: DbClient;

  beforeAll(async () => {
    testServer = await buildTestServer();

    mockDb = createMockDbClient();
    mockRepos = createMockRepos();
    mockLogger = createMockLogger();

    const ctx = {
      db: mockDb,
      repos: mockRepos,
      system: { db: mockDb, repos: mockRepos },
      log: mockLogger,
      email: testServer.email,
      emailTemplates: createMockEmailTemplates(),
      config: testServer.config,
    };

    fakeComplianceDb = {
      query: vi.fn().mockResolvedValue([]),
      queryOne: vi.fn().mockResolvedValue(null),
      execute: vi.fn().mockResolvedValue(0),
      raw: vi.fn().mockResolvedValue([]),
      transaction: async <T>(fn: (tx: DbClient) => Promise<T>): Promise<T> => fn(fakeComplianceDb),
      withSession: () => fakeComplianceDb,
    } as unknown as DbClient;

    registerServerModules(
      testServer.server as never,
      ctx as never,
      [identityServer, complianceServer],
      {
        resolveDb: () => fakeComplianceDb,
        validateResponses: true,
        env: {
          JWT_SECRET: testServer.config.auth.jwt.secret,
          APP_BASE_URL: testServer.config.server.appBaseUrl,
        },
        kernel: {
          db: {
            system: (fn) => fn(fakeComplianceDb),
            viewer: (_v, fn) => fn(fakeComplianceDb),
          },
          jobs: { enqueue: vi.fn().mockResolvedValue('j-1') },
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
    clearLivenessCache();
    for (const id of [
      'user-test-123',
      'admin-test-456',
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ]) {
      setLiveness(id, {
        tokenVersion: 0,
        lockedUntil: null,
        lockReason: null,
        role: id === 'admin-test-456' ? 'admin' : 'user',
        emailVerified: true,
      });
    }
  });

  // ==========================================================================
  // Consent Routes
  // ==========================================================================

  describe('GET /api/users/me/consent', () => {
    it('returns 401 without token', async () => {
      const response = await testServer.inject({
        method: 'GET',
        url: '/api/users/me/consent',
      });
      expect(response.statusCode).toBe(401);
      const body = parseJsonResponse(response) as { message: string };
      expect(body.message).toBe('Unauthorized');
    });

    it('returns 404 for POST method', async () => {
      const response = await testServer.inject({
        method: 'POST',
        url: '/api/users/me/consent',
        payload: {},
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('PATCH /api/users/me/consent/update', () => {
    it('returns 401 without token', async () => {
      const response = await testServer.inject({
        method: 'PATCH',
        url: '/api/users/me/consent/update',
        payload: {},
      });
      expect(response.statusCode).toBe(401);
      const body = parseJsonResponse(response) as { message: string };
      expect(body.message).toBe('Unauthorized');
    });

    it('returns 404 for GET method', async () => {
      const response = await testServer.inject({
        method: 'GET',
        url: '/api/users/me/consent/update',
      });
      expect(response.statusCode).toBe(404);
    });
  });

  // ==========================================================================
  // Data Export Routes
  // ==========================================================================

  describe('POST /api/users/me/export', () => {
    it('returns 401 without token', async () => {
      const response = await testServer.inject({
        method: 'POST',
        url: '/api/users/me/export',
        payload: {},
      });
      expect(response.statusCode).toBe(401);
      const body = parseJsonResponse(response) as { message: string };
      expect(body.message).toBe('Unauthorized');
    });

    it('returns 404 for GET method', async () => {
      const response = await testServer.inject({
        method: 'GET',
        url: '/api/users/me/export',
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /api/users/me/export/:id/status', () => {
    it('returns 401 without token', async () => {
      const response = await testServer.inject({
        method: 'GET',
        url: '/api/users/me/export/export-123/status',
      });
      expect(response.statusCode).toBe(401);
      const body = parseJsonResponse(response) as { message: string };
      expect(body.message).toBe('Unauthorized');
    });

    it('returns 404 for POST method', async () => {
      const response = await testServer.inject({
        method: 'POST',
        url: '/api/users/me/export/export-123/status',
        payload: {},
      });
      expect(response.statusCode).toBe(404);
    });
  });

  // ==========================================================================
  // Legal Routes
  // ==========================================================================

  describe('GET /api/legal/current (public)', () => {
    it('returns current documents without authentication', async () => {
      const response = await testServer.inject({
        method: 'GET',
        url: '/api/legal/current',
      });
      expect(response.statusCode).toBe(200);
      expect(parseJsonResponse(response)).toEqual({ documents: [] });
    });

    it('returns 404 for POST method', async () => {
      const response = await testServer.inject({
        method: 'POST',
        url: '/api/legal/current',
        payload: {},
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /api/users/me/agreements', () => {
    it('returns 401 without token', async () => {
      const response = await testServer.inject({
        method: 'GET',
        url: '/api/users/me/agreements',
      });
      expect(response.statusCode).toBe(401);
      const body = parseJsonResponse(response) as { message: string };
      expect(body.message).toBe('Unauthorized');
    });

    it('returns 404 for POST method', async () => {
      const response = await testServer.inject({
        method: 'POST',
        url: '/api/users/me/agreements',
        payload: {},
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /api/admin/legal/publish', () => {
    it('returns 401 without token', async () => {
      const response = await testServer.inject({
        method: 'POST',
        url: '/api/admin/legal/publish',
        payload: {},
      });
      expect(response.statusCode).toBe(401);
      const body = parseJsonResponse(response) as { message: string };
      expect(body.message).toBe('Unauthorized');
    });

    it('returns 404 for GET method', async () => {
      const response = await testServer.inject({
        method: 'GET',
        url: '/api/admin/legal/publish',
      });
      expect(response.statusCode).toBe(404);
    });
  });

  // ==========================================================================
  // Account Deletion (Compliance / Data Privacy)
  // ==========================================================================

  describe('POST /api/users/me/delete', () => {
    it('returns 401 without token', async () => {
      const response = await testServer.inject({
        method: 'POST',
        url: '/api/users/me/delete',
        payload: {},
      });
      expect(response.statusCode).toBe(401);
      const body = parseJsonResponse(response) as { message: string };
      expect(body.message).toBe('Unauthorized');
    });

    it('sets deleted_at on the user record when deletion is requested', async () => {
      const now = new Date('2024-01-01T00:00:00.000Z');
      const graceEnds = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const activeUserRow = {
        id: '11111111-1111-4111-8111-111111111111',
        email: 'delete-me@example.com',
        canonical_email: 'delete-me@example.com',
        username: 'deleteme',
        password_hash: 'hash',
        first_name: 'Delete',
        last_name: 'Me',
        avatar_url: null,
        role: 'user',
        email_verified: true,
        email_verified_at: now,
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
        created_at: now,
        updated_at: now,
        version: 1,
      };

      // compliance context checks latest ToS doc (null -> tosAccepted: true), then identityServer reads + updates user
      vi.mocked(fakeComplianceDb.queryOne)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(activeUserRow)
        .mockResolvedValueOnce({
          ...activeUserRow,
          deleted_at: new Date(),
          deletion_grace_period_ends: graceEnds,
        });

      const userId = '11111111-1111-4111-8111-111111111111';
      const userJwt = createTestJwt({ userId, email: 'delete-me@example.com' });
      const sudoToken = sign({ userId, type: 'sudo' }, testServer.config.auth.jwt.secret, {
        expiresIn: '5m',
      });
      const response = await testServer.inject(
        buildAuthenticatedRequest({
          method: 'POST',
          url: '/api/users/me/delete',
          accessToken: userJwt,
          headers: { 'x-sudo-token': sudoToken },
          payload: {},
        }),
      );

      expect(response.statusCode).toBe(200);
      const body = parseJsonResponse(response) as {
        status: string;
        deletionGracePeriodEnds?: string;
      };
      expect(body.status).toBe('pending_deletion');
      expect(body.deletionGracePeriodEnds).toBeDefined();
    });

    it('rejects duplicate deletion request when account already has deletion pending', async () => {
      const now = new Date('2024-01-01T00:00:00.000Z');
      const pastGracePeriod = new Date(Date.now() - 1000);
      const userId = '22222222-2222-4222-8222-222222222222';
      const deletedUserRow = {
        id: userId,
        email: 'deleted@example.com',
        canonical_email: 'deleted@example.com',
        username: 'deleteduser',
        password_hash: 'hash',
        first_name: 'Deleted',
        last_name: 'User',
        avatar_url: null,
        role: 'user',
        email_verified: true,
        email_verified_at: now,
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
        deleted_at: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
        deletion_grace_period_ends: pastGracePeriod,
        token_version: 0,
        created_at: now,
        updated_at: now,
        version: 1,
      };

      vi.mocked(fakeComplianceDb.queryOne)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(deletedUserRow);

      const userJwt = createTestJwt({ userId, email: 'deleted@example.com' });
      const sudoToken = sign({ userId, type: 'sudo' }, testServer.config.auth.jwt.secret, {
        expiresIn: '5m',
      });
      const response = await testServer.inject(
        buildAuthenticatedRequest({
          method: 'POST',
          url: '/api/users/me/delete',
          accessToken: userJwt,
          headers: { 'x-sudo-token': sudoToken },
          payload: {},
        }),
      );

      expect(response.statusCode).toBe(400);
      const body = parseJsonResponse(response) as { message: string };
      expect(body.message).toContain('already');
    });
  });
});
