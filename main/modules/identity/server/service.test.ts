// main/modules/identity/server/service.test.ts
import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  API_KEY_TOKEN_PREFIX,
  adminCreateInvitedUser,
  adminHardBanUser,
  adminLockUser,
  adminSearchUsers,
  adminSoftDeleteUser,
  authenticateApiKey,
  changeUserPassword,
  computeProfileCompleteness,
  createApiKeyForOwner,
  deactivateUserAccount,
  deleteApiKeyForOwner,
  generateApiKey,
  hashApiKeyToken,
  listApiKeysForOwner,
  reactivateUserAccount,
  requestUserDeletion,
  revokeSessionForUser,
  updateUserProfile,
  updateUsernameForUser,
} from './service';

import type { ApiKeyRecord, IdentityApiKeyRepository, IdentityRepository } from './repository';

const OWNER_ID = '22222222-2222-4222-8222-222222222222';
const KEY_ID = '11111111-1111-4111-8111-111111111111';

function makeRecord(overrides: Partial<ApiKeyRecord> = {}): ApiKeyRecord {
  return {
    id: KEY_ID,
    userId: OWNER_ID,
    orgId: null,
    scopes: [],
    name: 'CI deploy bot',
    keyPrefix: 'bslt_abcdef',
    last4: 'wxyz',
    lastUsedAt: null,
    expiresAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeRepo(overrides: Partial<IdentityApiKeyRepository> = {}): IdentityApiKeyRepository {
  return {
    listApiKeysByOwner: vi.fn().mockResolvedValue([]),
    insertApiKey: vi.fn(async (data) =>
      makeRecord({
        userId: data.userId,
        orgId: data.orgId ?? null,
        scopes: data.scopes ?? [],
        name: data.name,
        keyPrefix: data.keyPrefix,
        last4: data.last4,
        expiresAt: data.expiresAt,
      }),
    ),
    deleteApiKeyForOwner: vi.fn().mockResolvedValue(null),
    findApiKeyAuthByTokenHash: vi.fn().mockResolvedValue(null),
    touchApiKeyLastUsed: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('identity API key service', () => {
  it('generates unique bslt_ tokens hashed with SHA-256 and returns plaintext once on create', async () => {
    const first = generateApiKey();
    const second = generateApiKey();
    expect(first.token.startsWith(API_KEY_TOKEN_PREFIX)).toBe(true);
    expect(first.token).not.toBe(second.token);
    expect(first.tokenHash).toBe(createHash('sha256').update(first.token).digest('hex'));
    expect(first.tokenHash).toBe(hashApiKeyToken(first.token));
    expect(first.keyPrefix).toBe(first.token.slice(0, 11));
    expect(first.last4).toBe(first.token.slice(-4));

    const now = new Date('2026-01-01T00:00:00.000Z');
    const repo = makeRepo();
    const created = await createApiKeyForOwner(
      OWNER_ID,
      { name: 'CI deploy bot', expiresInDays: 30 },
      repo,
      now,
    );
    expect(created.token.startsWith(API_KEY_TOKEN_PREFIX)).toBe(true);
    expect(created.expiresAt).toBe('2026-01-31T00:00:00.000Z');

    const listed = await listApiKeysForOwner(
      OWNER_ID,
      makeRepo({ listApiKeysByOwner: vi.fn().mockResolvedValue([makeRecord()]) }),
    );
    expect(listed).toHaveLength(1);
    expect('token' in (listed[0] ?? {})).toBe(false);

    const orgId = '33333333-3333-4333-8333-333333333333';
    const scoped = await createApiKeyForOwner(
      OWNER_ID,
      {
        name: 'Workspace bot',
        scopes: ['read:projects', 'write:webhooks', 'read:projects'],
        scopeToWorkspace: true,
      },
      repo,
      now,
      orgId,
    );
    expect(scoped.orgId).toBe(orgId);
    expect(scoped.scopes).toEqual(['read:projects', 'write:webhooks']);
  });

  it('short-circuits malformed non-UUID key ids to null without querying Postgres', async () => {
    const deleteFn = vi.fn();
    const repo = makeRepo({ deleteApiKeyForOwner: deleteFn });

    const result = await deleteApiKeyForOwner(OWNER_ID, 'no-such-key', repo);
    expect(result).toBeNull();
    expect(deleteFn).not.toHaveBeenCalled();
  });

  it('returns null when deleting a foreign or nonexistent UUID key', async () => {
    const repo = makeRepo({ deleteApiKeyForOwner: vi.fn().mockResolvedValue(null) });
    expect(await deleteApiKeyForOwner(OWNER_ID, KEY_ID, repo)).toBeNull();
  });

  it('refuses non-bslt_ tokens, unknown hashes, expired keys, and deleted users during authenticateApiKey', async () => {
    const findHash = vi.fn();
    const findUser = vi.fn();

    // Wrong prefix -> zero DB queries
    expect(
      await authenticateApiKey('jwt.or.garbage', {
        findAuthRecordByTokenHash: findHash,
        touchLastUsed: vi.fn(),
        findUserById: findUser,
      }),
    ).toBeNull();
    expect(findHash).not.toHaveBeenCalled();

    // Unknown hash
    expect(
      await authenticateApiKey('bslt_unknown_secret', {
        findAuthRecordByTokenHash: vi.fn().mockResolvedValue(null),
        touchLastUsed: vi.fn(),
        findUserById: findUser,
      }),
    ).toBeNull();

    // Expired key
    expect(
      await authenticateApiKey('bslt_expired_secret', {
        findAuthRecordByTokenHash: vi.fn().mockResolvedValue({
          id: KEY_ID,
          userId: OWNER_ID,
          expiresAt: new Date('2025-12-31T23:59:59.000Z'),
        }),
        touchLastUsed: vi.fn(),
        findUserById: findUser,
        now: () => new Date('2026-01-01T00:00:00.000Z'),
      }),
    ).toBeNull();
    expect(findUser).not.toHaveBeenCalled();

    // Missing user
    expect(
      await authenticateApiKey('bslt_orphan_secret', {
        findAuthRecordByTokenHash: vi.fn().mockResolvedValue({
          id: KEY_ID,
          userId: OWNER_ID,
          expiresAt: null,
        }),
        touchLastUsed: vi.fn(),
        findUserById: vi.fn().mockResolvedValue(null),
      }),
    ).toBeNull();
  });

  it('resolves valid API key identity and reports touchLastUsed failures via onTouchError without blocking auth', async () => {
    const onTouchError = vi.fn();
    const touchErr = new Error('readonly replica');
    const identity = await authenticateApiKey('bslt_valid_secret_token', {
      findAuthRecordByTokenHash: vi.fn().mockResolvedValue({
        id: KEY_ID,
        userId: OWNER_ID,
        expiresAt: new Date('2027-01-01T00:00:00.000Z'),
      }),
      touchLastUsed: vi.fn().mockRejectedValue(touchErr),
      findUserById: vi.fn().mockResolvedValue({
        id: OWNER_ID,
        email: 'owner@example.com',
        role: 'admin',
        tokenVersion: 3,
        lockedUntil: null,
        lockReason: null,
      }),
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      onTouchError,
    });

    expect(identity).toEqual({
      userId: OWNER_ID,
      email: 'owner@example.com',
      role: 'admin',
      tokenVersion: 3,
      lockedUntil: null,
      lockReason: null,
    });
    await vi.waitFor(() => {
      expect(onTouchError).toHaveBeenCalledWith(touchErr);
    });
  });

  it('enforces profile, username cooldown/uniqueness, password change, session revocation, lifecycle, and admin rules', async () => {
    const completeness = computeProfileCompleteness({
      firstName: 'Alice',
      lastName: 'Liddell',
      bio: null,
      city: 'Seoul',
      state: null,
      country: null,
      language: 'ko',
      website: null,
      phone: null,
    });
    expect(completeness.percentage).toBe(44);
    expect(completeness.missingFields).toContain('bio');

    // Missing user returns USER_NOT_FOUND across operations
    const emptyUserRepo = {
      findUserById: vi.fn().mockResolvedValue(null),
      findUserByUsername: vi.fn().mockResolvedValue(null),
      findUserByEmail: vi.fn().mockResolvedValue(null),
      updateUser: vi.fn().mockResolvedValue(null),
      createUser: vi.fn(),
      listUsersWithFilters: vi.fn(),
      lockUserAccount: vi.fn(),
      unlockUserAccount: vi.fn(),
      incrementUserTokenVersion: vi.fn(),
      findTokenFamilyById: vi.fn().mockResolvedValue(null),
      findActiveTokenFamilies: vi.fn().mockResolvedValue([]),
      stampRefreshFamilyRevoked: vi.fn(),
      deleteRefreshTokensByFamily: vi.fn(),
      revokeUserSessionById: vi.fn(),
      stampAllUserRefreshFamiliesRevoked: vi.fn(),
      deleteRefreshTokensByUserId: vi.fn(),
      revokeAllUserSessions: vi.fn(),
    } as unknown as IdentityRepository;

    expect(
      await updateUserProfile(emptyUserRepo, OWNER_ID, { firstName: 'Bob' }, emptyUserRepo),
    ).toEqual({
      ok: false,
      code: 'USER_NOT_FOUND',
      message: 'User not found',
    });
    expect(await updateUsernameForUser(emptyUserRepo, OWNER_ID, 'bob_1', emptyUserRepo)).toEqual({
      ok: false,
      code: 'USER_NOT_FOUND',
      message: 'User not found',
    });
    expect(
      await revokeSessionForUser(emptyUserRepo, OWNER_ID, 'fam-current', 'fam-current'),
    ).toEqual({
      ok: false,
      code: 'SESSION_NOT_FOUND',
      message: 'Cannot revoke current session. Use logout instead.',
    });

    // OAuth-only account cannot change password via changeUserPassword
    const oauthRepo = {
      ...emptyUserRepo,
      findUserById: vi.fn().mockResolvedValue({
        id: OWNER_ID,
        email: 'oauth@example.com',
        username: null,
        firstName: 'OAuth',
        lastName: 'User',
        passwordHash: 'oauth:token',
        role: 'user',
        emailVerified: true,
        deactivatedAt: new Date('2026-01-01T00:00:00.000Z'),
        deletedAt: null,
        deletionGracePeriodEnds: null,
        lastUsernameChange: new Date(),
      }),
    } as unknown as IdentityRepository;

    const noPwd = await changeUserPassword(
      oauthRepo,
      OWNER_ID,
      'anything',
      'Correct$Horse9Battery!',
    );
    expect(noPwd).toMatchObject({ ok: false, code: 'PASSWORD_NOT_SET' });

    // Cooldown active on updateUsernameForUser -> USERNAME_COOLDOWN_ACTIVE
    const cooldown = await updateUsernameForUser(oauthRepo, OWNER_ID, 'new_handle', oauthRepo);
    expect(cooldown).toMatchObject({ ok: false, code: 'USERNAME_COOLDOWN_ACTIVE' });

    // Deactivated account cannot be deactivated again, can request deletion, and can reactivate
    expect(await deactivateUserAccount(oauthRepo, OWNER_ID)).toMatchObject({
      ok: false,
      code: 'LIFECYCLE_TRANSITION_INVALID',
    });

    const reactivatedRepo = {
      ...oauthRepo,
      updateUser: vi.fn().mockResolvedValue({ id: OWNER_ID }),
    } as unknown as IdentityRepository;
    expect(await reactivateUserAccount(reactivatedRepo, OWNER_ID)).toMatchObject({
      ok: true,
      value: { status: 'active' },
    });
    expect(await requestUserDeletion(reactivatedRepo, OWNER_ID)).toMatchObject({
      ok: true,
      value: { status: 'pending_deletion' },
    });

    // Admin duplicate email -> USER_ALREADY_EXISTS; UUID search miss -> empty; soft delete idempotent
    const dupRepo = {
      ...emptyUserRepo,
      findUserByEmail: vi.fn().mockResolvedValue({ id: 'existing' }),
    } as unknown as IdentityRepository;
    expect(
      await adminCreateInvitedUser(dupRepo, {
        email: 'dup@example.com',
        firstName: 'Dup',
        lastName: 'User',
      }),
    ).toMatchObject({ ok: false, code: 'USER_ALREADY_EXISTS' });

    expect(await adminSearchUsers(emptyUserRepo, KEY_ID, { limit: 10, offset: 0 })).toEqual({
      users: [],
      total: 0,
      limit: 10,
      offset: 0,
    });

    expect(await adminLockUser(emptyUserRepo, OWNER_ID, 'spam')).toMatchObject({
      ok: false,
      code: 'USER_NOT_FOUND',
    });
    expect(await adminHardBanUser(emptyUserRepo, OWNER_ID, 'fraud')).toMatchObject({
      ok: false,
      code: 'USER_NOT_FOUND',
    });
    expect(await adminSoftDeleteUser(emptyUserRepo, OWNER_ID)).toMatchObject({
      ok: false,
      code: 'USER_NOT_FOUND',
    });
  });

  it('enforces sudo credential checks, foreign-device isolation, and canonical issueSession token+cookie generation', async () => {
    const { elevateSudoInRepo, issueSession, revokeDeviceForUser, trustDeviceForUser } =
      await import('./service');

    const emptyRepo = {
      findUserById: vi.fn().mockResolvedValue(null),
      findTrustedDeviceById: vi.fn().mockResolvedValue(null),
      markDeviceTrusted: vi.fn().mockResolvedValue(null),
      revokeTrustedDevice: vi.fn().mockResolvedValue(false),
    } as unknown as IdentityRepository;

    // Failure assertions (>= 60%): missing user, foreign device, wrong password, unenabled TOTP
    expect(
      await elevateSudoInRepo(
        emptyRepo,
        OWNER_ID,
        { password: 'wrong' },
        {
          jwtSecret: 'test-jwt-secret-with-at-least-32-chars!',
          encryptionKey: 'test-enc-secret-with-at-least-32-chars!',
          totpWindow: 1,
        },
      ),
    ).toEqual({ ok: false, code: 'USER_NOT_FOUND', message: 'User not found' });

    const foreignDeviceRepo = {
      ...emptyRepo,
      findTrustedDeviceById: vi.fn().mockResolvedValue({
        id: 'dev-1',
        userId: '33333333-3333-4333-8333-333333333333',
      }),
    } as unknown as IdentityRepository;
    expect(await trustDeviceForUser(foreignDeviceRepo, OWNER_ID, 'dev-1')).toEqual({
      ok: false,
      code: 'DEVICE_NOT_FOUND',
      message: 'Device not found',
    });
    expect(await revokeDeviceForUser(foreignDeviceRepo, OWNER_ID, 'dev-1')).toEqual({
      ok: false,
      code: 'DEVICE_NOT_FOUND',
      message: 'Device not found',
    });

    const userNoTotpRepo = {
      ...emptyRepo,
      findUserById: vi.fn().mockResolvedValue({
        id: OWNER_ID,
        passwordHash: 'oauth:google',
        totpEnabled: false,
        totpSecret: null,
      }),
    } as unknown as IdentityRepository;
    expect(
      await elevateSudoInRepo(
        userNoTotpRepo,
        OWNER_ID,
        { totpCode: '123456' },
        {
          jwtSecret: 'test-jwt-secret-with-at-least-32-chars!',
          encryptionKey: 'test-enc-secret-with-at-least-32-chars!',
          totpWindow: 1,
        },
      ),
    ).toMatchObject({ ok: false, code: 'TOTP_NOT_ENABLED' });

    // Positive: canonical issueSession mints access token, refresh family, and cookie options
    const now = new Date('2026-01-01T00:00:00.000Z');
    const sessionRepo = {
      insertRefreshToken: vi.fn().mockResolvedValue(undefined),
      insertUserSession: vi.fn().mockResolvedValue(undefined),
    } as unknown as IdentityRepository;
    const issued = await issueSession(
      sessionRepo,
      {
        id: OWNER_ID,
        email: 'alice@example.com',
        canonicalEmail: 'alice@example.com',
        username: 'alice',
        passwordHash: 'h',
        avatarUrl: null,
        role: 'user',
        emailVerified: true,
        emailVerifiedAt: now,
        totpSecret: null,
        totpEnabled: false,
        firstName: 'Alice',
        lastName: 'Liddell',
        bio: null,
        website: null,
        language: null,
        city: null,
        state: null,
        country: null,
        phone: null,
        phoneVerified: null,
        dateOfBirth: null,
        gender: null,
        lastUsernameChange: null,
        failedLoginAttempts: 0,
        lockedUntil: null,
        lockReason: null,
        tokenVersion: 5,
        deactivatedAt: null,
        deletedAt: null,
        deletionGracePeriodEnds: null,
        createdAt: now,
        updatedAt: now,
        version: 1,
        eligibilityAttestedAt: null,
        eligibilityAttestationVersion: null,
      },
      {
        jwtSecret: 'test-jwt-secret-with-at-least-32-chars!',
        accessTokenExpiry: '15m',
        refreshExpiryDays: 7,
        cookie: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' },
        ipAddress: '203.0.113.10',
        userAgent: 'Chrome/130',
        now,
      },
    );
    expect(issued.token.length).toBeGreaterThan(20);
    expect(issued.refreshToken).toHaveLength(128);
    expect(issued.cookieOptions).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 86_400,
    });
    expect(issued.user.id).toBe(OWNER_ID);
  });
});
