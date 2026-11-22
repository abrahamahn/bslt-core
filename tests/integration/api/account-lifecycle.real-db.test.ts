// tests/integration/api/account-lifecycle.real-db.test.ts
/**
 * Account Lifecycle API Integration Tests (Real DB)
 *
 * The mock-backed user-management.integration.test.ts stubs the users
 * repository, so it cannot verify the deactivate → reactivate and
 * request-deletion → reactivate state transitions actually persist. This
 * suite drives them against isolated Postgres and asserts the resulting
 * users-row columns directly:
 * - deactivate stamps deactivated_at; reactivate clears it
 * - request-deletion stamps deleted_at + a 30-day grace window
 * - reactivating within the grace window cancels the pending deletion
 *
 * Requires a reachable Postgres; mandatory in CI via REQUIRE_REAL_DB.
 */

import { buildTestApp, parseJsonResponse, seedTestUser, type TestApp } from '@bslt/testing';
import { describeRealDb, type TestDatabase } from '@bslt/testing/real-db';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

function extractRefreshToken(setCookie: string | string[] | undefined): string {
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie !== undefined ? [setCookie] : [];
  const token = cookies
    .find((cookie) => cookie.startsWith('refreshToken='))
    ?.split(';')[0]
    ?.split('=')[1];
  expect(token).toBeDefined();
  return String(token);
}

interface LifecycleRow {
  deactivated_at: Date | null;
  deleted_at: Date | null;
  deletion_grace_period_ends: Date | null;
}

describeRealDb('Account Lifecycle API Integration (Real DB)', (realDb) => {
  let testServer: TestApp;
  let dbHarness: TestDatabase;

  const email = 'lifecycle-user@example.com';
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

  async function post(url: string, accessToken: string, sudoToken?: string): Promise<number> {
    const response = await testServer.inject({
      method: 'POST',
      url,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(sudoToken !== undefined ? { 'x-sudo-token': sudoToken } : {}),
      },
      payload: {},
    });
    return response.statusCode;
  }

  /** Elevate to sudo (deactivate/delete are sudo-protected destructive actions). */
  async function elevateSudo(accessToken: string): Promise<string> {
    const response = await testServer.inject({
      method: 'POST',
      url: '/api/auth/sudo',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { password },
    });
    expect(response.statusCode).toBe(200);
    return String((parseJsonResponse(response) as { sudoToken: unknown }).sudoToken);
  }

  async function lifecycleRow(): Promise<LifecycleRow> {
    const rows = await dbHarness.db.raw<LifecycleRow>(
      `SELECT deactivated_at, deleted_at, deletion_grace_period_ends
       FROM identity_users WHERE canonical_email = $1`,
      [email],
    );
    expect(rows[0]).toBeDefined();
    return rows[0] as LifecycleRow;
  }

  beforeAll(async () => {
    dbHarness = realDb.database;

    testServer = await buildTestApp({
      database: dbHarness,
      ports: {
        emailTemplates: {
          emailVerification: vi.fn().mockReturnValue({ subject: 'test', html: 'test', to: 'test' }),
          passwordReset: vi.fn().mockReturnValue({ subject: 'test', html: 'test', to: 'test' }),
          passwordChangedAlert: vi
            .fn()
            .mockReturnValue({ subject: 'test', html: 'test', to: 'test' }),
        },
      },
    });
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

  it('deactivate stamps deactivated_at; reactivate clears it', async () => {
    const token = await login();
    const sudoToken = await elevateSudo(token);

    expect(await post('/api/users/me/deactivate', token, sudoToken)).toBe(200);
    const afterDeactivate = await lifecycleRow();
    expect(afterDeactivate.deactivated_at).not.toBeNull();
    expect(afterDeactivate.deleted_at).toBeNull();

    expect(await post('/api/users/me/reactivate', token)).toBe(200);
    const afterReactivate = await lifecycleRow();
    expect(afterReactivate.deactivated_at).toBeNull();
  });

  it('request-deletion stamps deleted_at and a future grace window', async () => {
    const token = await login();
    const sudoToken = await elevateSudo(token);

    expect(await post('/api/users/me/delete', token, sudoToken)).toBe(200);
    const row = await lifecycleRow();
    expect(row.deleted_at).not.toBeNull();
    expect(row.deletion_grace_period_ends).not.toBeNull();
    expect(new Date(row.deletion_grace_period_ends as Date).getTime()).toBeGreaterThan(Date.now());
  });

  it('reactivating within the grace window cancels the pending deletion', async () => {
    const token = await login();
    const sudoToken = await elevateSudo(token);

    expect(await post('/api/users/me/delete', token, sudoToken)).toBe(200);
    expect((await lifecycleRow()).deleted_at).not.toBeNull();

    expect(await post('/api/users/me/reactivate', token)).toBe(200);
    const row = await lifecycleRow();
    expect(row.deleted_at).toBeNull();
    expect(row.deletion_grace_period_ends).toBeNull();
  });

  it('rejects deactivate and delete without a sudo token (403 SUDO_REQUIRED)', async () => {
    const token = await login();

    expect(await post('/api/users/me/deactivate', token)).toBe(403);
    expect(await post('/api/users/me/delete', token)).toBe(403);

    const row = await lifecycleRow();
    expect(row.deactivated_at).toBeNull();
    expect(row.deleted_at).toBeNull();
  });
});
