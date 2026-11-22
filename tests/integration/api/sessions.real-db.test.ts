// tests/integration/api/sessions.real-db.test.ts
/**
 * Sessions API Integration Tests (Real DB)
 *
 * Verifies session lifecycle against a real isolated database — the paths the
 * mock-backed sessions.integration.test.ts cannot see because it stubs the
 * repository:
 * - each login persists a distinct user_sessions row
 * - the listing marks exactly the calling token's session as current
 * - revoking one session deletes that row and kills its refresh token
 * - revoke-all removes every session except the caller's, invalidating their
 *   refresh tokens while the caller's keeps working, and refuses every access
 *   token issued before it (token_version bump, as logout-all does)
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

interface Session {
  refreshToken: string;
  accessToken: string;
}

describeRealDb('Sessions API Integration (Real DB)', (realDb) => {
  let testServer: TestApp;
  let dbHarness: TestDatabase;

  /**
   * Log in from a named device (new session row) and exchange the refresh
   * cookie for an access token. A distinct `x-device-id` keeps each login a
   * separate session; same-device logins supersede the prior one.
   */
  async function login(email: string, password: string, deviceId: string): Promise<Session> {
    const loginResponse = await testServer.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-device-id': deviceId },
      payload: { identifier: email, password },
    });
    expect(loginResponse.statusCode).toBe(200);
    const refreshToken = extractRefreshToken(loginResponse.headers['set-cookie']);

    const refresh = await testServer.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { cookie: `refreshToken=${refreshToken}`, 'x-device-id': deviceId },
    });
    expect(refresh.statusCode).toBe(200);
    // Refresh rotates the token — the live token is the one set on the refresh
    // response, not the original login cookie (reusing the latter is detected
    // as token reuse and revokes the family).
    const rotatedToken = extractRefreshToken(refresh.headers['set-cookie']);
    const accessToken = String((parseJsonResponse(refresh) as { token: unknown }).token);
    return { refreshToken: rotatedToken, accessToken };
  }

  /**
   * The "current" session is resolved from the refresh-token cookie (not the
   * access token), so management requests must carry the caller's cookie.
   */
  function authHeaders(session: Session): Record<string, string> {
    return {
      authorization: `Bearer ${session.accessToken}`,
      cookie: `refreshToken=${session.refreshToken}`,
    };
  }

  async function listSessions(
    session: Session,
  ): Promise<Array<{ id: string; isCurrent: boolean }>> {
    const response = await testServer.inject({
      method: 'GET',
      url: '/api/users/me/sessions',
      headers: authHeaders(session),
    });
    expect(response.statusCode).toBe(200);
    return (parseJsonResponse(response) as { sessions: Array<{ id: string; isCurrent: boolean }> })
      .sessions;
  }

  async function refreshStatus(refreshToken: string): Promise<number> {
    const response = await testServer.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { cookie: `refreshToken=${refreshToken}` },
    });
    return response.statusCode;
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
  });

  const email = 'sessions-user@example.com';
  const password = 'TestPassword123!';

  it('persists a distinct active session row per device', async () => {
    await seedTestUser(dbHarness.connectionString, { email, password });
    await login(email, password, 'device-a-0000000001');
    await login(email, password, 'device-b-0000000002');
    const a = await login(email, password, 'device-c-0000000003');

    const rows = await dbHarness.db.raw<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM identity_sessions s
       JOIN identity_users u ON u.id = s.user_id
       WHERE u.canonical_email = $1 AND s.revoked_at IS NULL`,
      [email],
    );
    expect(Number(rows[0]?.count)).toBe(3);

    const sessions = await listSessions(a);
    expect(sessions).toHaveLength(3);
    expect(sessions.filter((s) => s.isCurrent)).toHaveLength(1);
  });

  it('a same-device login supersedes the prior session', async () => {
    await seedTestUser(dbHarness.connectionString, { email, password });
    const first = await login(email, password, 'shared-device-000001');
    const second = await login(email, password, 'shared-device-000001');

    // Only the latest session on that device survives.
    expect(await listSessions(second)).toHaveLength(1);
    expect(await refreshStatus(first.refreshToken)).toBe(401);
    expect(await refreshStatus(second.refreshToken)).toBe(200);
  });

  it('revoking one session deletes its row and kills its refresh token', async () => {
    await seedTestUser(dbHarness.connectionString, { email, password });
    const other = await login(email, password, 'device-a-0000000001');
    const current = await login(email, password, 'device-b-0000000002');

    // With exactly two sessions, the single non-current id is `other`'s.
    const sessions = await listSessions(current);
    expect(sessions).toHaveLength(2);
    const target = sessions.find((s) => !s.isCurrent);
    expect(target).toBeDefined();

    const del = await testServer.inject({
      method: 'DELETE',
      url: `/api/users/me/sessions/${String(target?.id)}`,
      headers: authHeaders(current),
    });
    expect(del.statusCode).toBe(200);
    expect((parseJsonResponse(del) as { success: boolean }).success).toBe(true);

    expect(await listSessions(current)).toHaveLength(1);
    expect(await refreshStatus(other.refreshToken)).toBe(401);
    expect(await refreshStatus(current.refreshToken)).toBe(200);
  });

  it('revoke-all removes every session except the caller, invalidating their refresh tokens', async () => {
    await seedTestUser(dbHarness.connectionString, { email, password });
    const first = await login(email, password, 'device-a-0000000001');
    const second = await login(email, password, 'device-b-0000000002');
    const current = await login(email, password, 'device-c-0000000003');

    const response = await testServer.inject({
      method: 'POST',
      url: '/api/users/me/sessions/revoke-all',
      headers: authHeaders(current),
    });
    expect(response.statusCode).toBe(200);
    const body = parseJsonResponse(response) as { success: boolean; revokedCount: number };
    expect(body.success).toBe(true);
    expect(body.revokedCount).toBe(2);

    // revoke-all also retires every earlier access token (see the next test),
    // so the caller's session continues on a refreshed one.
    const refresh = await testServer.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { cookie: `refreshToken=${current.refreshToken}` },
    });
    expect(refresh.statusCode).toBe(200);
    const refreshed: Session = {
      refreshToken: extractRefreshToken(refresh.headers['set-cookie']),
      accessToken: String((parseJsonResponse(refresh) as { token: unknown }).token),
    };

    const remaining = await listSessions(refreshed);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.isCurrent).toBe(true);

    expect(await refreshStatus(first.refreshToken)).toBe(401);
    expect(await refreshStatus(second.refreshToken)).toBe(401);
  });

  it('the active-token-per-family index exists beside the family index', async () => {
    const rows = await dbHarness.adminDb.raw<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE tablename = 'identity_refresh_tokens'",
    );
    const defs = rows.map((r) => r.indexdef.replace(/^.* USING btree /u, ''));
    // Reuse and revocation lookups per user and family.
    expect(defs).toContain('(user_id, family_id) WHERE (family_revoked_at IS NULL)');
    // The current (unrotated) token of a family. It once shared the name of the
    // index above, so its CREATE INDEX IF NOT EXISTS was silently skipped.
    expect(defs).toContain('(family_id) WHERE (rotated_at IS NULL)');
  });

  it('revoke-all refuses access tokens issued before it, on every device', async () => {
    await seedTestUser(dbHarness.connectionString, { email, password });
    const other = await login(email, password, 'device-a-0000000001');
    const current = await login(email, password, 'device-c-0000000003');

    const me = (accessToken: string) =>
      testServer.inject({
        method: 'GET',
        url: '/api/users/me/sessions',
        headers: { authorization: `Bearer ${accessToken}` },
      });
    expect((await me(other.accessToken)).statusCode).toBe(200);

    const response = await testServer.inject({
      method: 'POST',
      url: '/api/users/me/sessions/revoke-all',
      headers: authHeaders(current),
    });
    expect(response.statusCode).toBe(200);

    // The other device's access token dies now, not when it expires.
    expect((await me(other.accessToken)).statusCode).toBe(401);
    // So does the caller's; its refresh family survives and mints a valid one.
    expect((await me(current.accessToken)).statusCode).toBe(401);
    const refresh = await testServer.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { cookie: `refreshToken=${current.refreshToken}` },
    });
    expect(refresh.statusCode).toBe(200);
    const fresh = String((parseJsonResponse(refresh) as { token: unknown }).token);
    expect((await me(fresh)).statusCode).toBe(200);
  });
});
