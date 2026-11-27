// main/apps/server/src/http/router.test.ts
import { HTTP_STATUS } from '@bslt/contract';
import { createHttpServer, type HttpServer } from '@bslt/server-system/http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAppRouterOptions, registerRoutes } from './router';

import type { AppContext } from '../bootstrap/context';

function createMinimalAppContext(): AppContext {
  const db = {
    healthCheck: vi.fn().mockResolvedValue(true),
    transaction: vi
      .fn()
      .mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => await fn(db)),
  };

  const ctx = {
    config: {
      env: 'test',
      app: { name: 'BSLT Test' },
      server: {
        appBaseUrl: 'https://app.bslt.dev',
        apiBaseUrl: 'https://app.bslt.dev/api',
      },
      storage: { provider: 'local' },
      email: { provider: 'console' },
      auth: {
        strategies: ['local'],
        jwt: { secret: 'test-jwt-secret-at-least-32-chars-long', accessTokenExpiry: '15m' },
      },
      billing: {
        enabled: false,
        provider: 'stripe',
        currency: 'USD',
        stripe: { secretKey: '', publishableKey: '', webhookSecret: '' },
        paypal: {
          clientId: '',
          clientSecret: '',
          webhookId: '',
          sandbox: true,
          brandName: 'BSLT',
        },
        urls: {
          portalReturnUrl: 'https://app.bslt.dev/billing',
          checkoutSuccessUrl: 'https://app.bslt.dev/billing?success=1',
          checkoutCancelUrl: 'https://app.bslt.dev/billing?canceled=1',
        },
      },
    },
    db,
    system: { db },
    repos: {},
    cache: { getStats: vi.fn().mockResolvedValue({ hits: 0, misses: 0, size: 0 }) },
    queue: { getStats: vi.fn().mockResolvedValue({ pending: 0, failed: 0 }) },
    pubsub: {
      getSubscriptionCount: vi.fn().mockReturnValue(0),
      publish: vi.fn(),
    },
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    contextualize: vi.fn(),
  } as unknown as AppContext;

  (ctx as unknown as { contextualize: ReturnType<typeof vi.fn> }).contextualize.mockReturnValue(
    ctx,
  );
  return ctx;
}

describe('app router composition', () => {
  const servers: HttpServer[] = [];

  afterEach(async () => {
    while (servers.length > 0) {
      const server = servers.pop();
      if (server !== undefined) {
        await server.close();
      }
    }
  });

  it('builds /api router options with the configured JWT secret and auth guard factory', () => {
    const ctx = createMinimalAppContext();
    const opts = createAppRouterOptions(ctx);

    expect(opts.prefix).toBe('/api');
    expect(opts.jwtSecret).toBe('test-jwt-secret-at-least-32-chars-long');
    expect(typeof opts.authGuardFactory).toBe('function');
  });

  it('registers only system probes in probes-only mode and omits platform API routes', async () => {
    const server = createHttpServer({ logger: false });
    servers.push(server);
    const ctx = createMinimalAppContext();

    const instances = await registerRoutes(server, ctx, {
      httpMode: 'probes-only',
      modules: [],
    });
    await server.ready();

    expect(instances.size).toBe(0);

    const health = await server.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(HTTP_STATUS.OK);

    const contextRes = await server.inject({ method: 'GET', url: '/api/platform/context' });
    expect(contextRes.statusCode).toBe(HTTP_STATUS.NOT_FOUND);
  });

  it('registers system, platform context, platform errors, and realtime routes in full mode', async () => {
    const server = createHttpServer({ logger: false });
    servers.push(server);
    const ctx = createMinimalAppContext();

    const instances = await registerRoutes(server, ctx, {
      httpMode: 'full',
      modules: [],
    });
    await server.ready();

    expect(instances.size).toBe(0);

    const health = await server.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(HTTP_STATUS.OK);

    const platformContext = await server.inject({ method: 'GET', url: '/api/platform/context' });
    expect(platformContext.statusCode).toBe(HTTP_STATUS.OK);

    const platformErrorsBad = await server.inject({
      method: 'POST',
      url: '/api/platform/errors',
      payload: { reports: [] },
    });
    expect(platformErrorsBad.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);

    const detailedUnauth = await server.inject({ method: 'GET', url: '/health/detailed' });
    expect(detailedUnauth.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);

    const realtimeAnon = await server.inject({
      method: 'POST',
      url: '/api/realtime/ticket',
      payload: {},
    });
    expect(realtimeAnon.statusCode).toBe(HTTP_STATUS.OK);
    const realtimeBody = JSON.parse(realtimeAnon.body) as { anonymous: boolean; ticket: null };
    expect(realtimeBody.anonymous).toBe(true);
    expect(realtimeBody.ticket).toBeNull();
  });
});
