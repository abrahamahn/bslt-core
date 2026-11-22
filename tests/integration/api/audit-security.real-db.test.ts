// tests/integration/api/audit-security.real-db.test.ts
/**
 * Admin Security/Audit Events API Integration Tests (Real DB)
 *
 * The mock-backed audit.integration.test.ts stubs the security/audit
 * repositories, so it never exercises the actual SQL filtering and pagination.
 * This suite seeds real security_events and audit_events rows in isolated
 * Postgres and drives the admin endpoints:
 * - POST /admin/security/events lists seeded events and the nested severity
 *   filter narrows the result to matching rows
 * - GET /admin/security/events/:id returns a single event by id
 * - GET /admin/audit-events lists seeded audit rows
 *
 * Requires a reachable Postgres; mandatory in CI via REQUIRE_REAL_DB.
 */

import { buildTestApp, parseJsonResponse, seedTestUser, type TestApp } from '@bslt/testing';
import { describeRealDb, type TestDatabase } from '@bslt/testing/real-db';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

function extractRefreshToken(setCookie: string | string[] | undefined): string {
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie !== undefined ? [setCookie] : [];
  const token = cookies
    .find((cookie) => cookie.startsWith('refreshToken='))
    ?.split(';')[0]
    ?.split('=')[1];
  expect(token).toBeDefined();
  return String(token);
}

interface SecurityEvent {
  id: string;
  severity: string;
}

describeRealDb('Admin Security/Audit Events API Integration (Real DB)', (realDb) => {
  let testServer: TestApp;
  let dbHarness: TestDatabase;

  const adminEmail = 'audit-admin@example.com';
  const password = 'TestPassword123!';

  async function loginAdmin(): Promise<string> {
    const loginResponse = await testServer.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { identifier: adminEmail, password },
    });
    expect(loginResponse.statusCode).toBe(200);
    const refreshToken = extractRefreshToken(loginResponse.headers['set-cookie']);

    const refresh = await testServer.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { cookie: `refreshToken=${refreshToken}` },
    });
    expect(refresh.statusCode).toBe(200);
    return String((parseJsonResponse(refresh) as { token: unknown }).token);
  }

  async function seedSecurityEvent(eventType: string, severity: string): Promise<void> {
    const auditSeverity =
      severity === 'critical'
        ? 'critical'
        : severity === 'high'
          ? 'error'
          : severity === 'medium'
            ? 'warn'
            : 'info';
    await dbHarness.db.execute({
      text: `INSERT INTO audit_log (action, category, severity, resource, subject_email, metadata)
             VALUES ($1, 'security', $2, 'user', 'subject@example.com', '{}'::jsonb)`,
      values: [`security.${eventType}`, auditSeverity],
    });
  }

  async function listSecurityEvents(
    token: string,
    filter: Record<string, unknown> = {},
  ): Promise<{ data: SecurityEvent[]; total: number }> {
    const response = await testServer.inject({
      method: 'POST',
      url: '/api/admin/security/events',
      headers: { authorization: `Bearer ${token}` },
      payload: { filter },
    });
    expect(response.statusCode).toBe(200);
    return parseJsonResponse(response) as { data: SecurityEvent[]; total: number };
  }

  beforeAll(async () => {
    dbHarness = realDb.database;

    testServer = await buildTestApp({ database: dbHarness });
  }, 60_000);

  afterAll(async () => {
    await testServer?.close();
  });

  beforeEach(async () => {
    await dbHarness.truncate('identity_users, audit_log, audit_activity CASCADE');
    await seedTestUser(dbHarness.connectionString, {
      email: adminEmail,
      password,
      role: 'admin',
    });
  });

  it('lists seeded security events and narrows by severity filter', async () => {
    await seedSecurityEvent('account_locked', 'low');
    await seedSecurityEvent('token_reuse_detected', 'high');
    await seedSecurityEvent('token_family_revoked', 'critical');
    const token = await loginAdmin();

    // >= 3 because logging in records its own security event alongside the seeds.
    const all = await listSecurityEvents(token);
    expect(all.data.length).toBeGreaterThanOrEqual(3);

    // The severity filter is the precise assertion: only the seeded 'critical' row.
    const critical = await listSecurityEvents(token, { severity: 'critical' });
    expect(critical.data.length).toBe(1);
    expect(critical.data[0]?.severity).toBe('critical');
  });

  it('returns a single security event by id', async () => {
    await seedSecurityEvent('account_locked', 'high');
    const token = await loginAdmin();

    const { data } = await listSecurityEvents(token);
    const target = data[0];
    expect(target).toBeDefined();

    const response = await testServer.inject({
      method: 'GET',
      url: `/api/admin/security/events/${String(target?.id)}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
  });

  it('lists seeded audit events', async () => {
    const token = await loginAdmin();
    await dbHarness.db.execute({
      text: `INSERT INTO audit_log (action, category, severity, resource, metadata)
             VALUES ('user.account_locked', 'security', 'warn', 'user', '{}'::jsonb)`,
      values: [],
    });

    const response = await testServer.inject({
      method: 'GET',
      url: '/api/admin/audit-events',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = parseJsonResponse(response) as { data?: unknown[]; events?: unknown[] };
    const rows = body.data ?? body.events ?? [];
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
