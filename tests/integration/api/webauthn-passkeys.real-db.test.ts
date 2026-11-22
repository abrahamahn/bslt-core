// tests/integration/api/webauthn-passkeys.real-db.test.ts
/**
 * WebAuthn Passkey Management API Integration Tests (Real DB)
 *
 * The mock-backed webauthn.integration.test.ts stubs the credential repository.
 * The registration/login ceremony is real crypto and belongs in a browser e2e
 * with a virtual authenticator, but the passkey *management* endpoints are
 * plain DB CRUD. This suite seeds a webauthn_credentials row in isolated
 * Postgres and drives them, asserting the rows:
 * - list returns the user's registered passkey
 * - rename updates the credential's name
 * - delete removes the credential row
 *
 * Requires a reachable Postgres; mandatory in CI via REQUIRE_REAL_DB.
 */

import { buildTestApp, parseJsonResponse, seedTestUser, type TestApp } from '@bslt/testing';
import { describeRealDb, type TestDatabase } from '@bslt/testing/real-db';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import type { AppConfig } from '@bslt/server-system/config';

function extractRefreshToken(setCookie: string | string[] | undefined): string {
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie !== undefined ? [setCookie] : [];
  const token = cookies
    .find((cookie) => cookie.startsWith('refreshToken='))
    ?.split(';')[0]
    ?.split('=')[1];
  expect(token).toBeDefined();
  return String(token);
}

describeRealDb('WebAuthn Passkey Management API Integration (Real DB)', (realDb) => {
  let testServer: TestApp;
  let dbHarness: TestDatabase;

  const email = 'passkey-user@example.com';
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

  async function seedCredential(name: string): Promise<string> {
    const userRows = await dbHarness.db.raw<{ id: string }>(
      'SELECT id FROM identity_users WHERE canonical_email = $1',
      [email],
    );
    // Superuser seed: passkeys are registered on the user's own session, so the
    // system role holds no INSERT on identity_passkeys.
    const rows = await dbHarness.adminDb.raw<{ id: string }>(
      `INSERT INTO identity_passkeys (user_id, credential_id, public_key, name)
       VALUES ($1, $2, 'cHVibGljLWtleQ==', $3)
       RETURNING id`,
      [String(userRows[0]?.id), `cred-${name}`, name],
    );
    return String(rows[0]?.id);
  }

  async function credentialName(id: string): Promise<string | undefined> {
    const rows = await dbHarness.db.raw<{ name: string }>(
      'SELECT name FROM identity_passkeys WHERE id = $1',
      [id],
    );
    return rows[0]?.name;
  }

  beforeAll(async () => {
    dbHarness = realDb.database;

    testServer = await buildTestApp({
      database: dbHarness,
      config: { auth: { strategies: ['local', 'webauthn'] } as AppConfig['auth'] },
    });
  }, 60_000);

  afterAll(async () => {
    await testServer?.close();
  });

  beforeEach(async () => {
    await dbHarness.truncate('identity_users, identity_passkeys CASCADE');
    await seedTestUser(dbHarness.connectionString, { email, password });
  });

  it('lists the user registered passkey', async () => {
    await seedCredential('My Laptop');
    const token = await login();

    const response = await testServer.inject({
      method: 'GET',
      url: '/api/users/me/passkeys',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(JSON.stringify(parseJsonResponse(response))).toContain('My Laptop');
  });

  it('rename updates the credential name', async () => {
    const id = await seedCredential('Old Name');
    const token = await login();

    const response = await testServer.inject({
      method: 'PATCH',
      url: `/api/users/me/passkeys/${id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'New Name' },
    });
    expect(response.statusCode).toBe(200);
    expect(await credentialName(id)).toBe('New Name');
  });

  it('delete removes the credential row', async () => {
    const id = await seedCredential('Doomed Key');
    const token = await login();
    expect(await credentialName(id)).toBe('Doomed Key');

    const response = await testServer.inject({
      method: 'DELETE',
      url: `/api/users/me/passkeys/${id}/delete`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(await credentialName(id)).toBeUndefined();
  });
});
