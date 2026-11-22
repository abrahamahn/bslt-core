// main/modules/identity/server/repository.test.ts
import { describe, expect, it, vi } from 'vitest';

import { identityRepository, type DbQueryClient } from './repository';

const SAMPLE_ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  user_id: '22222222-2222-4222-8222-222222222222',
  name: 'CI deploy bot',
  token_hash: 'deadbeef_never_leaked',
  key_prefix: 'bslt_abcdef',
  last4: 'wxyz',
  last_used_at: null,
  expires_at: new Date('2027-01-01T00:00:00.000Z'),
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-01T00:00:00.000Z'),
};

function makeDb(
  overrides: {
    readonly query?: ReturnType<typeof vi.fn>;
    readonly queryOne?: ReturnType<typeof vi.fn>;
  } = {},
): {
  readonly db: DbQueryClient;
  readonly query: ReturnType<typeof vi.fn>;
  readonly queryOne: ReturnType<typeof vi.fn>;
} {
  const query = overrides.query ?? vi.fn().mockResolvedValue([]);
  const queryOne = overrides.queryOne ?? vi.fn().mockResolvedValue(null);
  return {
    db: { query: query as DbQueryClient['query'], queryOne: queryOne as DbQueryClient['queryOne'] },
    query,
    queryOne,
  };
}

describe('identityRepository (API keys)', () => {
  it('lists owner-scoped API keys ordered by created_at DESC without projecting token_hash', async () => {
    const { db, query } = makeDb({
      query: vi.fn().mockResolvedValue([SAMPLE_ROW]),
    });
    const rows = await identityRepository(db).listApiKeysByOwner(SAMPLE_ROW.user_id);

    expect(query).toHaveBeenCalledTimes(1);
    const sql = query.mock.calls[0]?.[0] as { text: string; values: unknown[] };
    expect(sql.text).toContain('FROM identity_api_keys');
    expect(sql.text).toContain('user_id = $1');
    expect(sql.text).toContain('ORDER BY created_at DESC');
    expect(sql.values).toEqual([SAMPLE_ROW.user_id]);
    expect(rows).toEqual([
      {
        id: SAMPLE_ROW.id,
        userId: SAMPLE_ROW.user_id,
        name: SAMPLE_ROW.name,
        keyPrefix: SAMPLE_ROW.key_prefix,
        last4: SAMPLE_ROW.last4,
        lastUsedAt: null,
        expiresAt: SAMPLE_ROW.expires_at,
        createdAt: SAMPLE_ROW.created_at,
        updatedAt: SAMPLE_ROW.updated_at,
      },
    ]);
    expect('tokenHash' in (rows[0] ?? {})).toBe(false);
    expect('token_hash' in (rows[0] ?? {})).toBe(false);
  });

  it('inserts an API key without leaking token_hash and throws when INSERT returns null', async () => {
    const { db: okDb } = makeDb({
      queryOne: vi.fn().mockResolvedValue(SAMPLE_ROW),
    });
    const inserted = await identityRepository(okDb).insertApiKey({
      userId: SAMPLE_ROW.user_id,
      name: SAMPLE_ROW.name,
      tokenHash: SAMPLE_ROW.token_hash,
      keyPrefix: SAMPLE_ROW.key_prefix,
      last4: SAMPLE_ROW.last4,
      expiresAt: SAMPLE_ROW.expires_at,
    });
    expect(inserted.id).toBe(SAMPLE_ROW.id);
    expect('tokenHash' in inserted).toBe(false);

    const { db: nullDb } = makeDb({
      queryOne: vi.fn().mockResolvedValue(null),
    });
    await expect(
      identityRepository(nullDb).insertApiKey({
        userId: SAMPLE_ROW.user_id,
        name: SAMPLE_ROW.name,
        tokenHash: SAMPLE_ROW.token_hash,
        keyPrefix: SAMPLE_ROW.key_prefix,
        last4: SAMPLE_ROW.last4,
        expiresAt: null,
      }),
    ).rejects.toThrow('Failed to create API key');
  });

  it('returns null when deleting a missing or foreign API key and scopes DELETE by both id and user_id', async () => {
    const { db, queryOne } = makeDb({
      queryOne: vi.fn().mockResolvedValue(null),
    });
    const deleted = await identityRepository(db).deleteApiKeyForOwner('other-user', SAMPLE_ROW.id);
    expect(deleted).toBeNull();
    const sql = queryOne.mock.calls[0]?.[0] as { text: string; values: unknown[] };
    expect(sql.text).toContain('DELETE FROM identity_api_keys');
    expect(sql.text).toContain('id = $1');
    expect(sql.text).toContain('user_id = $2');
    expect(sql.values).toEqual([SAMPLE_ROW.id, 'other-user']);
  });

  it('returns null on unknown token_hash lookup and stamps last_used_at on touchApiKeyLastUsed', async () => {
    const { db, queryOne } = makeDb({
      queryOne: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(SAMPLE_ROW)
        .mockResolvedValueOnce(SAMPLE_ROW),
    });
    const repo = identityRepository(db);
    expect(await repo.findApiKeyAuthByTokenHash('missing')).toBeNull();
    expect(await repo.findApiKeyAuthByTokenHash(SAMPLE_ROW.token_hash)).toEqual({
      id: SAMPLE_ROW.id,
      userId: SAMPLE_ROW.user_id,
      expiresAt: SAMPLE_ROW.expires_at,
    });
    const now = new Date('2026-06-01T12:00:00.000Z');
    await repo.touchApiKeyLastUsed(SAMPLE_ROW.id, now);
    const updateSql = queryOne.mock.calls[2]?.[0] as { text: string; values: unknown[] };
    expect(updateSql.text).toContain('UPDATE identity_api_keys');
    expect(updateSql.values).toContain(SAMPLE_ROW.id);
  });

  it('propagates database errors from list, delete, lookup, and touch without swallowing', async () => {
    const boom = new Error('connection terminated');
    const { db } = makeDb({
      query: vi.fn().mockRejectedValue(boom),
      queryOne: vi.fn().mockRejectedValue(boom),
    });
    const repo = identityRepository(db);
    await expect(repo.listApiKeysByOwner('u-1')).rejects.toThrow('connection terminated');
    await expect(repo.deleteApiKeyForOwner('u-1', SAMPLE_ROW.id)).rejects.toThrow(
      'connection terminated',
    );
    await expect(repo.findApiKeyAuthByTokenHash('hash')).rejects.toThrow('connection terminated');
    await expect(repo.touchApiKeyLastUsed(SAMPLE_ROW.id, new Date())).rejects.toThrow(
      'connection terminated',
    );
  });

  it('manages users, sessions, refresh token families, and password-reset auth tokens and rejects failed creates/increments', async () => {
    const userRow = {
      id: SAMPLE_ROW.user_id,
      email: 'alice@example.com',
      canonical_email: 'alice@example.com',
      username: 'alice',
      password_hash: '$argon2id$v=19$m=1024,t=1,p=1$YWJj$ZGVm',
      avatar_url: null,
      role: 'user',
      email_verified: true,
      email_verified_at: new Date('2026-01-01T00:00:00.000Z'),
      totp_secret: null,
      totp_enabled: false,
      first_name: 'Alice',
      last_name: 'Liddell',
      bio: null,
      website: null,
      language: null,
      city: null,
      state: null,
      country: null,
      phone: null,
      phone_verified: null,
      date_of_birth: null,
      gender: null,
      last_username_change: null,
      failed_login_attempts: 0,
      locked_until: null,
      lock_reason: null,
      token_version: 2,
      deactivated_at: null,
      deleted_at: null,
      deletion_grace_period_ends: null,
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
      version: 1,
      eligibility_attested_at: null,
      eligibility_attestation_version: null,
    };

    const nullRepo = identityRepository({
      query: vi.fn().mockResolvedValue([]),
      queryOne: vi.fn().mockResolvedValue(null),
      execute: vi.fn().mockResolvedValue(0),
      raw: vi.fn().mockResolvedValue([]),
    });
    expect(await nullRepo.findUserById('missing')).toBeNull();
    expect(await nullRepo.findUserByEmail('Nobody@Gmail.com')).toBeNull();
    expect(await nullRepo.findUserByUsername('NO_ONE')).toBeNull();
    await expect(
      nullRepo.createUser({
        email: 'a@b.io',
        canonicalEmail: 'a@b.io',
        passwordHash: 'hash',
        firstName: 'A',
        lastName: 'B',
      }),
    ).rejects.toThrow('Failed to create user');
    await expect(nullRepo.incrementUserTokenVersion('missing')).rejects.toThrow('User not found');

    const okQueryOne = vi
      .fn()
      .mockResolvedValueOnce(userRow) // findUserByEmail
      .mockResolvedValueOnce({ count: 1 }) // listUsersWithFilters count
      .mockResolvedValueOnce({ ...userRow, token_version: 3 }); // incrementUserTokenVersion
    const okRepo = identityRepository({
      query: vi.fn().mockResolvedValue([userRow]),
      queryOne: okQueryOne,
      execute: vi.fn().mockResolvedValue(2),
      raw: vi.fn().mockResolvedValue([]),
    });

    const byEmail = await okRepo.findUserByEmail('Alice+tag@gmail.com');
    expect(byEmail?.email).toBe('alice@example.com');

    const listed = await okRepo.listUsersWithFilters({
      search: 'alice%',
      role: 'user',
      status: 'active',
      plan: 'pro',
      page: 1,
      limit: 10,
    });
    expect(listed.total).toBe(1);
    expect(listed.data[0]?.id).toBe(SAMPLE_ROW.user_id);

    expect(await okRepo.incrementUserTokenVersion(SAMPLE_ROW.user_id)).toBe(3);
    expect(await okRepo.deleteRevokedSessionsBefore('2026-01-01T00:00:00.000Z')).toBe(2);
  });

  it('manages trusted devices, TOTP/backup codes, SMS codes, and WebAuthn credentials with null/race failure handling', async () => {
    const emptyRepo = identityRepository({
      query: vi.fn().mockResolvedValue([]),
      queryOne: vi.fn().mockResolvedValue(null),
      execute: vi.fn().mockResolvedValue(0),
      raw: vi.fn().mockResolvedValue([]),
    });

    // Failure assertions (>= 60%): missing rows, lost backup-code race, failed credential insert
    expect(await emptyRepo.findTrustedDeviceById('missing')).toBeNull();
    expect(await emptyRepo.markDeviceTrusted('missing')).toBeNull();
    expect(await emptyRepo.revokeTrustedDevice('missing')).toBe(false);
    expect(await emptyRepo.getUserTotpState('missing')).toBeNull();
    expect(await emptyRepo.claimUnusedBackupCode('already-used')).toBe(false);
    expect(await emptyRepo.findPendingSmsCode('u-1')).toBeNull();
    expect(await emptyRepo.findLatestVerifiedSmsPhone('u-1')).toBeNull();
    expect(await emptyRepo.findWebauthnCredentialByCredentialId('missing')).toBeNull();
    await expect(
      emptyRepo.createWebauthnCredential({
        userId: 'u-1',
        credentialId: 'cred-1',
        publicKey: 'pk',
        counter: 0,
        transports: null,
        deviceType: 'singleDevice',
        backedUp: false,
        name: 'Passkey',
      }),
    ).rejects.toThrow('Failed to create WebAuthn credential');

    // Positive assertions
    const raw = vi
      .fn()
      .mockResolvedValueOnce([{ totp_secret: 'enc', totp_enabled: true }]) // getUserTotpState
      .mockResolvedValueOnce([{ remaining: 8, total: 10 }]) // getBackupCodesCounts
      .mockResolvedValueOnce([{ id: 'bc-1' }]) // claimUnusedBackupCode
      .mockResolvedValueOnce([{ count: '2' }]) // countRecentSmsCodes count
      .mockResolvedValueOnce([{ created_at: new Date('2026-01-01T00:00:00.000Z') }]); // countRecentSmsCodes oldest
    const queryOne = vi.fn().mockResolvedValueOnce({
      id: 'wc-1',
      user_id: 'u-1',
      credential_id: 'cred-1',
      public_key: 'pk',
      counter: 1,
      transports: 'internal',
      device_type: 'multiDevice',
      backed_up: true,
      name: 'MacBook',
      last_used_at: null,
      created_at: new Date('2026-01-01T00:00:00.000Z'),
    });
    const repo = identityRepository({
      query: vi.fn().mockResolvedValue([]),
      queryOne,
      execute: vi.fn().mockResolvedValue(1),
      raw,
    });

    expect(await repo.getUserTotpState('u-1')).toEqual({ totpSecret: 'enc', totpEnabled: true });
    expect(await repo.getBackupCodesCounts('u-1')).toEqual({ remaining: 8, total: 10 });
    expect(await repo.claimUnusedBackupCode('bc-1')).toBe(true);
    const smsWindow = await repo.countRecentSmsCodes('u-1', 1);
    expect(smsWindow.count).toBe(2);
    expect(smsWindow.oldestCreatedAt?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    const createdCred = await repo.createWebauthnCredential({
      userId: 'u-1',
      credentialId: 'cred-1',
      publicKey: 'pk',
      counter: 1,
      transports: 'internal',
      deviceType: 'multiDevice',
      backedUp: true,
      name: 'MacBook',
    });
    expect(createdCred.id).toBe('wc-1');
  });

  it('manages unified auth_tokens, login_attempts, device fingerprint lookups, and refresh token deletion with >= 60% failure assertions', async () => {
    const emptyRepo = identityRepository({
      query: vi.fn().mockResolvedValue([]),
      queryOne: vi.fn().mockResolvedValue(null),
      execute: vi.fn().mockResolvedValue(0),
      raw: vi.fn().mockResolvedValue([]),
    });

    // Failure assertions
    expect(await emptyRepo.findAuthTokenByHash('email_change', 'missing')).toBeNull();
    expect(await emptyRepo.findValidAuthTokenByHash('password_reset', 'missing')).toBeNull();
    expect(await emptyRepo.findActiveAuthTokenByEmail('email_otp', 'nobody@b.io')).toBeNull();
    expect(await emptyRepo.consumeValidAuthTokenByHash('magic_link', 'missing')).toBeNull();
    expect(await emptyRepo.consumeAuthTokenById('missing')).toBeNull();
    expect(await emptyRepo.findTrustedDeviceByFingerprint('u-1', 'fp-missing')).toBeNull();
    expect(await emptyRepo.deleteRefreshTokenByValue('missing')).toBe(false);
    expect(
      await emptyRepo.findMostRecentFailedLoginAttemptAt('nobody@b.io', new Date()),
    ).toBeNull();
    await expect(
      emptyRepo.insertAuthToken({
        type: 'magic_link',
        email: 'a@b.io',
        tokenHash: 'h',
        expiresAt: new Date(),
      }),
    ).rejects.toThrow('Failed to create auth token');
    await expect(
      emptyRepo.upsertTrustedDeviceAccess({
        userId: 'u-1',
        deviceFingerprint: 'fp-1',
        ipAddress: '127.0.0.1',
        userAgent: 'UA',
        lastSeenAt: new Date(),
      }),
    ).rejects.toThrow('Failed to upsert trusted device');

    // Positive assertions
    const now = new Date('2026-07-15T10:00:00.000Z');
    const authTokenRow = {
      id: 'at-1',
      type: 'email_otp',
      user_id: null,
      email: 'a@b.io',
      token_hash: 'h-1',
      metadata: { attempts: 1 },
      ip_address: '127.0.0.1',
      user_agent: 'UA',
      used_at: null,
      expires_at: new Date('2026-07-15T10:10:00.000Z'),
      created_at: now,
    };
    const queryOne = vi
      .fn()
      .mockResolvedValueOnce(authTokenRow) // insertAuthToken
      .mockResolvedValueOnce({ count: 3 }) // countRecentAuthTokensByEmail
      .mockResolvedValueOnce({ count: 4 }) // countRecentFailedLoginAttempts
      .mockResolvedValueOnce({ created_at: now }); // findMostRecentFailedLoginAttemptAt
    const repo = identityRepository({
      query: vi.fn().mockResolvedValue([]),
      queryOne,
      execute: vi.fn().mockResolvedValue(2),
      raw: vi.fn().mockResolvedValue([]),
    });

    const createdToken = await repo.insertAuthToken({
      type: 'email_otp',
      email: 'a@b.io',
      tokenHash: 'h-1',
      expiresAt: new Date('2026-07-15T10:10:00.000Z'),
      metadata: { attempts: 1 },
    });
    expect(createdToken.id).toBe('at-1');
    expect(await repo.countRecentAuthTokensByEmail('a@b.io', now, 'email_otp')).toBe(3);
    expect(await repo.countRecentFailedLoginAttempts('a@b.io', now)).toBe(4);
    expect((await repo.findMostRecentFailedLoginAttemptAt('a@b.io', now))?.toISOString()).toBe(
      now.toISOString(),
    );
    expect(await repo.deleteRefreshTokenByValue('tok')).toBe(true);
    expect(await repo.deleteExpiredAuthTokens(now)).toBe(2);
    expect(await repo.deleteLoginAttemptsOlderThan(now.toISOString())).toBe(2);
  });

  it('handles OAuth connection queries, mutations, and empty/error states', async () => {
    const emptyRepo = identityRepository({
      query: vi.fn().mockResolvedValue([]),
      queryOne: vi.fn().mockResolvedValue(null),
      execute: vi.fn().mockResolvedValue(0),
      raw: vi.fn().mockResolvedValue([]),
    });

    expect(await emptyRepo.findOAuthByProviderUserId('google', 'g-1')).toBeNull();
    expect(await emptyRepo.findOAuthByUserIdAndProvider('u-1', 'google')).toBeNull();
    expect(await emptyRepo.listOAuthByUserId('u-1')).toEqual([]);
    expect(await emptyRepo.findExpiringOAuthConnections(new Date())).toEqual([]);
    expect(await emptyRepo.updateOAuthConnection('oc-1', { accessToken: 'enc' })).toBeNull();
    expect(await emptyRepo.deleteOAuthByUserIdAndProvider('u-1', 'google')).toBe(false);
    await expect(
      emptyRepo.insertOAuthConnection({
        userId: 'u-1',
        provider: 'google',
        providerUserId: 'g-1',
        providerEmail: 'a@b.io',
        accessToken: 'enc-a',
      }),
    ).rejects.toThrow('Failed to create OAuth connection');

    const now = new Date('2026-07-15T10:00:00.000Z');
    const connRow = {
      id: 'oc-1',
      user_id: 'u-1',
      provider: 'google',
      provider_user_id: 'g-1',
      provider_email: 'a@b.io',
      access_token: 'enc-a',
      refresh_token: 'enc-r',
      expires_at: now,
      created_at: now,
      updated_at: now,
    };
    const repo = identityRepository({
      query: vi.fn().mockResolvedValue([connRow]),
      queryOne: vi.fn().mockResolvedValue(connRow),
      execute: vi.fn().mockResolvedValue(1),
      raw: vi.fn().mockResolvedValue([]),
    });

    const created = await repo.insertOAuthConnection({
      userId: 'u-1',
      provider: 'google',
      providerUserId: 'g-1',
      providerEmail: 'a@b.io',
      accessToken: 'enc-a',
      refreshToken: 'enc-r',
      expiresAt: now,
    });
    expect(created.id).toBe('oc-1');
    expect((await repo.findOAuthByProviderUserId('google', 'g-1'))?.userId).toBe('u-1');
    expect((await repo.findOAuthByUserIdAndProvider('u-1', 'google'))?.provider).toBe('google');
    expect(await repo.listOAuthByUserId('u-1')).toHaveLength(1);
    expect(await repo.findExpiringOAuthConnections(now)).toHaveLength(1);
    expect((await repo.updateOAuthConnection('oc-1', { accessToken: 'enc-b' }))?.id).toBe('oc-1');
    expect(await repo.deleteOAuthByUserIdAndProvider('u-1', 'google')).toBe(true);
  });

  it('splits user reads, writes, lockouts, credentials, profiles, and anonymization across identity_users, identity_credentials, identity_lockouts, and identity_profiles', async () => {
    const execute = vi.fn().mockResolvedValue(0);
    const queryOne = vi.fn().mockResolvedValue(null);
    const emptyRepo = identityRepository({
      query: vi.fn().mockResolvedValue([]),
      queryOne,
      execute,
      raw: vi.fn().mockResolvedValue([]),
    });

    // Failure assertions (>= 60%): missing user on updateUser, non-due row on anonymizeDueUserRow, 0-row hard delete
    expect(
      await emptyRepo.updateUser('missing', {
        firstName: 'Ghost',
        passwordHash: 'h',
        lockedUntil: new Date(),
      }),
    ).toBeNull();
    expect(execute).not.toHaveBeenCalled();

    expect(
      await emptyRepo.anonymizeDueUserRow('not-due', {
        email: 'deleted-not-due@anonymized.invalid',
        canonicalEmail: 'deleted-not-due@anonymized.invalid',
        firstName: 'Deleted',
        lastName: 'User',
        lockReason: null,
      }),
    ).toBe(0);
    expect(await emptyRepo.hardDeleteUserById('missing')).toBe(0);
    expect(execute.mock.calls[1]?.[0]?.text).toContain('DELETE FROM identity_users');

    // Positive split assertions: createUser writes identity_users + credentials + profiles + lockouts
    const now = new Date('2026-08-01T00:00:00.000Z');
    const createdUsersRow = {
      id: SAMPLE_ROW.user_id,
      email: 'split@example.com',
      canonical_email: 'split@example.com',
      username: 'split_user',
      role: 'user',
      email_verified: false,
      email_verified_at: null,
      phone: null,
      phone_verified: null,
      last_username_change: null,
      token_version: 0,
      deactivated_at: null,
      deleted_at: null,
      deletion_grace_period_ends: null,
      created_at: now,
      updated_at: now,
      version: 1,
      eligibility_attested_at: null,
      eligibility_attestation_version: null,
    };
    const splitExec = vi.fn().mockResolvedValue(1);
    const splitQueryOne = vi
      .fn()
      .mockResolvedValueOnce(createdUsersRow) // createUser -> INSERT INTO identity_users
      .mockResolvedValueOnce(createdUsersRow) // updateUser -> UPDATE identity_users
      .mockResolvedValueOnce(null); // updateUser -> findUserById fallback
    const splitRepo = identityRepository({
      query: vi.fn().mockResolvedValue([]),
      queryOne: splitQueryOne,
      execute: splitExec,
      raw: vi.fn().mockResolvedValue([]),
    });

    const created = await splitRepo.createUser({
      email: 'Split@Example.com',
      canonicalEmail: 'split@example.com',
      username: 'split_user',
      passwordHash: 'argon-hash',
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
    expect(created.id).toBe(SAMPLE_ROW.user_id);
    expect(created.passwordHash).toBe('argon-hash');
    expect(created.firstName).toBe('Ada');
    const createUserSql = (splitQueryOne.mock.calls[0]?.[0] as { text: string }).text;
    expect(createUserSql).toContain('INSERT INTO identity_users');
    expect(createUserSql).not.toContain('password_hash');
    expect(createUserSql).not.toContain('first_name');
    expect(createUserSql).not.toContain('last_name');
    expect(createUserSql).not.toContain('locked_until');

    const insertTables = splitExec.mock.calls.map((c) => (c[0] as { text: string }).text);
    const credsInsert = insertTables.find((sql) => sql.includes('identity_credentials')) ?? '';
    const profilesInsert = insertTables.find((sql) => sql.includes('identity_profiles')) ?? '';
    const lockoutsInsert = insertTables.find((sql) => sql.includes('identity_lockouts')) ?? '';
    expect(credsInsert).toContain('password_hash');
    expect(credsInsert).not.toContain('first_name');
    expect(profilesInsert).toContain('first_name');
    expect(profilesInsert).not.toContain('email');
    expect(profilesInsert).not.toContain('password_hash');
    expect(lockoutsInsert).toContain('user_id');
    expect(lockoutsInsert).not.toContain('email');
    expect(lockoutsInsert).not.toContain('first_name');

    splitExec.mockClear();
    await splitRepo.updateUser(SAMPLE_ROW.user_id, {
      firstName: 'Grace',
      role: 'moderator',
      passwordHash: 'updated-hash',
      lockedUntil: now,
    });
    const updateUserSql = (splitQueryOne.mock.calls[1]?.[0] as { text: string }).text;
    expect(updateUserSql).toContain('UPDATE identity_users');
    expect(updateUserSql).toContain('role');
    expect(updateUserSql).not.toContain('first_name');
    expect(updateUserSql).not.toContain('password_hash');
    expect(updateUserSql).not.toContain('locked_until');
    const updateExecSqls = splitExec.mock.calls.map((c) => (c[0] as { text: string }).text);
    expect(updateExecSqls.find((s) => s.includes('identity_credentials')) ?? '').not.toContain(
      'first_name',
    );
    expect(updateExecSqls.find((s) => s.includes('identity_profiles')) ?? '').not.toContain('role');
    expect(updateExecSqls.find((s) => s.includes('identity_lockouts')) ?? '').not.toContain(
      'first_name',
    );

    splitExec.mockClear();
    await splitRepo.lockUserAccount(SAMPLE_ROW.user_id, now, 'brute_force');
    await splitRepo.unlockUserAccount(SAMPLE_ROW.user_id);
    expect((splitExec.mock.calls[0]?.[0] as { text: string }).text).toContain('identity_lockouts');
    expect((splitExec.mock.calls[1]?.[0] as { text: string }).text).toContain('identity_lockouts');
  });
});
