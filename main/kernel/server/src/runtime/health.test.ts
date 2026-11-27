// main/kernel/server/src/runtime/health.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkDbStatus, getDetailedHealth, logStartupSummary } from './health';

import type { HealthContext } from './types';

function createHealthContext(overrides?: {
  env?: 'development' | 'production' | 'test';
  dbHealthy?: boolean;
  dbReject?: Error;
  cacheReject?: Error;
  queueReject?: Error;
  billingEnabled?: boolean;
  notificationsEnabled?: boolean;
}): HealthContext {
  const dbHealthCheck =
    overrides?.dbReject !== undefined
      ? vi.fn<() => Promise<boolean>>().mockRejectedValue(overrides.dbReject)
      : vi.fn<() => Promise<boolean>>().mockResolvedValue(overrides?.dbHealthy ?? true);

  const cacheStats =
    overrides?.cacheReject !== undefined
      ? vi.fn().mockRejectedValue(overrides.cacheReject)
      : vi.fn().mockResolvedValue({ hits: 10, misses: 2, size: 5 });

  const queueStats =
    overrides?.queueReject !== undefined
      ? vi.fn().mockRejectedValue(overrides.queueReject)
      : vi.fn().mockResolvedValue({ pending: 1, failed: 0 });

  return {
    config: {
      env: overrides?.env ?? 'production',
      app: { name: 'BSLT' },
      database: { provider: 'postgresql' },
      cache: { useExternalProvider: false },
      storage: { provider: 'local' },
      email: { provider: 'console' },
      queue: { provider: 'postgres' },
      search: { provider: 'postgres' },
      billing: { enabled: overrides?.billingEnabled ?? false, provider: 'stripe' },
      notifications: { enabled: overrides?.notificationsEnabled ?? false, provider: 'web-push' },
      server: {
        appBaseUrl: 'https://app.bslt.dev',
        trustProxy: true,
        cors: {
          origin: ['https://app.bslt.dev'],
          credentials: true,
          methods: ['GET', 'POST'],
        },
      },
      auth: {
        strategies: ['local', 'google'],
        captcha: { enabled: false, provider: null },
        lockout: {
          maxAttempts: 5,
          lockoutDurationMs: 60_000,
          progressiveDelay: true,
          baseDelayMs: 500,
        },
        refreshToken: { expiryDays: 30, gracePeriodSeconds: 30 },
        cookie: { secure: true, sameSite: 'lax', httpOnly: true, path: '/' },
        jwt: {
          issuer: 'bslt',
          audience: 'bslt-web',
          accessTokenExpiry: '15m',
          previousSecret: '',
        },
      },
    } as unknown as HealthContext['config'],
    db: { healthCheck: dbHealthCheck },
    cache: { getStats: cacheStats },
    queue: { getStats: queueStats },
    pubsub: { getSubscriptionCount: vi.fn().mockReturnValue(3) },
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn(),
    } as unknown as HealthContext['log'],
  };
}

describe('runtime health checks', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('checks database health for healthy, false, and throwing database handles', async () => {
    const ok = await checkDbStatus(createHealthContext({ dbHealthy: true }));
    expect(ok.status).toBe('up');

    const failed = await checkDbStatus(createHealthContext({ dbHealthy: false }));
    expect(failed.status).toBe('down');

    const threw = await checkDbStatus(createHealthContext({ dbReject: new Error('pg down') }));
    expect(threw.status).toBe('down');
    expect(threw.message).toBe('pg down');
  });

  it('aggregates all subsystems into healthy status when optional schema and websocket options are omitted', async () => {
    const ctx = createHealthContext();
    const health = await getDetailedHealth(ctx);

    expect(health.status).toBe('healthy');
    expect(health.services['database']?.status).toBe('up');
    expect(health.services['schema']?.status).toBe('up');
    expect(health.services['cache']?.status).toBe('up');
    expect(health.services['queue']?.status).toBe('up');
    expect(health.services['email']?.status).toBe('up');
    expect(health.services['storage']?.status).toBe('up');
    expect(health.services['pubsub']?.status).toBe('up');
    expect(health.services['rateLimit']?.status).toBe('up');
    expect(health.services['websocket']).toBeUndefined();
  });

  it('reports degraded health when schema tables are missing, websocket is unregistered, or cache fails', async () => {
    const ctx = createHealthContext({ cacheReject: new Error('redis offline') });
    const health = await getDetailedHealth(ctx, {
      schemaValidator: vi.fn().mockResolvedValue({ valid: false, missingTables: ['audit_events'] }),
      totalTableCount: 12,
      websocketStats: { pluginRegistered: false, activeConnections: 0 },
    });

    expect(health.status).toBe('degraded');
    expect(health.services['cache']?.status).toBe('down');
    expect(health.services['schema']?.status).toBe('down');
    expect(health.services['websocket']?.status).toBe('down');
  });

  it('logs structured startup diagnostics in production without printing the dev stdout banner', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const ctx = createHealthContext({ env: 'production' });

    await logStartupSummary(ctx, { host: '0.0.0.0', port: 8080, routeCount: 42 });

    expect(ctx.log.info).toHaveBeenCalledTimes(2);
    expect(ctx.log.info).toHaveBeenNthCalledWith(
      1,
      'Startup Summary',
      expect.objectContaining({
        server: { host: '0.0.0.0', port: 8080, url: 'http://localhost:8080' },
      }),
    );
    expect(ctx.log.info).toHaveBeenNthCalledWith(
      2,
      'Startup Config Diagnostics',
      expect.objectContaining({ env: 'production' }),
    );
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('prints redacted human-readable startup summary to stdout in development mode', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const ctx = createHealthContext({
      env: 'development',
      billingEnabled: true,
      notificationsEnabled: true,
    });

    await logStartupSummary(ctx, { host: '127.0.0.1', port: 3000, routeCount: 15 });

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const printed = String(stdoutSpy.mock.calls[0]?.[0]);
    expect(printed).toContain('BSLT Server');
    expect(printed).toContain('http://127.0.0.1:3000');
    expect(printed).toContain('stripe');
    expect(printed).toContain('web-push');
  });
});
