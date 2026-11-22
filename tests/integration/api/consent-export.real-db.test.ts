// tests/integration/api/consent-export.real-db.test.ts
/**
 * Consent & Data-Export API Integration Tests (Real DB)
 *
 * The mock-backed consent-export-legal.integration.test.ts stubs the
 * compliance repositories, so it cannot verify that consent preference
 * changes and GDPR export requests actually persist. This suite drives them
 * through isolated Postgres and asserts the compliance rows directly:
 * - a consent preference update writes a compliance_consents row and round-trips
 *   through the read endpoint
 * - a data-export request creates a compliance_data_requests row whose status is
 *   then visible through the status endpoint
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

describeRealDb('Consent & Data-Export API Integration (Real DB)', (realDb) => {
  let testServer: TestApp;
  let dbHarness: TestDatabase;

  const email = 'consent-user@example.com';
  const password = 'TestPassword123!';

  async function login(): Promise<string> {
    const loginResponse = await testServer.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { identifier: email, password },
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

  async function getConsent(token: string): Promise<Record<string, boolean>> {
    const response = await testServer.inject({
      method: 'GET',
      url: '/api/users/me/consent',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    return (parseJsonResponse(response) as { preferences: Record<string, boolean> }).preferences;
  }

  beforeAll(async () => {
    dbHarness = realDb.database;

    testServer = await buildTestApp({ database: dbHarness });
  }, 60_000);

  afterAll(async () => {
    await testServer?.close();
  });

  beforeEach(async () => {
    try {
      await dbHarness.truncate('identity_users CASCADE');
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
      await dbHarness.truncate('identity_users CASCADE');
    }
    await seedTestUser(dbHarness.connectionString, { email, password });
  });

  it('a consent preference update persists and round-trips', async () => {
    const token = await login();

    // Defaults to not-granted (null/unset) before any choice is recorded.
    expect((await getConsent(token))['analytics']).not.toBe(true);

    const update = await testServer.inject({
      method: 'PATCH',
      url: '/api/users/me/consent/update',
      headers: { authorization: `Bearer ${token}` },
      payload: { analytics: true },
    });
    expect(update.statusCode).toBe(200);

    // Re-read proves the toggle persisted, not just echoed.
    expect((await getConsent(token))['analytics']).toBe(true);

    const rows = await dbHarness.db.raw<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM compliance_consents c
       JOIN identity_users u ON u.id = c.user_id
       WHERE u.canonical_email = $1
         AND c.record_type = 'consent_preference'
         AND c.consent_type = 'analytics'
         AND c.granted = true`,
      [email],
    );
    expect(Number(rows[0]?.count)).toBeGreaterThanOrEqual(1);
  });

  it('a data-export request creates a row and exposes its status', async () => {
    const token = await login();

    const request = await testServer.inject({
      method: 'POST',
      url: '/api/users/me/export',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(request.statusCode).toBe(200);
    const created = (
      parseJsonResponse(request) as { exportRequest: { id: string; status: string } }
    ).exportRequest;
    expect(created.id).toBeTruthy();
    // The request is processed inline, so it is ready immediately — not stuck "pending".
    expect(created.status).toBe('completed');

    const rows = await dbHarness.db.raw<{ type: string }>(
      `SELECT type FROM compliance_data_requests WHERE id = $1`,
      [created.id],
    );
    expect(rows[0]?.type).toBe('export');

    const status = await testServer.inject({
      method: 'GET',
      url: `/api/users/me/export/${created.id}/status`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(status.statusCode).toBe(200);
    const statusBody = (
      parseJsonResponse(status) as { exportRequest: { id: string; status: string } }
    ).exportRequest;
    expect(statusBody.id).toBe(created.id);
    expect(statusBody.status).toBe('completed');

    // The completed export is downloadable and contains the user's own data.
    const download = await testServer.inject({
      method: 'GET',
      url: `/api/users/me/export/${created.id}/download`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(download.statusCode).toBe(200);
    const downloadBody = parseJsonResponse(download) as {
      export: { profile: { email: string } };
    };
    expect(downloadBody.export.profile.email).toBeTruthy();
  });
});
