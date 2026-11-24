// tests/integration/api/api-keys.integration.test.ts
/**
 * API Keys Integration Tests
 *
 * Mounts `@bslt/identity/server` via `registerServerModules` on `buildTestServer()`
 * and tests the `/api/api-keys*` endpoints through `fastify.inject()`:
 * routing, auth guards, ToS gating, `@bslt/schema` validation (400), owner
 * isolation, and the full key lifecycle:
 * create -> list -> authenticate with the bearer key -> revoke -> key rejected.
 */

import { randomUUID } from 'node:crypto';

import { createAuthGuard, identityServer } from '@bslt/identity/server';
import { registerServerModules } from '@bslt/server-system/module';
import { buildTestServer, createTestJwt, parseJsonResponse, type TestServer } from '@bslt/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { DbClient, QueryResult } from '@bslt/db';
import type { ApiKey, CreatedApiKey } from '@bslt/identity/contract';
import type { AuthGuardRepositories } from '@bslt/identity/server';
import type { AuthGuardFactory } from '@bslt/server/http';
import type { Logger } from '@bslt/server-system/logger';

const USER_A = { userId: 'user-a', email: 'a@example.com', role: 'user' as const };
const USER_B = { userId: 'user-b', email: 'b@example.com', role: 'user' as const };

interface StoredApiKeyRow {
  readonly id: string;
  readonly user_id: string;
  readonly org_id: string | null;
  readonly scopes: readonly string[];
  readonly name: string;
  readonly token_hash: string;
  readonly key_prefix: string;
  readonly last4: string;
  last_used_at: Date | null;
  readonly expires_at: Date | null;
  readonly created_at: Date;
  updated_at: Date;
}

function createInMemoryApiKeysDb() {
  const keys = new Map<string, StoredApiKeyRow>();

  const query = vi.fn(async (sql: QueryResult): Promise<Array<Record<string, unknown>>> => {
    if (sql.text.startsWith('SELECT * FROM identity_api_keys WHERE user_id = $1')) {
      const ownerId = String(sql.values[0]);
      return [...keys.values()].filter((row) => row.user_id === ownerId).map((row) => ({ ...row }));
    }
    return [];
  });

  const queryOne = vi.fn(async (sql: QueryResult): Promise<Record<string, unknown> | null> => {
    if (sql.text.startsWith('INSERT INTO identity_api_keys')) {
      const [userId, orgId, scopes, name, tokenHash, keyPrefix, last4, expiresAt] = sql.values;
      const now = new Date();
      const row: StoredApiKeyRow = {
        id: randomUUID(),
        user_id: String(userId),
        org_id: typeof orgId === 'string' ? orgId : null,
        scopes: Array.isArray(scopes) ? scopes.map(String) : [],
        name: String(name),
        token_hash: String(tokenHash),
        key_prefix: String(keyPrefix),
        last4: String(last4),
        last_used_at: null,
        expires_at: expiresAt instanceof Date ? expiresAt : null,
        created_at: now,
        updated_at: now,
      };
      keys.set(row.id, row);
      return { ...row };
    }
    if (sql.text.startsWith('DELETE FROM identity_api_keys')) {
      const [id, ownerId] = sql.values;
      const existing = keys.get(String(id));
      if (existing === undefined || existing.user_id !== String(ownerId)) {
        return null;
      }
      keys.delete(existing.id);
      return { ...existing };
    }
    if (sql.text.startsWith('SELECT * FROM identity_api_keys WHERE token_hash = $1')) {
      const hash = String(sql.values[0]);
      const found = [...keys.values()].find((row) => row.token_hash === hash);
      return found !== undefined ? { ...found } : null;
    }
    if (sql.text.startsWith('UPDATE identity_api_keys SET')) {
      const id = String(sql.values[2]);
      const existing = keys.get(id);
      if (existing !== undefined) {
        existing.last_used_at = sql.values[0] instanceof Date ? sql.values[0] : new Date();
        existing.updated_at = sql.values[1] instanceof Date ? sql.values[1] : new Date();
        return { ...existing };
      }
      return null;
    }
    return null;
  });

  const db = {
    query,
    queryOne,
    execute: vi.fn().mockResolvedValue(0),
    transaction: async <T>(fn: (tx: DbClient) => Promise<T>): Promise<T> => fn(db),
    raw: vi.fn().mockResolvedValue([]),
    healthCheck: vi.fn().mockResolvedValue(true),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as DbClient;

  return { db, keys };
}

function createMockUsersRepo() {
  const users: Record<string, { id: string; email: string; role: string; tokenVersion: number }> = {
    [USER_A.userId]: { id: USER_A.userId, email: USER_A.email, role: USER_A.role, tokenVersion: 1 },
    [USER_B.userId]: { id: USER_B.userId, email: USER_B.email, role: USER_B.role, tokenVersion: 1 },
  };
  return {
    findById: vi.fn(async (id: string) => {
      const user = users[id];
      return user === undefined ? null : { ...user, lockedUntil: null, lockReason: null };
    }),
    unlockAccount: vi.fn().mockResolvedValue(undefined),
  };
}

const noopLogger: Logger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: () => noopLogger,
};

describe('API Keys Integration Tests', () => {
  let testServer: TestServer;
  let store: ReturnType<typeof createInMemoryApiKeysDb>;

  beforeAll(async () => {
    testServer = await buildTestServer();
    store = createInMemoryApiKeysDb();

    const repos: AuthGuardRepositories = {
      db: store.db,
      users: createMockUsersRepo() as AuthGuardRepositories['users'],
    };

    const authGuardFactory: AuthGuardFactory = (secret, ...roles) =>
      createAuthGuard(secret, repos, ...roles);

    registerServerModules(testServer.server, { db: store.db }, [identityServer], {
      resolveDb: () => store.db,
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
        db: { system: (fn) => fn(store.db) },
        events: { publish: vi.fn().mockResolvedValue(undefined) },
        log: noopLogger,
        clock: { now: () => new Date(Date.now()) },
      },
      routerOptions: {
        prefix: '/api',
        jwtSecret: testServer.config.auth.jwt.secret,
        authGuardFactory,
      },
    });

    await testServer.ready();
  });

  afterAll(async () => {
    await testServer.close();
  });

  afterEach(() => {
    store.keys.clear();
    vi.restoreAllMocks();
  });

  async function createKey(
    token: string,
    payload: Record<string, unknown> = { name: 'CI bot' },
  ): Promise<{ statusCode: number; key: CreatedApiKey }> {
    const response = await testServer.inject({
      method: 'POST',
      url: '/api/api-keys/create',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    const body = parseJsonResponse(response) as { key: CreatedApiKey };
    return { statusCode: response.statusCode, key: body.key };
  }

  describe('authentication guards', () => {
    it('returns 401 for list without a token', async () => {
      const response = await testServer.inject({ method: 'GET', url: '/api/api-keys' });
      expect(response.statusCode).toBe(401);
    });

    it('returns 401 for create without a token', async () => {
      const response = await testServer.inject({
        method: 'POST',
        url: '/api/api-keys/create',
        payload: { name: 'CI bot' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('returns 401 for revoke without a token', async () => {
      const response = await testServer.inject({
        method: 'POST',
        url: '/api/api-keys/key-1/delete',
        payload: {},
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('create validation', () => {
    it('rejects an empty name with 400', async () => {
      const jwt = createTestJwt(USER_A);
      const response = await testServer.inject({
        method: 'POST',
        url: '/api/api-keys/create',
        headers: { authorization: `Bearer ${jwt}` },
        payload: { name: '   ' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('rejects an out-of-range expiry with 400', async () => {
      const jwt = createTestJwt(USER_A);
      for (const expiresInDays of [0, -3, 3651, 1.5]) {
        const response = await testServer.inject({
          method: 'POST',
          url: '/api/api-keys/create',
          headers: { authorization: `Bearer ${jwt}` },
          payload: { name: 'CI bot', expiresInDays },
        });
        expect(response.statusCode, `expiresInDays=${String(expiresInDays)}`).toBe(400);
      }
    });
  });

  describe('key lifecycle round-trip', () => {
    it('create -> list -> authenticate with the key -> revoke -> key stops working', async () => {
      const jwt = createTestJwt(USER_A);

      const { statusCode, key } = await createKey(jwt);
      expect(statusCode).toBe(200);
      expect(key.token.startsWith('bslt_')).toBe(true);
      expect(key.last4).toBe(key.token.slice(-4));

      const listResponse = await testServer.inject({
        method: 'GET',
        url: '/api/api-keys',
        headers: { authorization: `Bearer ${jwt}` },
      });
      expect(listResponse.statusCode).toBe(200);
      const listBody = parseJsonResponse(listResponse) as { keys: ApiKey[] };
      expect(listBody.keys).toHaveLength(1);
      expect(listBody.keys[0]?.id).toBe(key.id);
      expect(listResponse.body).not.toContain(key.token);

      const keyAuthResponse = await testServer.inject({
        method: 'GET',
        url: '/api/api-keys',
        headers: { authorization: `Bearer ${key.token}` },
      });
      expect(keyAuthResponse.statusCode).toBe(200);
      expect((parseJsonResponse(keyAuthResponse) as { keys: ApiKey[] }).keys).toHaveLength(1);

      const revokeResponse = await testServer.inject({
        method: 'POST',
        url: `/api/api-keys/${key.id}/delete`,
        headers: { authorization: `Bearer ${jwt}` },
        payload: {},
      });
      expect(revokeResponse.statusCode).toBe(200);
      expect((parseJsonResponse(revokeResponse) as { id: string }).id).toBe(key.id);

      const revokedAuthResponse = await testServer.inject({
        method: 'GET',
        url: '/api/api-keys',
        headers: { authorization: `Bearer ${key.token}` },
      });
      expect(revokedAuthResponse.statusCode).toBe(401);
    });

    it('rejects an expired key at authentication time', async () => {
      const jwt = createTestJwt(USER_A);
      const { key } = await createKey(jwt, { name: 'short-lived', expiresInDays: 1 });

      const twoDaysLater = Date.now() + 2 * 24 * 60 * 60 * 1000;
      vi.spyOn(Date, 'now').mockReturnValue(twoDaysLater);

      const response = await testServer.inject({
        method: 'GET',
        url: '/api/api-keys',
        headers: { authorization: `Bearer ${key.token}` },
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('owner isolation', () => {
    it('lists only the caller-owned keys', async () => {
      const { key: keyA } = await createKey(createTestJwt(USER_A));
      const { key: keyB } = await createKey(createTestJwt(USER_B), { name: 'B key' });

      const response = await testServer.inject({
        method: 'GET',
        url: '/api/api-keys',
        headers: { authorization: `Bearer ${createTestJwt(USER_B)}` },
      });
      const body = parseJsonResponse(response) as { keys: ApiKey[] };
      expect(body.keys.map((key) => key.id)).toEqual([keyB.id]);
      expect(body.keys.map((key) => key.id)).not.toContain(keyA.id);
    });

    it('returns 404 when revoking a foreign or missing key, leaving it intact', async () => {
      const { key: keyA } = await createKey(createTestJwt(USER_A));

      const foreignRevoke = await testServer.inject({
        method: 'POST',
        url: `/api/api-keys/${keyA.id}/delete`,
        headers: { authorization: `Bearer ${createTestJwt(USER_B)}` },
        payload: {},
      });
      expect(foreignRevoke.statusCode).toBe(404);

      const missingRevoke = await testServer.inject({
        method: 'POST',
        url: '/api/api-keys/no-such-key/delete',
        headers: { authorization: `Bearer ${createTestJwt(USER_A)}` },
        payload: {},
      });
      expect(missingRevoke.statusCode).toBe(404);

      const listResponse = await testServer.inject({
        method: 'GET',
        url: '/api/api-keys',
        headers: { authorization: `Bearer ${createTestJwt(USER_A)}` },
      });
      expect((parseJsonResponse(listResponse) as { keys: ApiKey[] }).keys).toHaveLength(1);
    });
  });
});
