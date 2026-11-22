// main/apps/server/src/http/system-routes.test.ts
/**
 * System route auth-surface tests.
 *
 * /health, /health/ready, /health/live, /metrics, and /metrics/prometheus are
 * public infrastructure probes. /health/detailed exposes provider names and
 * per-service internals, so it must sit behind the admin guard like the
 * admin module routes.
 */

import { HTTP_STATUS } from '@bslt/contract';
import {
  createHttpServer,
  registerRouteMap,
  type AuthGuardFactory,
  type HttpServer,
} from '@bslt/server-system/http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { systemRoutes } from './system-routes';

const PUBLIC_PATHS = ['health', 'health/ready', 'health/live', 'metrics', 'metrics/prometheus'];
const ADMIN_TOKEN = 'Bearer admin-token';

describe('systemRoutes definitions', () => {
  it.each(PUBLIC_PATHS)('%s stays public', (path) => {
    expect(systemRoutes.get(path)?.isPublic).toBe(true);
  });

  it('health/detailed is protected and requires the admin role', () => {
    const route = systemRoutes.get('health/detailed');
    expect(route?.isPublic).toBe(false);
    expect(route?.roles).toEqual(['admin']);
  });
});

describe('systemRoutes registered behavior', () => {
  let server: HttpServer;
  const guardedRoles: string[][] = [];
  const mockDb = { healthCheck: vi.fn().mockResolvedValue(true) };

  beforeAll(async () => {
    const ctx = {
      db: mockDb,
      cache: { getStats: vi.fn().mockResolvedValue({ hits: 0, misses: 0, size: 0 }) },
      queue: { getStats: vi.fn().mockResolvedValue({ pending: 0, failed: 0 }) },
      pubsub: { getSubscriptionCount: vi.fn().mockReturnValue(0) },
      config: { email: { provider: 'console' }, storage: { provider: 'local' } },
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    };

    // Enforcing guard: records the roles each protected route registers with
    // and rejects requests without the admin bearer token.
    const authGuardFactory: AuthGuardFactory = (_secret, ...allowedRoles) => {
      guardedRoles.push(allowedRoles);
      return (request, reply) => {
        if (request.headers['authorization'] !== ADMIN_TOKEN) {
          reply.status(HTTP_STATUS.UNAUTHORIZED).send({ message: 'Unauthorized' });
        }
      };
    };

    server = createHttpServer({ logger: false });
    registerRouteMap(server as Parameters<typeof registerRouteMap>[0], ctx, systemRoutes, {
      prefix: '',
      jwtSecret: 'test-secret',
      authGuardFactory,
    });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    mockDb.healthCheck.mockClear();
    mockDb.healthCheck.mockResolvedValue(true);
  });

  it('only health/detailed registers an auth guard, with the admin role', () => {
    expect(guardedRoles).toEqual([['admin']]);
  });

  it('rejects unauthenticated GET /health/detailed with 401 without running checks', async () => {
    const response = await server.inject({ method: 'GET', url: '/health/detailed' });

    expect(response.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect(mockDb.healthCheck).not.toHaveBeenCalled();
  });

  it('rejects GET /health/detailed with a non-admin token', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/health/detailed',
      headers: { authorization: 'Bearer some-other-token' },
    });

    expect(response.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
  });

  it('returns detailed service health for admin-authenticated requests', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/health/detailed',
      headers: { authorization: ADMIN_TOKEN },
    });

    expect(response.statusCode).toBe(HTTP_STATUS.OK);
    const body = JSON.parse(response.body) as {
      status: string;
      services: Record<string, { status: string }>;
    };
    expect(body.status).toBe('healthy');
    expect(body.services['database']?.status).toBe('up');
  });

  it('returns 503 to admins when the database is down', async () => {
    mockDb.healthCheck.mockRejectedValue(new Error('Connection refused'));

    const response = await server.inject({
      method: 'GET',
      url: '/health/detailed',
      headers: { authorization: ADMIN_TOKEN },
    });

    expect(response.statusCode).toBe(HTTP_STATUS.SERVICE_UNAVAILABLE);
  });

  it('keeps GET /health public (no auth header required)', async () => {
    const response = await server.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(HTTP_STATUS.OK);
    const body = JSON.parse(response.body) as { status: string };
    expect(body.status).toBe('ok');
  });

  it('keeps GET /metrics public (no auth header required)', async () => {
    const response = await server.inject({ method: 'GET', url: '/metrics' });

    expect(response.statusCode).toBe(HTTP_STATUS.OK);
  });

  /**
   * The geo probe answers "is the jurisdiction gate actually armed?" — a
   * question that is invisible from inside the app and from a CDN dashboard.
   */
  describe('GET /health/geo', () => {
    it('is public and reports the resolved geo inputs for this request', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/health/geo',
        headers: { 'cf-ipcountry': 'US' },
      });

      expect(response.statusCode).toBe(HTTP_STATUS.OK);
      const body = JSON.parse(response.body) as {
        provider: string;
        received: Record<string, string | null>;
        verdict: string;
      };
      expect(typeof body.provider).toBe('string');
      expect(body.received).toBeDefined();
      expect(body.verdict).toContain('region header');
    });

    it('says the region gate is inert when no region header arrives', async () => {
      const response = await server.inject({ method: 'GET', url: '/health/geo' });

      const body = JSON.parse(response.body) as { verdict: string };
      expect(body.verdict).toContain('NO region header');
    });

    /**
     * The probe rides on /health, which is the liveness check. It must never be
     * the reason /health fails — a context without geo config reports "not
     * configured" instead of throwing. This is exactly what broke when the
     * probe was first added.
     */
    it('never breaks /health, even with geo config absent', async () => {
      const response = await server.inject({ method: 'GET', url: '/health' });

      expect(response.statusCode).toBe(HTTP_STATUS.OK);
      const body = JSON.parse(response.body) as {
        status: string;
        geo: { provider: string; regionHeaderPresent: boolean };
      };
      expect(body.status).toBe('ok');
      expect(body.geo).toBeDefined();
      expect(body.geo.regionHeaderPresent).toBe(false);
    });
  });
});
