// tests/integration/api/captcha.integration.test.ts
/**
 * CAPTCHA Integration Tests
 *
 * Tests CAPTCHA behavior through the auth API endpoints.
 * Verifies that CAPTCHA is properly gated by config.
 */

import { defineModule } from '@bslt/contract';
import { createAuthGuard, identityServer } from '@bslt/identity/server';
import {
  createKernelActionsService,
  implementServer,
  registerServerModules,
  type AnyServerModule,
  type InstantiatedServerModule,
} from '@bslt/server-system/module';
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

function mountIdentityForTest(
  testServer: TestServer,
  mockDb: ReturnType<typeof createMockDbClient>,
  mockRepos: ReturnType<typeof createMockRepos>,
  mockLogger: ReturnType<typeof createMockLogger>,
  mockEmail: ReturnType<typeof createMockEmailTemplates>,
  extraEnv: Record<string, string | undefined> = {},
): void {
  mockDb.transaction.mockImplementation(async (cb: (tx: typeof mockDb) => Promise<unknown>) =>
    cb(mockDb),
  );
  const ctx = {
    db: mockDb,
    repos: mockRepos,
    log: mockLogger,
    email: testServer.email,
    emailTemplates: mockEmail,
    config: testServer.config,
  };
  const complianceStub: AnyServerModule = implementServer(
    defineModule({
      id: 'compliance',
      summary: 'Compliance stub',
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
      actions: {
        'compliance.peekSignupAgreements': async () => Promise.resolve([]),
        'compliance.recordSignupConsents': async () => Promise.resolve(),
      },
    },
  );
  const instances = new Map<string, InstantiatedServerModule>();
  const registered = registerServerModules(
    testServer.server as never,
    ctx as never,
    [identityServer, complianceStub],
    {
      resolveDb: () => mockDb as unknown as DbClient,
      validateResponses: true,
      env: {
        JWT_SECRET: testServer.config.auth.jwt.secret,
        APP_BASE_URL: testServer.config.server.appBaseUrl,
        ARGON2_MEMORY_COST: '1024',
        ARGON2_TIME_COST: '2',
        ARGON2_PARALLELISM: '1',
        LOCKOUT_BASE_DELAY_MS: '0',
        ...extraEnv,
      },
      kernel: {
        db: {
          system: (fn) => (mockDb as unknown as DbClient).transaction(fn),
          viewer: (_v, fn) => (mockDb as unknown as DbClient).transaction(fn),
        },
        actions: createKernelActionsService(() => instances.values()),
        comms: {
          appBaseUrl: testServer.config.server.appBaseUrl,
          hmacSecret: testServer.config.auth.jwt.secret,
          emailTemplates: mockEmail,
          sendEmail: async (opts) => {
            const res = await testServer.email.send({
              to: opts.to,
              subject: opts.subject,
              text: opts.text,
              ...(opts.html !== undefined ? { html: opts.html } : {}),
            });
            return { success: res.success };
          },
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
    },
  );
  for (const [k, v] of registered) {
    instances.set(k, v);
  }
}

// ============================================================================
// Test Suite — CAPTCHA disabled (default test config)
// ============================================================================

describe('CAPTCHA Integration Tests (disabled)', () => {
  let testServer: TestServer;
  let mockDb: ReturnType<typeof createMockDbClient>;
  let mockRepos: ReturnType<typeof createMockRepos>;

  beforeAll(async () => {
    testServer = await buildTestServer();

    mockDb = createMockDbClient();
    mockRepos = createMockRepos();
    const mockLogger = createMockLogger();
    const mockEmail = createMockEmailTemplates();

    mountIdentityForTest(testServer, mockDb, mockRepos, mockLogger, mockEmail);

    await testServer.ready();
  });

  afterAll(async () => {
    await testServer.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.query.mockResolvedValue([]);
    mockDb.queryOne.mockResolvedValue(null);
    mockDb.execute.mockResolvedValue(0);
    mockDb.transaction.mockImplementation(async (cb: (tx: typeof mockDb) => Promise<unknown>) =>
      cb(mockDb),
    );
  });

  it('login succeeds without captchaToken when CAPTCHA is disabled', async () => {
    const response = await testServer.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        identifier: 'user@example.com',
        password: 'TestPassword123!',
      },
    });

    // Should fail for invalid credentials (401), not CAPTCHA (400)
    expect(response.statusCode).toBe(401);
    expect(getErrorMessage(response)).toBe('Invalid email or password');
  });

  it('register proceeds without captchaToken when CAPTCHA is disabled', async () => {
    const createdRow = {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'newuser@example.com',
      canonical_email: 'newuser@example.com',
      username: 'testuser',
      password_hash: 'hash',
      first_name: 'Test',
      last_name: 'User',
      role: 'user',
      email_verified: false,
      totp_enabled: false,
      failed_login_attempts: 0,
      token_version: 0,
      created_at: new Date(),
      updated_at: new Date(),
      version: 1,
    };
    mockDb.queryOne.mockImplementation(async (q: unknown) => {
      const text = typeof q === 'string' ? q : (q as { text: string }).text;
      if (text.startsWith('INSERT INTO identity_users')) return createdRow;
      if (text.startsWith('INSERT INTO identity_auth_tokens')) {
        return {
          id: '22222222-2222-4222-8222-222222222222',
          type: 'email_verification',
          user_id: createdRow.id,
          email: null,
          token_hash: 'h',
          attempts: 0,
          max_attempts: 1,
          metadata: {},
          expires_at: new Date(Date.now() + 60_000),
          used_at: null,
          created_at: new Date(),
        };
      }
      return null;
    });

    const response = await testServer.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'newuser@example.com',
        username: 'testuser',
        firstName: 'Test',
        lastName: 'User',
        password: 'StrongP@ssword123!',
        tosAccepted: true,
        eligibilityAttested: true,
      },
    });

    // Should get past CAPTCHA and into service logic (not 400 for missing CAPTCHA)
    expect(response.statusCode).not.toBe(400);
  });
});

// ============================================================================
// Test Suite — CAPTCHA enabled
// ============================================================================

describe('CAPTCHA Integration Tests (enabled)', () => {
  let testServer: TestServer;

  beforeAll(async () => {
    testServer = await buildTestServer({
      config: {
        auth: {
          captcha: {
            enabled: true,
            provider: 'turnstile',
            siteKey: 'test-site-key',
            secretKey: 'test-secret-key',
          },
        },
      } as never,
    });

    const mockDb = createMockDbClient();
    const mockRepos = createMockRepos();
    const mockLogger = createMockLogger();
    const mockEmail = createMockEmailTemplates();

    mountIdentityForTest(testServer, mockDb, mockRepos, mockLogger, mockEmail, {
      CAPTCHA_ENABLED: 'true',
      CAPTCHA_SECRET_KEY: 'test-secret-key',
    });

    await testServer.ready();
  });

  afterAll(async () => {
    await testServer.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('login rejects missing captchaToken when CAPTCHA is enabled', async () => {
    const response = await testServer.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        identifier: 'user@example.com',
        password: 'TestPassword123!',
      },
    });

    // CAPTCHA verification should fail with 400 for missing/empty token
    expect(response.statusCode).toBe(400);
    const body = parseJsonResponse(response) as { message: string };
    expect(body.message).toContain('CAPTCHA');
  });
});
