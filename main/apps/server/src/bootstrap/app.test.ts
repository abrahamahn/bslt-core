// main/apps/server/src/bootstrap/app.test.ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import {
  brotliCompressSync,
  brotliDecompressSync,
  deflateSync,
  gunzipSync,
  gzipSync,
  zstdCompressSync,
} from 'node:zlib';

import { createAccessToken, createAuthEmailTemplates } from '@bslt/identity/server';
import { createLogger } from '@bslt/server-system/logger';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { installedModules } from '../generated/modules';

import { App, createServer } from './app';
import { createFallbackCommsState } from './phases/comms';

import type { DataContext, InfraContext } from './context';
import type { DbClient, QueueStore } from '@bslt/db';
import type { AppConfig } from '@bslt/server-system/config';
import type { HttpServer, InjectResponse } from '@bslt/server-system/http';

const INSTALLED_MODULE_IDS: ReadonlySet<string> = new Set(installedModules.map((m) => m.id));

function createCoreBootConfig(): AppConfig {
  return {
    app: { name: 'Core Boot Test' },
    env: 'test',
    server: {
      host: '127.0.0.1',
      port: 0,
      portFallbacks: [],
      cors: {
        origin: ['*'],
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      },
      trustProxy: false,
      logLevel: 'error',
      logging: {
        clientErrorLevel: 'error',
        requestContext: true,
      },
      maintenanceMode: false,
      auditRetentionDays: 90,
      rateLimit: {
        windowMs: 60_000,
        max: 1_000,
      },
      appBaseUrl: 'http://localhost:5173',
      apiBaseUrl: 'http://localhost:0',
      ipBlocklist: { blocklist: [], strictBlocklist: [], allowlist: [] },
      geo: {
        blockedRegions: [],
        countryHeader: 'cf-ipcountry',
        regionHeaders: ['cf-region-code', 'x-geo-region', 'cf-region'],
      },
    },
    database: {
      provider: 'postgresql',
      host: 'localhost',
      port: 5432,
      database: 'test',
      user: 'test',
      password: 'test',
      maxConnections: 1,
      portFallbacks: [],
      ssl: false,
    },
    auth: {
      strategies: ['local'],
      jwt: {
        secret: 'test-secret-that-is-at-least-32-chars-long!!',
        accessTokenExpiry: '15m',
        issuer: 'test',
        audience: 'test',
      },
      refreshToken: {
        expiryDays: 7,
        gracePeriodSeconds: 30,
      },
      argon2: {
        type: 2,
        memoryCost: 1024,
        timeCost: 2,
        parallelism: 1,
      },
      password: {
        minLength: 8,
        maxLength: 64,
        minZxcvbnScore: 2,
      },
      lockout: {
        maxAttempts: 10,
        lockoutDurationMs: 1_800_000,
        progressiveDelay: false,
        baseDelayMs: 0,
      },
      proxy: {
        trustProxy: false,
        trustedProxies: [],
        maxProxyDepth: 1,
      },
      rateLimit: {
        login: { max: 100, windowMs: 60_000 },
        register: { max: 100, windowMs: 60_000 },
        forgotPassword: { max: 100, windowMs: 60_000 },
        verifyEmail: { max: 100, windowMs: 60_000 },
      },
      cookie: {
        name: 'refreshToken',
        secret: 'test-cookie-secret-at-least-32-chars',
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/',
      },
      oauthTokenEncryptionKey: 'test-cookie-secret-at-least-32-chars',
      oauth: {},
      magicLink: {
        tokenExpiryMinutes: 15,
        maxAttempts: 3,
      },
      totp: {
        issuer: 'Core Boot Test',
        window: 1,
      },
    },
    email: {
      provider: 'console',
      smtp: {
        host: '',
        port: 587,
        secure: false,
        auth: { user: '', pass: '' },
        connectionTimeout: 5_000,
        socketTimeout: 5_000,
      },
      from: { name: 'Core Boot Test', address: 'test@example.com' },
      replyTo: 'test@example.com',
    },
    storage: {
      provider: 's3',
      accessKeyId: '',
      secretAccessKey: '',
      region: 'us-east-1',
      bucket: 'test',
      forcePathStyle: false,
      presignExpiresInSeconds: 900,
    },
    billing: {
      enabled: false,
      provider: 'stripe',
      currency: 'usd',
      stripe: {
        secretKey: '',
        publishableKey: '',
        webhookSecret: '',
      },
      paypal: {
        clientId: '',
        clientSecret: '',
        webhookId: '',
        sandbox: true,
        brandName: 'Core Boot Test',
      },
      plans: {},
      urls: {
        portalReturnUrl: 'http://localhost:5173/settings/billing',
        checkoutSuccessUrl: 'http://localhost:5173/settings/billing?checkout=success',
        checkoutCancelUrl: 'http://localhost:5173/settings/billing?checkout=cancel',
      },
    },
    cache: {},
    queue: {},
    notifications: {},
    search: {},
    packageManager: {
      provider: 'pnpm',
      strictPeerDeps: false,
      frozenLockfile: false,
    },
    analytics: { sampleRate: 1 },
  } as unknown as AppConfig;
}

function createMockDb(): DbClient {
  const db = {
    healthCheck: vi.fn().mockResolvedValue(true),
    query: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn().mockResolvedValue(null),
    execute: vi.fn().mockResolvedValue(0),
    raw: vi.fn().mockResolvedValue([]),
    transaction: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    getClient: vi.fn(),
    withSession: vi.fn(),
  };
  db.transaction.mockImplementation(async (callback: (tx: DbClient) => Promise<unknown>) =>
    callback(db as unknown as DbClient),
  );
  db.withSession.mockReturnValue(db);
  return db as unknown as DbClient;
}

function createMockRepos(): DataContext['repos'] {
  return {
    users: {
      findById: vi.fn().mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        username: 'user',
        firstName: 'Test',
        lastName: 'User',
        avatarUrl: null,
        role: 'user',
        emailVerified: true,
        phone: null,
        phoneVerified: null,
        dateOfBirth: null,
        gender: null,
        bio: null,
        city: null,
        state: null,
        country: null,
        language: null,
        website: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        lockedUntil: null,
        lockReason: null,
      }),
      unlockAccount: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as DataContext['repos'];
}

function createCoreInfraContext(config: AppConfig): InfraContext {
  const db = createMockDb();
  const repos = createMockRepos();
  const log = createLogger('error', { service: 'core-boot-test', env: 'test' });
  const queueStore = {
    getQueueStats: vi.fn().mockResolvedValue({ pending: 0, failed: 0 }),
  } as unknown as QueueStore;

  return Object.freeze({
    config,
    db,
    repos,
    search: {
      name: 'test-search',
      getCapabilities: () => ({
        fullTextSearch: false,
        fuzzyMatching: false,
        highlighting: false,
        nestedFields: false,
        arrayOperations: false,
        cursorPagination: false,
        maxPageSize: 0,
        supportedOperators: [],
      }),
      healthCheck: vi.fn().mockResolvedValue(true),
    },
    queue: {
      getStats: vi.fn().mockResolvedValue({ pending: 0, failed: 0 }),
    },
    queueStore,
    pubsub: {
      getSubscriptionCount: vi.fn().mockReturnValue(0),
      publishLocal: vi.fn(),
      setAdapter: vi.fn(),
    },
    cache: {
      getStats: vi.fn().mockResolvedValue({ hits: 0, misses: 0, size: 0 }),
    },
    errorTracker: {
      captureError: vi.fn(),
      addBreadcrumb: vi.fn(),
      setUserContext: vi.fn(),
    },
    emailTemplates: createAuthEmailTemplates({ appName: config.app.name }),
    log,
    contextualize: vi.fn().mockReturnValue({ db, repos }),
  } as unknown as InfraContext);
}

describe('App core boot', () => {
  let app: App | undefined;

  afterEach(async () => {
    await app?.stop();
    app = undefined;
  });

  it('initializes core routes without media/realtime/worker capability packages', async () => {
    const config = createCoreBootConfig();
    app = new App(config, createCoreInfraContext(config));

    await app.init();
    await app.server.ready();

    const routes = app.server.printRoutes();
    expect(app.countRegisteredRoutes()).toBeGreaterThan(0);
    expect(routes).toContain('health');
    expect(routes).toContain('live');
    expect(routes).toContain('auth');
    expect(routes).toContain('login');
    expect(routes).toContain('activities');
    if (INSTALLED_MODULE_IDS.has('billing')) {
      expect(routes).toContain('billing');
      expect(routes).toContain('plans');
    }
    const protectedProbeUrl = INSTALLED_MODULE_IDS.has('files') ? '/api/files' : '/api/activities';
    const protectedResponse = await app.server.inject({ method: 'GET', url: protectedProbeUrl });
    expect(protectedResponse.statusCode).toBe(401);
    expect(routes).not.toContain('/uploads');
    expect(routes).toContain('ticket');
    expect(routes).not.toContain('getRecords');
  });

  it('exposes the boot handles as the system port, and a contextualized context keeps them', () => {
    const config = createCoreBootConfig();
    const infra = createCoreInfraContext(config);
    const scoped = {
      db: { label: 'user-session db' } as unknown as DbClient,
      repos: { label: 'user-session repos' } as unknown as DataContext['repos'],
    };
    vi.mocked(infra.contextualize).mockReturnValue(scoped);
    app = new App(config, infra);

    // Boot context: the request handles ARE the system handles.
    const boot = app.context;
    expect(boot.system.db).toBe(infra.db);
    expect(boot.system.repos).toBe(infra.repos);
    expect(boot.db).toBe(infra.db);

    // A user session replaces db/repos and nothing else: the system port still
    // names the boot handles, so a handler that needs them says so explicitly.
    const session = { userId: 'user-1', role: 'user' };
    const request = boot.contextualize(session);
    expect(infra.contextualize).toHaveBeenCalledWith(session);
    expect(request.db).toBe(scoped.db);
    expect(request.repos).toBe(scoped.repos);
    expect(request.system.db).toBe(infra.db);
    expect(request.system.repos).toBe(infra.repos);

    // ...and again when the tenant scope is added on top of the user scope.
    const tenant = request.contextualize({ ...session, orgId: 'tenant-1' });
    expect(tenant.system.db).toBe(infra.db);
    expect(tenant.system.repos).toBe(infra.repos);
  });

  it.runIf(INSTALLED_MODULE_IDS.has('billing'))(
    'serves public billing plans when billing provider credentials are absent',
    async () => {
      const config = createCoreBootConfig();
      const infra = createCoreInfraContext(config);
      const now = new Date('2026-01-01T00:00:00.000Z');
      vi.mocked(infra.db.query).mockImplementation(async (sql) => {
        if (
          typeof sql === 'object' &&
          sql !== null &&
          'text' in sql &&
          typeof sql.text === 'string' &&
          sql.text.includes('billing_plans')
        ) {
          return [
            {
              id: 'free',
              name: 'Free',
              description: null,
              interval: 'month',
              price_in_cents: 0,
              currency: 'usd',
              features: [],
              trial_days: 0,
              stripe_price_id: null,
              stripe_product_id: null,
              paypal_plan_id: null,
              is_active: true,
              sort_order: 0,
              created_at: now,
              updated_at: now,
              version: 1,
            },
            {
              id: 'pro',
              name: 'Pro',
              description: null,
              interval: 'month',
              price_in_cents: 1900,
              currency: 'usd',
              features: [],
              trial_days: 14,
              stripe_price_id: null,
              stripe_product_id: null,
              paypal_plan_id: null,
              is_active: true,
              sort_order: 1,
              created_at: now,
              updated_at: now,
              version: 1,
            },
            {
              id: 'enterprise',
              name: 'Enterprise',
              description: null,
              interval: 'month',
              price_in_cents: 9900,
              currency: 'usd',
              features: [],
              trial_days: 14,
              stripe_price_id: null,
              stripe_product_id: null,
              paypal_plan_id: null,
              is_active: true,
              sort_order: 2,
              created_at: now,
              updated_at: now,
              version: 1,
            },
          ];
        }
        return [];
      });
      app = new App(config, infra);

      await app.init();
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/api/billing/plans',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { plans: Array<{ id: string; name: string }> };
      expect(body.plans.map((plan) => plan.id)).toEqual(['free', 'pro', 'enterprise']);
    },
  );

  it('geo-blocks with a CORS-readable 403 — the CORS hook runs before the geo gate', async () => {
    const config = createCoreBootConfig();
    config.server.geo.blockedRegions = ['US-WA'];
    app = new App(config, createCoreInfraContext(config));

    await app.init();
    await app.server.ready();

    const blocked = await app.server.inject({
      method: 'GET',
      url: '/api/legal/current',
      headers: {
        origin: 'http://localhost:5173',
        'cf-ipcountry': 'US',
        'cf-region-code': 'WA',
      },
    });

    // The 403 must be READABLE by the browser: CORS headers were applied by the
    // earlier onRequest hook before the geo gate answered the request.
    expect(blocked.statusCode).toBe(403);
    expect(blocked.headers['access-control-allow-origin']).toBe('*');
    expect(blocked.json()).toEqual({
      code: 'JURISDICTION_BLOCKED',
      message: 'This service is not offered in your region (US-WA).',
      jurisdiction: 'US-WA',
      unavailablePath: '/unavailable',
    });

    const allowed = await app.server.inject({
      method: 'GET',
      url: '/api/legal/current',
      headers: { origin: 'http://localhost:5173', 'cf-ipcountry': 'DE' },
    });
    expect(allowed.statusCode).toBe(200);
  });

  it('lists every route it registered, module routes and plugin routes alike', async () => {
    const config = createCoreBootConfig();
    app = new App(config, createCoreInfraContext(config));
    expect(app.routes()).toEqual([]);

    await app.init();
    await app.server.register((plugin, _options, done) => {
      plugin.get('/plugin-route', () => ({ ok: true }));
      done();
    });
    await app.server.ready();

    const routes = app.routes();
    // A route-map route, a system route without the /api prefix, the raw CSRF
    // endpoint of createServer, and a route a plugin registered.
    expect(routes).toContainEqual({ method: 'POST', url: '/api/auth/login' });
    expect(routes).toContainEqual({ method: 'GET', url: '/health' });
    expect(routes).toContainEqual({ method: 'GET', url: '/api/csrf-token' });
    expect(routes).toContainEqual({ method: 'GET', url: '/plugin-route' });
    // Every listed route is one the server answers for.
    for (const route of routes) {
      expect(app.server.hasRoute({ method: route.method as 'GET', url: route.url })).toBe(true);
    }
  });

  // The provider (composed in the comms phase) and the /uploads route (composed
  // in createServer) must agree on the signing secret, and the route must be
  // the only way to read a local file over HTTP — and only with a signature.
  it('serves local uploads only through URLs signed by the composed provider', async () => {
    const root = await mkdtemp(join(tmpdir(), 'app-uploads-'));
    try {
      await mkdir(join(root, 'files', 'user-1'), { recursive: true });
      await writeFile(join(root, 'files', 'user-1', 'secret.txt'), 'top secret', 'utf8');
      const config: AppConfig = {
        ...createCoreBootConfig(),
        storage: {
          provider: 'local',
          rootPath: root,
          publicBaseUrl: '/uploads',
          signingSecret: 'core-boot-storage-signing-secret-0123456789',
        },
      };
      const { context } = createFallbackCommsState(config, {
        context: createCoreInfraContext(config),
      });
      app = new App(config, context);

      await app.init();
      await app.server.ready();

      expect(app.server.hasRoute({ method: 'GET', url: '/uploads/*' })).toBe(true);
      // The legacy two-segment file server stays unregistered.
      expect(app.server.hasRoute({ method: 'GET', url: '/uploads/:id/:filename' })).toBe(false);

      for (const url of [
        '/uploads/files/user-1/secret.txt',
        '/uploads/user-1/secret.txt',
        '/uploads/files/user-1/secret.txt?expires=9999999999&signature=00',
        '/uploads/files%2Fuser-1%2Fsecret.txt',
      ]) {
        const unsigned = await app.server.inject({ method: 'GET', url });
        expect(unsigned.statusCode).toBe(403);
        expect(unsigned.body).not.toContain('top secret');
      }

      const storage = context.storage;
      if (storage === undefined) throw new Error('Expected local storage to be composed');
      const signed = await app.server.inject({
        method: 'GET',
        url: await storage.getSignedUrl('files/user-1/secret.txt', 60),
      });
      expect(signed.statusCode).toBe(200);
      expect(signed.body).toBe('top secret');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('hands comms-phase services to route handlers (and every other infra service)', () => {
    const config = createCoreBootConfig();
    const { context: infra } = createFallbackCommsState(config, {
      context: createCoreInfraContext(config),
    });
    expect(infra.email).toBeDefined();
    expect(infra.storage).toBeDefined();
    app = new App(config, infra);

    // registerRoutes receives app.context; handlers read outbound comms/storage ports from it.
    expect(app.context.email).toBe(infra.email);
    expect(app.context.storage).toBe(infra.storage);
    expect(app.context.contextualize({ userId: 'user-1', role: 'user' }).email).toBe(infra.email);

    // No infra service is silently dropped by the hand-written App.context literal.
    const missing = Object.keys(infra).filter((key) => !(key in app!.context));
    expect(missing).toEqual([]);
  });

  it('provides a fallback email service when comms are disabled', async () => {
    const config = createCoreBootConfig();
    const context = createCoreInfraContext(config);
    const state = createFallbackCommsState(config, { context });
    const email = state.context.email;

    expect(email).toBeDefined();
    if (email === undefined) throw new Error('Expected fallback email service');

    const result = await email.send({
      to: 'user@example.com',
      subject: 'Verify your email',
      text: 'http://localhost:5173/auth/confirm-email?token=test',
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toMatch(/^core-fallback-/);
  });

  it('rejects authenticated requests with a forged tenant header before handlers run', async () => {
    const config = createCoreBootConfig();
    const context = createCoreInfraContext(config);
    app = new App(config, context);

    await app.init();
    await app.server.ready();

    const token = createAccessToken(
      '22222222-2222-4222-8222-222222222222',
      'user@example.com',
      'user',
      config.auth.jwt.secret,
    );

    const response = await app.server.inject({
      method: 'GET',
      url: '/api/users/me',
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-id': '11111111-1111-4111-8111-111111111111',
      },
    });

    expect(response.statusCode).toBe(403);
    if (INSTALLED_MODULE_IDS.has('orgs')) {
      expect(context.db.queryOne).toHaveBeenCalled();
    }
  });

  it('allows admins to hydrate the current user session', async () => {
    const config = createCoreBootConfig();
    const context = createCoreInfraContext(config);
    const adminId = '11111111-1111-4111-8111-111111111111';
    vi.mocked(context.db.queryOne).mockImplementation(async (sql) => {
      if (/FROM\s+"?identity_users"?\b/iu.test(sql.text)) {
        return {
          id: adminId,
          email: 'admin@example.com',
          canonical_email: 'admin@example.com',
          username: 'admin',
          first_name: 'Admin',
          last_name: 'User',
          role: 'admin',
          email_verified: true,
          email_verified_at: new Date('2026-01-01T00:00:00.000Z'),
          phone: null,
          phone_verified: null,
          date_of_birth: null,
          gender: null,
          bio: null,
          city: null,
          state: null,
          country: null,
          language: null,
          website: null,
          failed_login_attempts: 0,
          locked_until: null,
          lock_reason: null,
          token_version: 1,
          deactivated_at: null,
          deleted_at: null,
          deletion_grace_period_ends: null,
          created_at: new Date('2026-01-01T00:00:00.000Z'),
          updated_at: new Date('2026-01-01T00:00:00.000Z'),
        } as never;
      }
      return null;
    });
    app = new App(config, context);

    await app.init();
    await app.server.ready();

    const token = createAccessToken(adminId, 'admin@example.com', 'admin', config.auth.jwt.secret);

    const response = await app.server.inject({
      method: 'GET',
      url: '/api/users/me',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(200);
  });

  it('mounts only health and metrics probes in probes-only mode while still instantiating modules', async () => {
    const config = createCoreBootConfig();
    const context = createCoreInfraContext(config);
    app = new App(config, context, { httpMode: 'probes-only' });

    await app.init();
    await app.server.ready();

    expect(app.moduleInstances.size).toBeGreaterThan(0);
    expect(app.routes().every((r) => !r.url.startsWith('/api/'))).toBe(true);

    const health = await app.server.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);

    const prom = await app.server.inject({ method: 'GET', url: '/metrics/prometheus' });
    expect(prom.statusCode).toBe(200);
    expect(prom.body).toContain('bslt_event_loop_lag_ms');
    expect(prom.body).toContain('bslt_http_request_duration_ms_bucket');

    const productApi = await app.server.inject({ method: 'GET', url: '/api/users/me' });
    expect(productApi.statusCode).toBe(404);
  });
});

// ============================================================================
// Response compression and request decompression
// ============================================================================

const LARGE_JSON = { data: 'x'.repeat(5000) };
const LARGE_JSON_TEXT = JSON.stringify(LARGE_JSON);

function varyTokens(response: InjectResponse): string[] {
  return String(response.headers['vary'] ?? '')
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token !== '');
}

async function csrfHeaders(server: HttpServer): Promise<Record<string, string>> {
  const response = await server.inject({ method: 'GET', url: '/api/csrf-token' });
  const cookies = [response.headers['set-cookie'] ?? []].flat();
  const cookie = cookies.find((value) => value.startsWith('_csrf='));
  if (cookie === undefined) throw new Error('CSRF cookie not set');
  return {
    'x-csrf-token': (response.json() as { token: string }).token,
    cookie: cookie.split(';')[0] ?? '',
  };
}

describe('response compression (createServer)', () => {
  let server: HttpServer;

  const get = (
    url: string,
    acceptEncoding?: string,
    method: 'GET' | 'HEAD' = 'GET',
  ): Promise<InjectResponse> =>
    server.inject({
      method,
      url,
      headers: acceptEncoding === undefined ? {} : { 'accept-encoding': acceptEncoding },
    });

  const post = async (coding: string, payload: Buffer | string): Promise<InjectResponse> =>
    server.inject({
      method: 'POST',
      url: '/compression/echo',
      headers: {
        ...(await csrfHeaders(server)),
        'content-type': 'application/json',
        'content-encoding': coding,
      },
      payload,
    });

  beforeAll(async () => {
    const config = createCoreBootConfig();
    server = await createServer({ config, app: new App(config, createCoreInfraContext(config)) });
    server.get('/compression/json', () => LARGE_JSON);
    server.get<{ Params: { size: string } }>('/compression/text/:size', (request, reply) =>
      reply.type('text/plain').send('t'.repeat(Number(request.params.size))),
    );
    server.get('/compression/png', (_request, reply) =>
      reply.type('image/png').send(Buffer.alloc(4096, 1)),
    );
    server.get('/compression/event-stream', (_request, reply) =>
      reply.type('text/event-stream').send('data: abcdefgh\n\n'.repeat(256)),
    );
    server.get('/compression/octet-stream', (_request, reply) =>
      reply.type('application/octet-stream').send(Buffer.alloc(4096, 2)),
    );
    server.get('/compression/pre-encoded', (_request, reply) =>
      reply
        .type('application/json')
        .header('content-encoding', 'gzip')
        .send(gzipSync(LARGE_JSON_TEXT)),
    );
    server.get('/compression/no-content', (_request, reply) => reply.code(204).send());
    server.get('/compression/not-modified', (_request, reply) => reply.code(304).send());
    server.get('/compression/partial', (_request, reply) =>
      reply
        .code(206)
        .type('text/plain')
        .header('content-range', 'bytes 0-4999/10000')
        .send('p'.repeat(5000)),
    );
    server.get('/compression/stream', (_request, reply) =>
      reply.type('text/plain').send(Readable.from([Buffer.from('s'.repeat(3000))])),
    );
    server.get('/compression/short-stream', (_request, reply) =>
      reply
        .type('text/plain')
        .header('content-length', 100)
        .send(Readable.from([Buffer.from('b'.repeat(100))])),
    );
    server.get('/compression/vary', (_request, reply) =>
      reply.header('vary', 'Origin').send(LARGE_JSON),
    );
    server.post('/compression/echo', (request) => request.body);
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it('encodes a large JSON body with br and varies on Accept-Encoding', async () => {
    const response = await get('/compression/json', 'br');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-encoding']).toBe('br');
    expect(varyTokens(response)).toContain('accept-encoding');
    expect(JSON.parse(brotliDecompressSync(response.rawPayload).toString('utf8'))).toEqual(
      LARGE_JSON,
    );
  });

  it.each([
    ['gzip;q=1, br;q=0.5', 'gzip'],
    ['br;q=0, gzip', 'gzip'],
    ['br;q=0.5, gzip;q=0.5', 'br'],
    ['x-gzip', 'gzip'],
    ['GZIP', 'gzip'],
    ['*', 'gzip'],
  ])('negotiates Accept-Encoding %j as %s', async (acceptEncoding, expected) => {
    const response = await get('/compression/json', acceptEncoding);
    expect(response.headers['content-encoding']).toBe(expected);
  });

  it.each([[undefined], ['identity'], ['gzip;q=0']])(
    'sends identity when Accept-Encoding is %j',
    async (acceptEncoding) => {
      const response = await get('/compression/json', acceptEncoding);
      expect(response.headers['content-encoding']).toBeUndefined();
      expect(varyTokens(response)).not.toContain('accept-encoding');
      expect(response.json()).toEqual(LARGE_JSON);
    },
  );

  it('leaves a body under 1024 bytes alone and encodes one of 1024 bytes', async () => {
    const small = await get('/compression/text/1023', 'gzip');
    expect(small.headers['content-encoding']).toBeUndefined();
    expect(small.body).toBe('t'.repeat(1023));

    const threshold = await get('/compression/text/1024', 'gzip');
    expect(threshold.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(threshold.rawPayload).toString('utf8')).toBe('t'.repeat(1024));
  });

  it.each(['/compression/png', '/compression/event-stream'])(
    'never encodes a non-compressible type (%s)',
    async (url) => {
      const response = await get(url, 'gzip, br');
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-encoding']).toBeUndefined();
      expect(response.rawPayload.length).toBe(4096);
    },
  );

  it('does not encode a body the handler already encoded', async () => {
    const response = await get('/compression/pre-encoded', 'gzip, br');
    expect(response.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(response.rawPayload).toString('utf8')).toBe(LARGE_JSON_TEXT);
  });

  it('answers HEAD with identity headers', async () => {
    const response = await get('/compression/json', 'br', 'HEAD');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-encoding']).toBeUndefined();
    expect(response.headers['content-length']).toBe(String(LARGE_JSON_TEXT.length));
  });

  it.each(['/compression/no-content', '/compression/not-modified', '/compression/partial'])(
    'does not encode a 204, a 304 or a 206 (%s)',
    async (url) => {
      const response = await get(url, 'gzip, br');
      expect(response.headers['content-encoding']).toBeUndefined();
    },
  );

  it('encodes a stream without a Content-Length and leaves a short declared stream alone', async () => {
    const stream = await get('/compression/stream', 'gzip');
    expect(stream.headers['content-encoding']).toBe('gzip');
    expect(stream.headers['content-length']).toBeUndefined();
    expect(gunzipSync(stream.rawPayload).toString('utf8')).toBe('s'.repeat(3000));

    const short = await get('/compression/short-stream', 'gzip');
    expect(short.headers['content-encoding']).toBeUndefined();
    expect(short.headers['content-length']).toBe('100');
    expect(short.body).toBe('b'.repeat(100));
  });

  it('adds Accept-Encoding to a Vary the handler set', async () => {
    const response = await get('/compression/vary', 'gzip');
    expect(response.headers['content-encoding']).toBe('gzip');
    expect(varyTokens(response)).toEqual(['origin', 'accept-encoding']);
  });

  // Only the size threshold keeps the token identity: nothing excludes secrets
  // from compression. If the answer grows past 1 KiB, decide that first.
  it('leaves the CSRF token answer identity because it is under the 1 KiB threshold', async () => {
    const response = await get('/api/csrf-token', 'br');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-encoding']).toBeUndefined();
    expect(response.rawPayload.length).toBeLessThan(1024);
  });

  it.each([
    ['gzip', gzipSync],
    ['deflate', deflateSync],
    ['br', brotliCompressSync],
    ['zstd', zstdCompressSync],
  ])('inflates a %s request body before parsing it', async (coding, encode) => {
    const response = await post(coding, encode(Buffer.from(LARGE_JSON_TEXT)));
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(LARGE_JSON);
  });

  // New behaviour: br and gzip only, offered and preferred in that order.
  it('prefers br over zstd, which it no longer offers', async () => {
    const response = await get('/compression/json', 'gzip, deflate, br, zstd');
    expect(response.headers['content-encoding']).toBe('br');
  });

  it('no longer offers deflate', async () => {
    const response = await get('/compression/json', 'deflate');
    expect(response.headers['content-encoding']).toBeUndefined();
    expect(response.json()).toEqual(LARGE_JSON);
  });

  it('no longer encodes application/octet-stream', async () => {
    const response = await get('/compression/octet-stream', 'gzip');
    expect(response.headers['content-encoding']).toBeUndefined();
    expect(response.rawPayload.length).toBe(4096);
  });

  // New behaviour: the old plugin's errors were not framework errors, so both became 500s.
  it('refuses a request body in an unsupported coding with a 415', async () => {
    const response = await post('compress', LARGE_JSON_TEXT);
    expect(response.statusCode).toBe(415);
    expect(response.json()).toMatchObject({ code: 'system.validation' });
  });

  it('refuses a corrupt compressed request body with a 400', async () => {
    const response = await post('gzip', 'not gzip at all');
    expect(response.statusCode).toBe(400);
  });
});

describe('response compression (App)', () => {
  let app: App | undefined;

  afterEach(async () => {
    await app?.stop();
    app = undefined;
  });

  it('serves local uploads as identity with byte ranges', async () => {
    const root = await mkdtemp(join(tmpdir(), 'app-uploads-'));
    try {
      await mkdir(join(root, 'files', 'user-1'), { recursive: true });
      await writeFile(join(root, 'files', 'user-1', 'notes.txt'), 'n'.repeat(4096), 'utf8');
      const config: AppConfig = {
        ...createCoreBootConfig(),
        storage: {
          provider: 'local',
          rootPath: root,
          publicBaseUrl: '/uploads',
          signingSecret: 'core-boot-storage-signing-secret-0123456789',
        },
      };
      const { context } = createFallbackCommsState(config, {
        context: createCoreInfraContext(config),
      });
      app = new App(config, context);
      await app.init();
      await app.server.ready();

      const storage = context.storage;
      if (storage === undefined) throw new Error('Expected local storage to be composed');
      const response = await app.server.inject({
        method: 'GET',
        url: await storage.getSignedUrl('files/user-1/notes.txt', 60),
        headers: { 'accept-encoding': 'gzip' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-encoding']).toBeUndefined();
      expect(response.headers['content-length']).toBe('4096');
      expect(response.headers['accept-ranges']).toBe('bytes');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('encodes the Prometheus metrics of a full server', async () => {
    const config = createCoreBootConfig();
    app = new App(config, createCoreInfraContext(config));
    await app.init();
    await app.server.ready();

    const response = await app.server.inject({
      method: 'GET',
      url: '/metrics/prometheus',
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(response.rawPayload).toString('utf8')).toContain('bslt_event_loop_lag_ms');
  });

  it('encodes the Prometheus metrics of a probes-only server', async () => {
    const config = createCoreBootConfig();
    app = new App(config, createCoreInfraContext(config), { httpMode: 'probes-only' });
    await app.init();
    await app.server.ready();

    const response = await app.server.inject({
      method: 'GET',
      url: '/metrics/prometheus',
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-encoding']).toBe('gzip');
  });
});
