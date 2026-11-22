// tests/integration/api/auth.real-db.test.ts
/**
 * Auth API Integration Tests (Real DB)
 *
 * Verifies auth flows against a real isolated database.
 * Tests complex stateful behaviors like token rotation and revocation.
 *
 * Requires a reachable Postgres (local dev container or CI service).
 * Locally the suite skips with a warning when no database is reachable;
 * in CI (or with REQUIRE_REAL_DB=1) it runs unconditionally so a
 * misconfigured database fails the build instead of silently skipping.
 */

import { buildTestApp, parseJsonResponse, seedTestUser, type TestApp } from '@bslt/testing';
import { describeRealDb, type TestDatabase } from '@bslt/testing/real-db';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

function extractRefreshToken(setCookie: string | string[] | undefined): string | undefined {
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie !== undefined ? [setCookie] : [];
  return cookies
    .find((cookie) => cookie.startsWith('refreshToken='))
    ?.split(';')[0]
    ?.split('=')[1];
}

// Captures the (code, expiryMinutes) the OTP service passes to the email
// template, so verify tests can submit the real generated code.
const otpTemplateSpy = vi
  .fn()
  .mockReturnValue({ subject: 'code', text: 'code', html: 'code', to: '' });

describeRealDb('Auth API Integration (Real DB)', (realDb) => {
  let testServer: TestApp;
  let dbHarness: TestDatabase;

  beforeAll(async () => {
    // 1. Create isolated test database with the canonical migrations
    dbHarness = realDb.database;

    // 2. Initialize real repositories

    // 3. Setup test server
    testServer = await buildTestApp({
      database: dbHarness,
      config: {
        auth: {
          // Enable the 'magic' strategy so the email-OTP routes (which share
          // that capability gate) are reachable.
          strategies: ['local', 'magic'],
          refreshToken: { gracePeriodSeconds: 0 },
        },
      },
      ports: {
        emailTemplates: {
          emailVerification: vi.fn().mockReturnValue({ subject: 'test', html: 'test', to: 'test' }),
          passwordReset: vi.fn().mockReturnValue({ subject: 'test', html: 'test', to: 'test' }),
          passwordChangedAlert: vi
            .fn()
            .mockReturnValue({ subject: 'test', html: 'test', to: 'test' }),
          tokenReuseAlert: vi.fn().mockReturnValue({ subject: 'test', html: 'test', to: 'test' }),
          emailOtp: otpTemplateSpy,
        },
      },
    });
  }, 60_000);

  afterAll(async () => {
    await testServer?.close();
  });

  beforeEach(async () => {
    await dbHarness.truncate('identity_users CASCADE');
  });

  describe('POST /api/auth/refresh', () => {
    async function loginAndRotate(): Promise<{ oldToken: string; newToken: string }> {
      const email = 'rotation@example.com';
      const password = 'TestPassword123!';
      await seedTestUser(dbHarness.connectionString, { email, password });

      const loginResponse = await testServer.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { identifier: email, password },
      });
      expect(loginResponse.statusCode).toBe(200);
      const oldToken = extractRefreshToken(loginResponse.headers['set-cookie']);
      expect(oldToken).toBeDefined();

      const refresh = await testServer.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: { cookie: `refreshToken=${String(oldToken)}` },
      });
      expect(refresh.statusCode).toBe(200);
      const newToken = extractRefreshToken(refresh.headers['set-cookie']);
      expect(newToken).toBeDefined();
      expect(newToken).not.toBe(oldToken);

      return { oldToken: String(oldToken), newToken: String(newToken) };
    }

    it('rotates the token and rejects the old token', async () => {
      const { oldToken } = await loginAndRotate();

      const reuseAttempt = await testServer.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: { cookie: `refreshToken=${oldToken}` },
      });
      expect(reuseAttempt.statusCode).toBe(401);
    });

    it('revokes the entire family after a reuse is detected (spec: auth.md)', async () => {
      const { oldToken, newToken } = await loginAndRotate();

      // Reusing the rotated-away token is an attack: 401 + family revoked.
      const reuseAttempt = await testServer.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: { cookie: `refreshToken=${oldToken}` },
      });
      expect(reuseAttempt.statusCode).toBe(401);

      // The legitimate holder's current token dies with the family.
      const invalidNext = await testServer.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: { cookie: `refreshToken=${newToken}` },
      });
      expect(invalidNext.statusCode).toBe(401);
    });
  });

  describe('POST /api/auth/refresh — grace window (default config)', () => {
    let graceServer: TestApp;

    beforeAll(async () => {
      // Default gracePeriodSeconds (30): an immediate retry with the old
      // token is a network retry, not an attack.
      graceServer = await buildTestApp({
        database: dbHarness,
        ports: {
          emailTemplates: {
            emailVerification: vi
              .fn()
              .mockReturnValue({ subject: 'test', html: 'test', to: 'test' }),
            passwordReset: vi.fn().mockReturnValue({ subject: 'test', html: 'test', to: 'test' }),
            passwordChangedAlert: vi
              .fn()
              .mockReturnValue({ subject: 'test', html: 'test', to: 'test' }),
          },
        },
      });
    }, 60_000);

    afterAll(async () => {
      await graceServer?.close();
    });

    it('an immediate retry with the rotated token returns the current token, not a revocation', async () => {
      const email = 'grace-retry@example.com';
      const password = 'TestPassword123!';
      await seedTestUser(dbHarness.connectionString, { email, password });

      const loginResponse = await graceServer.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { identifier: email, password },
      });
      expect(loginResponse.statusCode).toBe(200);
      const oldToken = extractRefreshToken(loginResponse.headers['set-cookie']);

      const refresh = await graceServer.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: { cookie: `refreshToken=${String(oldToken)}` },
      });
      expect(refresh.statusCode).toBe(200);
      const newToken = extractRefreshToken(refresh.headers['set-cookie']);

      // Network retry with the just-rotated token: 200 with the family's
      // current token instead of killing the session.
      const retry = await graceServer.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: { cookie: `refreshToken=${String(oldToken)}` },
      });
      expect(retry.statusCode).toBe(200);
      expect(extractRefreshToken(retry.headers['set-cookie'])).toBe(newToken);

      // The current token still works afterwards — the family survived.
      const next = await graceServer.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: { cookie: `refreshToken=${String(newToken)}` },
      });
      expect(next.statusCode).toBe(200);
    });
  });

  describe('POST /api/auth/logout-all', () => {
    it('revokes every session, including the caller', async () => {
      const email = 'logout-all@example.com';
      const password = 'TestPassword123!';
      await seedTestUser(dbHarness.connectionString, { email, password });

      // 1. Create two sessions. BFF login responses carry no token body —
      //    the access token comes from a refresh.
      const session1 = await testServer.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { identifier: email, password },
      });
      const session2 = await testServer.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { identifier: email, password },
      });

      const token1 = extractRefreshToken(session1.headers['set-cookie']);
      const token2 = extractRefreshToken(session2.headers['set-cookie']);
      expect(token1).toBeDefined();
      expect(token2).toBeDefined();

      // 2. Mint an access token for session 2 (rotates its refresh cookie)
      const refreshSession2 = await testServer.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: { cookie: `refreshToken=${String(token2)}` },
      });
      expect(refreshSession2.statusCode).toBe(200);
      const accessToken2 = String((parseJsonResponse(refreshSession2) as { token: unknown }).token);
      const rotatedToken2 = extractRefreshToken(refreshSession2.headers['set-cookie']);
      expect(rotatedToken2).toBeDefined();

      // 3. Call logout-all from session 2. The handler revokes every
      //    refresh token for the user and clears the caller's cookie too —
      //    "log out of all devices" includes the current one.
      const logoutAllResponse = await testServer.inject({
        method: 'POST',
        url: '/api/auth/logout-all',
        headers: {
          authorization: `Bearer ${accessToken2}`,
          cookie: `refreshToken=${String(rotatedToken2)}`,
        },
      });
      expect(logoutAllResponse.statusCode).toBe(200);

      // 4. Session 1 is revoked
      const refresh1 = await testServer.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: { cookie: `refreshToken=${String(token1)}` },
      });
      expect(refresh1.statusCode).toBe(401);

      // 5. The caller's session is revoked as well
      const refresh2 = await testServer.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: { cookie: `refreshToken=${String(rotatedToken2)}` },
      });
      expect(refresh2.statusCode).toBe(401);
    });
  });

  describe('Email OTP (POST /api/auth/otp/*)', () => {
    async function requestCode(email: string): Promise<string> {
      otpTemplateSpy.mockClear();
      const response = await testServer.inject({
        method: 'POST',
        url: '/api/auth/otp/request',
        payload: { email },
      });
      expect(response.statusCode).toBe(200);
      const code = otpTemplateSpy.mock.calls.at(-1)?.[0] as string | undefined;
      expect(code).toMatch(/^\d{6}$/);
      return String(code);
    }

    it('creates an account and a session on first valid code', async () => {
      const email = `otp-new-${Date.now()}@example.com`;
      const code = await requestCode(email);

      const verify = await testServer.inject({
        method: 'POST',
        url: '/api/auth/otp/verify',
        // Account creation requires the eligibility attestation and consent to
        // the signup agreements (the migrations seed published ToS/Privacy docs).
        payload: { email, code, eligibilityAttested: true, tosAccepted: true },
      });

      expect(verify.statusCode).toBe(200);
      const body = parseJsonResponse(verify) as { token: string; user: { email: string } };
      expect(body.token.length).toBeGreaterThan(0);
      expect(body.user.email).toBe(email);
      expect(extractRefreshToken(verify.headers['set-cookie'])).toBeDefined();

      // The code is single-use — replay fails.
      const replay = await testServer.inject({
        method: 'POST',
        url: '/api/auth/otp/verify',
        payload: { email, code },
      });
      expect(replay.statusCode).toBe(401);
    });

    it('rejects a wrong code', async () => {
      const email = `otp-wrong-${Date.now()}@example.com`;
      const realCode = await requestCode(email);
      const wrongCode = realCode === '000000' ? '111111' : '000000';

      const verify = await testServer.inject({
        method: 'POST',
        url: '/api/auth/otp/verify',
        payload: { email, code: wrongCode },
      });
      expect(verify.statusCode).toBe(401);
    });

    it('invalidates the code after too many failed attempts', async () => {
      const email = `otp-bruteforce-${Date.now()}@example.com`;
      const code = await requestCode(email);
      const wrongCode = code === '000000' ? '111111' : '000000';

      // Exhaust the attempt budget (max 5 failures).
      for (let i = 0; i < 5; i++) {
        const attempt = await testServer.inject({
          method: 'POST',
          url: '/api/auth/otp/verify',
          payload: { email, code: wrongCode },
        });
        expect(attempt.statusCode).toBe(401);
      }

      // Even the correct code now fails — the code was invalidated.
      const verify = await testServer.inject({
        method: 'POST',
        url: '/api/auth/otp/verify',
        payload: { email, code },
      });
      expect(verify.statusCode).toBe(401);
    });

    it('only keeps the most recent code live per email', async () => {
      const email = `otp-reissue-${Date.now()}@example.com`;
      const firstCode = await requestCode(email);
      const secondCode = await requestCode(email);

      // The superseded code is no longer valid.
      const stale = await testServer.inject({
        method: 'POST',
        url: '/api/auth/otp/verify',
        payload: { email, code: firstCode },
      });
      expect(stale.statusCode).toBe(401);

      const fresh = await testServer.inject({
        method: 'POST',
        url: '/api/auth/otp/verify',
        payload: { email, code: secondCode, eligibilityAttested: true, tosAccepted: true },
      });
      expect(fresh.statusCode).toBe(200);
    });
  });
});
