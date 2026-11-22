// main/modules/identity/server/guard.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearLivenessCache, createAccessToken, invalidateLiveness } from './crypto';
import {
  assertUserActive,
  createAuthGuard,
  createRequireAuth,
  createRequireRole,
  type AuthGuardRepositories,
} from './guard';
import { generateApiKey } from './service';

import type { UserRole } from '../contract';
import type { HttpReply, HttpRequest } from '@bslt/server-system/http';

const SECRET = 'test-secret-that-is-long-enough-for-jwt';

beforeEach(() => {
  clearLivenessCache();
});

type TestRequest = HttpRequest & { user?: unknown };

function requestWithAuthorization(authorization?: string): TestRequest {
  return {
    headers: authorization === undefined ? {} : { authorization },
  } as unknown as TestRequest;
}

function createRequest(role: UserRole): TestRequest {
  const token = createAccessToken('user-1', 'user@example.com', role, SECRET);
  return requestWithAuthorization(`Bearer ${token}`);
}

interface RepoOptions {
  readonly user?: {
    readonly role?: UserRole;
    readonly lockedUntil?: Date | null;
    readonly lockReason?: string | null;
    readonly tokenVersion?: number;
  } | null;
  readonly apiKeyRecord?: {
    readonly id: string;
    readonly userId: string;
    readonly expiresAt: Date | null;
  } | null;
}

function makeRepos(options: RepoOptions = {}): {
  repos: AuthGuardRepositories;
  unlockAccount: ReturnType<typeof vi.fn>;
  queryOne: ReturnType<typeof vi.fn>;
} {
  const user =
    options.user === null
      ? null
      : {
          id: 'user-1',
          email: 'user@example.com',
          role: 'user' as UserRole,
          lockedUntil: null,
          lockReason: null,
          tokenVersion: 1,
          ...options.user,
        };
  const unlockAccount = vi.fn().mockResolvedValue(undefined);
  const queryOne = vi.fn((sql: { text: string }) => {
    if (sql.text.startsWith('SELECT * FROM identity_api_keys') && options.apiKeyRecord != null) {
      return Promise.resolve({
        id: options.apiKeyRecord.id,
        user_id: options.apiKeyRecord.userId,
        expires_at: options.apiKeyRecord.expiresAt,
      });
    }
    return Promise.resolve(null);
  });
  const repos: AuthGuardRepositories = {
    users: { findById: vi.fn().mockResolvedValue(user), unlockAccount },
    db: {
      query: vi.fn().mockResolvedValue([]) as unknown as NonNullable<
        AuthGuardRepositories['db']
      >['query'],
      queryOne: queryOne as unknown as NonNullable<AuthGuardRepositories['db']>['queryOne'],
      execute: vi.fn().mockResolvedValue(1),
    },
  };
  return { repos, unlockAccount, queryOne };
}

describe('identity HTTP auth guard & assertUserActive', () => {
  // ==========================================================================
  // Failure / Refusal Assertions (>= 60%)
  // ==========================================================================

  it('rejects missing, non-Bearer, expired, or tampered Authorization headers with 401', async () => {
    const guard = createRequireAuth(SECRET);
    await expect(guard(requestWithAuthorization(), {} as HttpReply)).rejects.toMatchObject({
      statusCode: 401,
      message: 'Unauthorized',
    });
    await expect(
      guard(requestWithAuthorization('Basic abc123'), {} as HttpReply),
    ).rejects.toMatchObject({ statusCode: 401 });

    const expired = createAccessToken('user-1', 'user@example.com', 'user', SECRET, -10);
    await expect(
      guard(requestWithAuthorization(`Bearer ${expired}`), {} as HttpReply),
    ).rejects.toMatchObject({ statusCode: 401 });

    const valid = createAccessToken('user-1', 'user@example.com', 'user', SECRET);
    await expect(
      guard(requestWithAuthorization(`Bearer ${valid.slice(0, -4)}AAAA`), {} as HttpReply),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects missing users, stale tokenVersion claims, and suspended accounts', async () => {
    const missing = makeRepos({ user: null });
    await expect(
      createRequireAuth(SECRET, missing.repos)(createRequest('user'), {} as HttpReply),
    ).rejects.toMatchObject({ statusCode: 401, message: 'Unauthorized' });

    const stale = makeRepos({ user: { tokenVersion: 5 } });
    const staleToken = createAccessToken('user-1', 'user@example.com', 'user', SECRET, '15m', 4);
    await expect(
      createRequireAuth(SECRET, stale.repos)(
        requestWithAuthorization(`Bearer ${staleToken}`),
        {} as HttpReply,
      ),
    ).rejects.toMatchObject({ statusCode: 401, message: 'Unauthorized' });

    clearLivenessCache();
    const locked = makeRepos({
      user: {
        lockedUntil: new Date(Date.now() + 60_000),
        lockReason: 'Repeated failures',
      },
    });
    await expect(
      createRequireAuth(SECRET, locked.repos)(createRequest('user'), {} as HttpReply),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'ACCOUNT_SUSPENDED',
      message: 'Account locked: Repeated failures',
    });
  });

  it('enforces role hierarchy and uses live DB role rather than stale JWT role claim', async () => {
    const userOnAdmin = createAuthGuard(SECRET, 'admin');
    await expect(userOnAdmin(createRequest('user'), {} as HttpReply)).rejects.toMatchObject({
      statusCode: 403,
      code: 'ROLE_FORBIDDEN',
    });

    const demotedRepos = makeRepos({ user: { role: 'user' } });
    const demotedAdminJwt = createRequest('admin');
    await expect(
      createRequireRole(SECRET, demotedRepos.repos, 'admin')(demotedAdminJwt, {} as HttpReply),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'ROLE_FORBIDDEN',
    });
  });

  it('rejects expired or unknown API keys and direct assertUserActive refusals', async () => {
    const generated = generateApiKey();
    const expiredKeyRepos = makeRepos({
      apiKeyRecord: {
        id: 'key-1',
        userId: 'user-1',
        expiresAt: new Date(Date.now() - 10_000),
      },
    });
    await expect(
      createAuthGuard(SECRET, expiredKeyRepos.repos)(
        requestWithAuthorization(`Bearer ${generated.token}`),
        {} as HttpReply,
      ),
    ).rejects.toMatchObject({ statusCode: 401 });

    await expect(assertUserActive(() => Promise.resolve(null), 'u-1')).rejects.toMatchObject({
      statusCode: 401,
    });
    await expect(
      assertUserActive(
        () => Promise.resolve({ lockedUntil: null, lockReason: null, tokenVersion: 2 }),
        'u-1',
        undefined,
        1,
      ),
    ).rejects.toMatchObject({ statusCode: 401, message: 'Token revoked' });
  });

  // ==========================================================================
  // Happy Paths
  // ==========================================================================

  it('authenticates valid JWTs, auto-unlocks expired locks, respects hierarchy, and authenticates API keys', async () => {
    const expiredLock = makeRepos({
      user: { lockedUntil: new Date(Date.now() - 5_000), lockReason: 'Old lock' },
    });
    const req1 = createRequest('user');
    await expect(
      createAuthGuard(SECRET, expiredLock.repos)(req1, {} as HttpReply),
    ).resolves.toBeUndefined();
    expect(expiredLock.unlockAccount).toHaveBeenCalledWith('user-1');
    expect(req1.user).toMatchObject({ userId: 'user-1', role: 'user' });

    // Moderator satisfies 'user' route; admin satisfies any route
    await expect(
      createAuthGuard(SECRET, 'user')(createRequest('moderator'), {} as HttpReply),
    ).resolves.toBeUndefined();
    await expect(
      createAuthGuard(SECRET, 'moderator')(createRequest('admin'), {} as HttpReply),
    ).resolves.toBeUndefined();

    // Valid bslt_ API key authenticates and caches liveness
    const generated = generateApiKey();
    const keyRepos = makeRepos({
      apiKeyRecord: { id: 'key-live', userId: 'user-1', expiresAt: null },
    });
    const apiReq = requestWithAuthorization(`Bearer ${generated.token}`);
    await expect(
      createAuthGuard(SECRET, keyRepos.repos)(apiReq, {} as HttpReply),
    ).resolves.toBeUndefined();
    expect(apiReq.user).toMatchObject({ userId: 'user-1', email: 'user@example.com' });
    invalidateLiveness('user-1');
  });
});
