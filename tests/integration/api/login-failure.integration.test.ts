// tests/integration/api/login-failure.integration.test.ts
/**
 * Login Failure Integration Tests
 *
 * Verifies anti-enumeration behavior: login failures always return
 * the same generic 401 message regardless of failure reason.
 */

import { createAuthGuard, identityServer } from '@bslt/identity/server';
import { registerServerModules } from '@bslt/server-system/module';
import {
  buildTestServer,
  createMockLogger,
  parseJsonResponse,
  type TestServer,
} from '@bslt/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbClient } from '@bslt/db';
import type { AuthGuardFactory } from '@bslt/server/http';

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
    legalDocuments: { findLatestByType: vi.fn().mockResolvedValue(null) },
    userAgreements: {
      findByUserAndDocument: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'ua-1' }),
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

function getErrorMessage(response: { body: string }): string | undefined {
  const payload = parseJsonResponse(response) as {
    message?: string;
    error?: { message?: string };
  };
  return payload.message ?? payload.error?.message;
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Login Failure Anti-Enumeration Tests', () => {
  let testServer: TestServer;
  let mockRepos: ReturnType<typeof createMockRepos>;
  let mockDb: ReturnType<typeof createMockDbClient>;
  let mockEmail: ReturnType<typeof createMockEmailTemplates>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeAll(async () => {
    testServer = await buildTestServer();

    mockDb = createMockDbClient();
    mockRepos = createMockRepos();
    mockLogger = createMockLogger();
    mockEmail = createMockEmailTemplates();

    const ctx = {
      db: mockDb,
      repos: mockRepos,
      log: mockLogger,
      email: testServer.email,
      emailTemplates: mockEmail,
      config: testServer.config,
    };

    registerServerModules(testServer.server as never, ctx as never, [identityServer], {
      resolveDb: () => mockDb as unknown as DbClient,
      validateResponses: true,
      env: {
        JWT_SECRET: testServer.config.auth.jwt.secret,
        APP_BASE_URL: testServer.config.server.appBaseUrl,
        ARGON2_MEMORY_COST: '1024',
        ARGON2_TIME_COST: '2',
        ARGON2_PARALLELISM: '1',
        LOCKOUT_BASE_DELAY_MS: '0',
      },
      kernel: {
        db: {
          system: (fn) => (mockDb as unknown as DbClient).transaction(fn),
          viewer: (_v, fn) => (mockDb as unknown as DbClient).transaction(fn),
        },
        comms: {
          appBaseUrl: testServer.config.server.appBaseUrl,
          hmacSecret: testServer.config.auth.jwt.secret,
          emailTemplates: mockEmail,
        },
        events: { publish: vi.fn().mockResolvedValue(undefined) },
        log: mockLogger,
        clock: { now: () => new Date() },
      },
      routerOptions: {
        prefix: '/api',
        jwtSecret: testServer.config.auth.jwt.secret,
        authGuardFactory: createAuthGuard satisfies AuthGuardFactory,
      },
    });

    await testServer.ready();
  });

  afterAll(async () => {
    await testServer.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(mockDb, createMockDbClient());
    mockDb.transaction.mockImplementation(async (cb: (tx: typeof mockDb) => Promise<unknown>) =>
      cb(mockDb),
    );
    Object.assign(mockRepos, createMockRepos());
    Object.assign(mockEmail, createMockEmailTemplates());
    Object.assign(mockLogger, createMockLogger());
  });

  function makeExistingDbUserRow() {
    return {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'real@example.com',
      canonical_email: 'real@example.com',
      username: 'realuser',
      first_name: 'Real',
      last_name: 'User',
      role: 'user',
      email_verified: true,
      password_hash: '$argon2id$v=19$m=1024,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$wronghash',
      failed_login_attempts: 0,
      locked_until: null,
      lock_reason: null,
      totp_enabled: false,
      totp_secret: null,
      token_version: 0,
      created_at: new Date(),
      updated_at: new Date(),
      version: 1,
    };
  }

  // ==========================================================================
  // Anti-Enumeration: Generic 401 Responses
  // ==========================================================================

  describe('anti-enumeration', () => {
    it('returns generic 401 for non-existent user', async () => {
      const response = await testServer.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          identifier: 'nonexistent@example.com',
          password: 'SomePassword123!',
        },
      });

      expect(response.statusCode).toBe(401);
      expect(getErrorMessage(response)).toBe('Invalid email or password');
    });

    it('returns generic 401 for wrong password', async () => {
      mockDb.queryOne.mockImplementation(async (q: unknown) => {
        const text = typeof q === 'string' ? q : (q as { text: string }).text;
        if (text.includes('FROM identity_users')) return makeExistingDbUserRow();
        return { count: 0 };
      });

      const response = await testServer.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          identifier: 'real@example.com',
          password: 'WrongPassword123!',
        },
      });

      expect(response.statusCode).toBe(401);
      expect(getErrorMessage(response)).toBe('Invalid email or password');
    });

    it('both non-existent user and wrong password return identical message', async () => {
      const response1 = await testServer.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          identifier: 'nobody@example.com',
          password: 'SomePassword123!',
        },
      });

      vi.clearAllMocks();
      mockDb.transaction.mockImplementation(async (cb: (tx: typeof mockDb) => Promise<unknown>) =>
        cb(mockDb),
      );
      mockDb.queryOne.mockImplementation(async (q: unknown) => {
        const text = typeof q === 'string' ? q : (q as { text: string }).text;
        if (text.includes('FROM identity_users')) return makeExistingDbUserRow();
        return { count: 0 };
      });

      const response2 = await testServer.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          identifier: 'real@example.com',
          password: 'WrongPassword123!',
        },
      });

      const body1 = getErrorMessage(response1);
      const body2 = getErrorMessage(response2);
      expect(response1.statusCode).toBe(response2.statusCode);
      expect(body1).toBe(body2);
    });

    it('response never exposes specific failure reason to client', async () => {
      mockRepos.users.findByEmail.mockResolvedValue(null);

      const response = await testServer.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          identifier: 'test@example.com',
          password: 'Test123!',
        },
      });

      const body = parseJsonResponse(response) as Record<string, unknown>;
      // Should not contain any enumeration-revealing fields
      expect(body).not.toHaveProperty('reason');
      expect(body).not.toHaveProperty('failureReason');
      expect(body).not.toHaveProperty('userExists');
      expect(body).not.toHaveProperty('emailExists');
    });
  });
});
