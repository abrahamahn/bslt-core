// tests/integration/api/audit.integration.test.ts
/**
 * Audit, Security Events, and Activity Feed API Integration Tests
 *
 * Mounts `@bslt/audit/server` via `registerServerModules` on `buildTestServer()`
 * and exercises all 6 HTTP endpoints through `fastify.inject()`:
 * - GET /api/activities (user auth)
 * - GET /api/admin/audit-events (admin auth)
 * - POST /api/admin/security/events (admin auth)
 * - GET /api/admin/security/events/:id (admin auth)
 * - GET /api/admin/security/metrics (admin auth)
 * - POST /api/admin/security/export (admin auth)
 */

import { auditServer } from '@bslt/audit/server';
import { createAuthGuard } from '@bslt/identity/server';
import { registerServerModules } from '@bslt/server-system/module';
import {
  buildAuthenticatedRequest,
  buildTestServer,
  createAdminJwt,
  createTestJwt,
  parseJsonResponse,
  type TestServer,
} from '@bslt/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbClient } from '@bslt/db';
import type { AuthGuardFactory } from '@bslt/server/http';
import type { Logger } from '@bslt/server-system/logger';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const MISSING_EVENT_ID = '33333333-3333-4333-8333-333333333333';
const ACTIVITY_ID = '44444444-4444-4444-8444-444444444444';

const noopLogger: Logger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: () => noopLogger,
};

function createMockAuditDb() {
  const raw = vi.fn().mockResolvedValue([]);
  const db = {
    query: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn().mockResolvedValue(null),
    execute: vi.fn().mockResolvedValue(0),
    transaction: async <T>(fn: (tx: DbClient) => Promise<T>): Promise<T> => fn(db),
    raw,
    healthCheck: vi.fn().mockResolvedValue(true),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as DbClient;

  return { db, raw };
}

describe('Audit Module HTTP Integration Tests', () => {
  let testServer: TestServer;
  let mockStore: ReturnType<typeof createMockAuditDb>;

  beforeAll(async () => {
    testServer = await buildTestServer();
    mockStore = createMockAuditDb();

    registerServerModules(testServer.server, { db: mockStore.db }, [auditServer], {
      resolveDb: () => mockStore.db,
      validateResponses: true,
      extraContextContributions: [
        () => ({
          eligibility: {
            tosAccepted: true,
            emailVerified: true,
            ageVerifiedFor: null,
          },
        }),
      ],
      kernel: {
        db: { system: (fn) => fn(mockStore.db) },
        log: noopLogger,
        clock: { now: () => new Date('2026-06-01T12:00:00.000Z') },
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
    mockStore.raw.mockReset().mockResolvedValue([]);
  });

  describe('unauthenticated rejection (401)', () => {
    it('rejects GET /api/activities without token', async () => {
      const response = await testServer.inject({ method: 'GET', url: '/api/activities' });
      expect(response.statusCode).toBe(401);
    });

    it('rejects GET /api/admin/audit-events without token', async () => {
      const response = await testServer.inject({ method: 'GET', url: '/api/admin/audit-events' });
      expect(response.statusCode).toBe(401);
    });

    it('rejects POST /api/admin/security/events without token', async () => {
      const response = await testServer.inject({
        method: 'POST',
        url: '/api/admin/security/events',
        payload: {},
      });
      expect(response.statusCode).toBe(401);
    });

    it('rejects GET /api/admin/security/events/:id without token', async () => {
      const response = await testServer.inject({
        method: 'GET',
        url: `/api/admin/security/events/${EVENT_ID}`,
      });
      expect(response.statusCode).toBe(401);
    });

    it('rejects GET /api/admin/security/metrics without token', async () => {
      const response = await testServer.inject({
        method: 'GET',
        url: '/api/admin/security/metrics',
      });
      expect(response.statusCode).toBe(401);
    });

    it('rejects POST /api/admin/security/export without token', async () => {
      const response = await testServer.inject({
        method: 'POST',
        url: '/api/admin/security/export',
        payload: { format: 'json' },
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('non-admin rejection (403)', () => {
    it('rejects GET /api/admin/audit-events for non-admin user', async () => {
      const response = await testServer.inject(
        buildAuthenticatedRequest({
          method: 'GET',
          url: '/api/admin/audit-events',
          accessToken: createTestJwt({ userId: USER_ID, role: 'user' }),
        }),
      );
      expect(response.statusCode).toBe(403);
    });

    it('rejects POST /api/admin/security/events for non-admin user', async () => {
      const response = await testServer.inject(
        buildAuthenticatedRequest({
          method: 'POST',
          url: '/api/admin/security/events',
          accessToken: createTestJwt({ userId: USER_ID, role: 'user' }),
          payload: {},
        }),
      );
      expect(response.statusCode).toBe(403);
    });

    it('rejects GET /api/admin/security/events/:id for non-admin user', async () => {
      const response = await testServer.inject(
        buildAuthenticatedRequest({
          method: 'GET',
          url: `/api/admin/security/events/${EVENT_ID}`,
          accessToken: createTestJwt({ userId: USER_ID, role: 'user' }),
        }),
      );
      expect(response.statusCode).toBe(403);
    });

    it('rejects GET /api/admin/security/metrics for non-admin user', async () => {
      const response = await testServer.inject(
        buildAuthenticatedRequest({
          method: 'GET',
          url: '/api/admin/security/metrics',
          accessToken: createTestJwt({ userId: USER_ID, role: 'user' }),
        }),
      );
      expect(response.statusCode).toBe(403);
    });

    it('rejects POST /api/admin/security/export for non-admin user', async () => {
      const response = await testServer.inject(
        buildAuthenticatedRequest({
          method: 'POST',
          url: '/api/admin/security/export',
          accessToken: createTestJwt({ userId: USER_ID, role: 'user' }),
          payload: { format: 'json' },
        }),
      );
      expect(response.statusCode).toBe(403);
    });
  });

  describe('schema validation & not-found rejection (400 / 404)', () => {
    it('rejects invalid security metrics period with 400 before querying', async () => {
      const response = await testServer.inject(
        buildAuthenticatedRequest({
          method: 'GET',
          url: '/api/admin/security/metrics?period=year',
          accessToken: createAdminJwt(),
        }),
      );
      expect(response.statusCode).toBe(400);
      expect(mockStore.raw).not.toHaveBeenCalled();
    });

    it('rejects invalid audit-events limit past ceiling with 400', async () => {
      const response = await testServer.inject(
        buildAuthenticatedRequest({
          method: 'GET',
          url: '/api/admin/audit-events?limit=501',
          accessToken: createAdminJwt(),
        }),
      );
      expect(response.statusCode).toBe(400);
      expect(mockStore.raw).not.toHaveBeenCalled();
    });

    it('rejects invalid export format with 400', async () => {
      const response = await testServer.inject(
        buildAuthenticatedRequest({
          method: 'POST',
          url: '/api/admin/security/export',
          accessToken: createAdminJwt(),
          payload: { format: 'xml' },
        }),
      );
      expect(response.statusCode).toBe(400);
      expect(mockStore.raw).not.toHaveBeenCalled();
    });

    it('returns 404 when security event id does not exist', async () => {
      mockStore.raw.mockResolvedValueOnce([]);
      const response = await testServer.inject(
        buildAuthenticatedRequest({
          method: 'GET',
          url: `/api/admin/security/events/${MISSING_EVENT_ID}`,
          accessToken: createAdminJwt(),
        }),
      );
      expect(response.statusCode).toBe(404);
    });
  });

  describe('happy paths (200)', () => {
    it('returns viewer activities from GET /api/activities', async () => {
      mockStore.raw.mockResolvedValueOnce([
        {
          id: ACTIVITY_ID,
          org_id: null,
          actor_id: USER_ID,
          actor_type: 'user',
          action: 'tasks.task.created',
          resource_type: 'task',
          resource_id: 'task-1',
          description: 'Created task',
          metadata: { title: 'Write tests' },
          ip_address: '127.0.0.1',
          user_agent: 'vitest',
          idempotency_key: null,
          created_at: new Date('2026-06-01T11:00:00.000Z'),
        },
      ]);

      const response = await testServer.inject(
        buildAuthenticatedRequest({
          method: 'GET',
          url: '/api/activities?limit=10',
          accessToken: createTestJwt({ userId: USER_ID, role: 'user' }),
        }),
      );

      expect(response.statusCode).toBe(200);
      const body = parseJsonResponse(response) as {
        activities: Array<{ id: string; action: string }>;
      };
      expect(body.activities).toHaveLength(1);
      expect(body.activities[0]).toMatchObject({
        id: ACTIVITY_ID,
        action: 'tasks.task.created',
      });
    });

    it('lists audit events and maps security events, metrics, and JSON/CSV exports', async () => {
      const seededRow = {
        id: EVENT_ID,
        org_id: null,
        actor_id: USER_ID,
        subject_email: 'subject@example.com',
        action: 'security.suspicious_login',
        category: 'security',
        severity: 'error',
        resource: 'user',
        resource_id: USER_ID,
        metadata: { reason: 'new_ip' },
        ip_address: '127.0.0.1',
        user_agent: 'vitest',
        idempotency_key: null,
        created_at: new Date('2026-06-01T11:30:00.000Z'),
      };
      const adminJwt = createAdminJwt();

      mockStore.raw.mockResolvedValueOnce([seededRow]);
      const auditRes = await testServer.inject(
        buildAuthenticatedRequest({
          method: 'GET',
          url: '/api/admin/audit-events?category=security&limit=5',
          accessToken: adminJwt,
        }),
      );
      expect(auditRes.statusCode).toBe(200);
      const auditBody = parseJsonResponse(auditRes) as {
        events: Array<{ id: string; action: string }>;
        truncated: boolean;
      };
      expect(auditBody.events).toHaveLength(1);
      expect(auditBody.truncated).toBe(false);

      mockStore.raw.mockResolvedValueOnce([seededRow]).mockResolvedValueOnce([{ count: 1 }]);
      const secListRes = await testServer.inject(
        buildAuthenticatedRequest({
          method: 'POST',
          url: '/api/admin/security/events',
          accessToken: adminJwt,
          payload: { page: 1, limit: 10, filter: { severity: 'high' } },
        }),
      );
      expect(secListRes.statusCode).toBe(200);
      const secListBody = parseJsonResponse(secListRes) as {
        data: Array<{ id: string; eventType: string; severity: string }>;
        total: number;
      };
      expect(secListBody.total).toBe(1);
      expect(secListBody.data[0]).toMatchObject({
        id: EVENT_ID,
        eventType: 'suspicious_login',
        severity: 'high',
      });

      mockStore.raw.mockResolvedValueOnce([seededRow]);
      const detailRes = await testServer.inject(
        buildAuthenticatedRequest({
          method: 'GET',
          url: `/api/admin/security/events/${EVENT_ID}`,
          accessToken: adminJwt,
        }),
      );
      expect(detailRes.statusCode).toBe(200);
      expect(parseJsonResponse(detailRes)).toMatchObject({
        id: EVENT_ID,
        eventType: 'suspicious_login',
        severity: 'high',
      });

      mockStore.raw.mockResolvedValueOnce([seededRow]);
      const metricsRes = await testServer.inject(
        buildAuthenticatedRequest({
          method: 'GET',
          url: '/api/admin/security/metrics?period=day',
          accessToken: adminJwt,
        }),
      );
      expect(metricsRes.statusCode).toBe(200);
      expect(parseJsonResponse(metricsRes)).toMatchObject({
        totalEvents: 1,
        highEvents: 1,
        suspiciousLoginCount: 1,
        period: 'day',
      });

      mockStore.raw.mockResolvedValueOnce([seededRow]);
      const exportRes = await testServer.inject(
        buildAuthenticatedRequest({
          method: 'POST',
          url: '/api/admin/security/export',
          accessToken: adminJwt,
          payload: { format: 'csv', filter: { severity: 'high' } },
        }),
      );
      expect(exportRes.statusCode).toBe(200);
      const exportBody = parseJsonResponse(exportRes) as {
        data: string;
        filename: string;
        contentType: string;
      };
      expect(exportBody.contentType).toBe('text/csv');
      expect(exportBody.filename.endsWith('.csv')).toBe(true);
      expect(exportBody.data).toContain(EVENT_ID);
    });
  });
});
