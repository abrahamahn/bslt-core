// tests/integration/api/api-keys.real-db.test.ts
/**
 * API Keys Integration Tests (Real DB)
 *
 * Exercises the auth-critical api-keys slice against a real isolated Postgres —
 * the hashing/lookup/expiry SQL the mock-backed api-keys.integration.test.ts
 * never touches:
 * - creation persists only the SHA-256 hash; the plaintext appears nowhere in
 *   the stored row
 * - a real `bslt_` bearer key authenticates through the auth middleware and
 *   resolves to its owning user
 * - refusals: tampered key, wrong-prefix token, expired key (backdated in SQL),
 *   revoked key (row really deleted), cross-user revoke (row provably intact)
 *
 * Requires a reachable Postgres; mandatory in CI via REQUIRE_REAL_DB.
 */

import { createHash } from 'node:crypto';

import { buildTestApp, parseJsonResponse, seedTestUser, type TestApp } from '@bslt/testing';
import { describeRealDb, type TestDatabase } from '@bslt/testing/real-db';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiKey, CreatedApiKey } from '@bslt/identity/contract';

function extractRefreshToken(setCookie: string | string[] | undefined): string | undefined {
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie !== undefined ? [setCookie] : [];
  return cookies
    .find((cookie) => cookie.startsWith('refreshToken='))
    ?.split(';')[0]
    ?.split('=')[1];
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Flip the last character so the key is well-formed but hashes differently. */
function tamper(token: string): string {
  const last = token.at(-1);
  return token.slice(0, -1) + (last === 'A' ? 'B' : 'A');
}

describeRealDb('API Keys Integration (Real DB)', (realDb) => {
  let testServer: TestApp;
  let dbHarness: TestDatabase;

  const userA = { email: 'api-keys-a@example.com', password: 'TestPassword123!' };
  const userB = { email: 'api-keys-b@example.com', password: 'TestPassword123!' };

  /** Login + refresh: BFF login responses carry no token body. */
  async function obtainAccessToken(email: string, password: string): Promise<string> {
    const loginResponse = await testServer.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { identifier: email, password },
    });
    expect(loginResponse.statusCode).toBe(200);
    const refreshToken = extractRefreshToken(loginResponse.headers['set-cookie']);
    expect(refreshToken).toBeDefined();

    const refresh = await testServer.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { cookie: `refreshToken=${String(refreshToken)}` },
    });
    expect(refresh.statusCode).toBe(200);
    return String((parseJsonResponse(refresh) as { token: unknown }).token);
  }

  async function seedAndLogin(user: { email: string; password: string }): Promise<string> {
    await seedTestUser(dbHarness.connectionString, user);
    return obtainAccessToken(user.email, user.password);
  }

  async function createKey(
    bearer: string,
    payload: Record<string, unknown> = { name: 'CI bot' },
  ): Promise<CreatedApiKey> {
    const response = await testServer.inject({
      method: 'POST',
      url: '/api/api-keys/create',
      headers: { authorization: `Bearer ${bearer}` },
      payload,
    });
    expect(response.statusCode).toBe(200);
    return (parseJsonResponse(response) as { key: CreatedApiKey }).key;
  }

  async function listStatus(bearer: string): Promise<{ statusCode: number; keys: ApiKey[] }> {
    const response = await testServer.inject({
      method: 'GET',
      url: '/api/api-keys',
      headers: { authorization: `Bearer ${bearer}` },
    });
    const keys =
      response.statusCode === 200 ? (parseJsonResponse(response) as { keys: ApiKey[] }).keys : [];
    return { statusCode: response.statusCode, keys };
  }

  async function keyRow(id: string): Promise<Record<string, unknown> | undefined> {
    const rows = await dbHarness.db.raw<Record<string, unknown>>(
      'SELECT * FROM identity_api_keys WHERE id = $1',
      [id],
    );
    return rows[0];
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
    // TRUNCATE users cascades to api_keys via the FK; retry once in case a
    // fire-and-forget audit write is still holding a lock.
    try {
      await dbHarness.truncate('identity_users CASCADE');
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
      await dbHarness.truncate('identity_users CASCADE');
    }
  });

  describe('hash-only storage', () => {
    it('persists only the SHA-256 hash — the plaintext appears nowhere in the row', async () => {
      const jwt = await seedAndLogin(userA);
      const key = await createKey(jwt);

      expect(key.token.startsWith('bslt_')).toBe(true);

      const row = await keyRow(key.id);
      expect(row).toBeDefined();
      expect(row?.['token_hash']).toBe(sha256Hex(key.token));

      // Serialize the entire row: the plaintext must not appear in any column.
      const serialized = JSON.stringify(row);
      expect(serialized).not.toContain(key.token);
      expect(String(row?.['key_prefix'])).toBe(key.token.slice(0, 11));
      expect(String(row?.['last4'])).toBe(key.token.slice(-4));

      // The list endpoint never echoes the plaintext or the hash.
      const list = await testServer.inject({
        method: 'GET',
        url: '/api/api-keys',
        headers: { authorization: `Bearer ${jwt}` },
      });
      expect(list.statusCode).toBe(200);
      expect(list.body).not.toContain(key.token);
      expect(list.body).not.toContain(String(row?.['token_hash']));
    });
  });

  describe('key authentication', () => {
    it('a freshly issued key authenticates and resolves to its owning user', async () => {
      const jwtA = await seedAndLogin(userA);
      const jwtB = await seedAndLogin(userB);
      const keyA = await createKey(jwtA, { name: 'A key' });
      await createKey(jwtB, { name: 'B key' });

      const viaKey = await listStatus(keyA.token);
      expect(viaKey.statusCode).toBe(200);
      // Owner resolution proof: the key sees exactly A's keys, never B's.
      expect(viaKey.keys.map((key) => key.id)).toEqual([keyA.id]);

      // Real-DB side effect: authentication stamps last_used_at (best-effort).
      await vi.waitFor(async () => {
        const row = await keyRow(keyA.id);
        expect(row?.['last_used_at']).not.toBeNull();
      });
    });

    it('lists only the caller-owned keys per user', async () => {
      const jwtA = await seedAndLogin(userA);
      const jwtB = await seedAndLogin(userB);
      const keyA = await createKey(jwtA, { name: 'A key' });
      const keyB = await createKey(jwtB, { name: 'B key' });

      expect((await listStatus(jwtA)).keys.map((key) => key.id)).toEqual([keyA.id]);
      expect((await listStatus(jwtB)).keys.map((key) => key.id)).toEqual([keyB.id]);
    });
  });

  describe('refusals', () => {
    it('rejects a request without any token', async () => {
      const response = await testServer.inject({ method: 'GET', url: '/api/api-keys' });
      expect(response.statusCode).toBe(401);
    });

    it('rejects a tampered key (one flipped character)', async () => {
      const jwt = await seedAndLogin(userA);
      const key = await createKey(jwt);

      expect((await listStatus(tamper(key.token))).statusCode).toBe(401);
      // Sanity: the untampered key works, so the 401 is the flip, not the setup.
      expect((await listStatus(key.token)).statusCode).toBe(200);
    });

    it('rejects a wrong-prefix token even when the secret part is valid', async () => {
      const jwt = await seedAndLogin(userA);
      const key = await createKey(jwt);

      const wrongPrefix = `blst_${key.token.slice('bslt_'.length)}`;
      expect((await listStatus(wrongPrefix)).statusCode).toBe(401);
    });

    it('rejects an expired key (expiry backdated in the real row)', async () => {
      const jwt = await seedAndLogin(userA);
      const key = await createKey(jwt, { name: 'short-lived', expiresInDays: 1 });
      expect((await listStatus(key.token)).statusCode).toBe(200);

      await dbHarness.db.raw(
        `UPDATE identity_api_keys SET expires_at = NOW() - INTERVAL '1 hour' WHERE id = $1`,
        [key.id],
      );

      expect((await listStatus(key.token)).statusCode).toBe(401);
    });

    it('rejects a revoked key and the revocation is persisted', async () => {
      const jwt = await seedAndLogin(userA);
      const key = await createKey(jwt);

      const revoke = await testServer.inject({
        method: 'POST',
        url: `/api/api-keys/${key.id}/delete`,
        headers: { authorization: `Bearer ${jwt}` },
        payload: {},
      });
      expect(revoke.statusCode).toBe(200);
      expect((parseJsonResponse(revoke) as { id: string }).id).toBe(key.id);

      // Persisted: the row is really gone, so the hash can never match again.
      expect(await keyRow(key.id)).toBeUndefined();
      expect((await listStatus(key.token)).statusCode).toBe(401);
    });

    it('refuses a cross-user revoke and leaves the row untouched (IDOR)', async () => {
      const jwtA = await seedAndLogin(userA);
      const jwtB = await seedAndLogin(userB);
      const keyA = await createKey(jwtA, { name: 'A key' });
      const before = await keyRow(keyA.id);

      const foreignRevoke = await testServer.inject({
        method: 'POST',
        url: `/api/api-keys/${keyA.id}/delete`,
        headers: { authorization: `Bearer ${jwtB}` },
        payload: {},
      });
      expect(foreignRevoke.statusCode).toBe(404);

      // Query-after: the row is byte-for-byte what it was before the attempt.
      expect(await keyRow(keyA.id)).toEqual(before);
      // A's key still authenticates; B still cannot see it.
      expect((await listStatus(keyA.token)).statusCode).toBe(200);
      expect((await listStatus(jwtB)).keys.map((key) => key.id)).not.toContain(keyA.id);
    });

    it('never succeeds when revoking with a malformed (non-UUID) key id', async () => {
      const jwt = await seedAndLogin(userA);
      const key = await createKey(jwt);

      const response = await testServer.inject({
        method: 'POST',
        url: '/api/api-keys/no-such-key/delete',
        headers: { authorization: `Bearer ${jwt}` },
        payload: {},
      });
      // A non-UUID id short-circuits to "not found" in deleteApiKey rather
      // than reaching Postgres (whose uuid cast would throw → 500).
      expect(response.statusCode).toBe(404);
      expect(await keyRow(key.id)).toBeDefined();
    });
  });
});
