// main/modules/identity/server/auth-flows.test.ts
import { describe, expect, it, vi } from 'vitest';

import {
  authenticateUserInRepo,
  completeOnboardingInRepo,
  confirmEmailChangeInRepo,
  createConsentedUserInRepo,
  generateDeviceFingerprint,
  generateStableDeviceFingerprint,
  generateUniqueUsernameInRepo,
  getProgressiveDelayInRepo,
  initiateEmailChangeInRepo,
  isAccountLockedInRepo,
  registerUserInRepo,
  requestEmailOtpInRepo,
  requestMagicLinkInRepo,
  resetPasswordInRepo,
  revertEmailChangeInRepo,
  rotateRefreshTokenInRepo,
  setPasswordInRepo,
  verifyCaptchaToken,
  verifyEmailInRepo,
  verifyEmailOtpInRepo,
  verifyMagicLinkInRepo,
} from './auth-flows';
import { createAuthEmailTemplates, hashPassword, hashToken } from './crypto';

import type { IdentityRepository, User as DbUser } from './repository';

const TEST_ARGON2 = { type: 2 as const, memoryCost: 1024, timeCost: 1, parallelism: 1 };
const JWT_SECRET = 'test-jwt-secret-with-at-least-32-chars!!';

function makeUser(overrides: Partial<DbUser> = {}): DbUser {
  const now = new Date('2026-07-15T10:00:00.000Z');
  return {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'alice@example.com',
    canonicalEmail: 'alice@example.com',
    username: 'alice',
    firstName: 'Alice',
    lastName: 'Liddell',
    passwordHash:
      '$argon2id$v=19$m=1024,t=1,p=1$c2FsdHNhbHRzYWx0c2FsdA$dGFndGFndGFndGFndGFndGFndGFndGFndGFndGFndGE',
    role: 'user',
    emailVerified: true,
    emailVerifiedAt: now,
    lockedUntil: null,
    lockReason: null,
    failedLoginAttempts: 0,
    totpSecret: null,
    totpEnabled: false,
    phone: null,
    phoneVerified: null,
    dateOfBirth: null,
    gender: null,
    bio: null,
    city: null,
    state: null,
    country: null,
    language: null,
    website: null,
    avatarUrl: null,
    deactivatedAt: null,
    deletedAt: null,
    deletionGracePeriodEnds: null,
    lastUsernameChange: null,
    eligibilityAttestedAt: now,
    eligibilityAttestationVersion: '2026-07-15.v1',
    tokenVersion: 1,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('auth-flows adversarial suite', () => {
  it('verifies CAPTCHA tokens and device fingerprints with fail-closed empty/network handling', async () => {
    // Failure 1: enabled CAPTCHA with empty token fails immediately without network call
    const emptyRes = await verifyCaptchaToken({ enabled: true, secretKey: 'sec' }, '');
    expect(emptyRes.success).toBe(false);
    expect(emptyRes.errorCodes).toContain('missing-input-response');

    // Failure 2: network failure fails closed
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
    const netRes = await verifyCaptchaToken(
      { enabled: true, secretKey: 'sec' },
      'tok-1',
      '203.0.113.1',
    );
    expect(netRes.success).toBe(false);
    expect(netRes.errorCodes).toEqual(['network-error']);
    fetchSpy.mockRestore();

    // Positive: disabled CAPTCHA passes through
    const disabledRes = await verifyCaptchaToken({ enabled: false, secretKey: '' }, '');
    expect(disabledRes.success).toBe(true);

    expect(generateDeviceFingerprint('ip:1.2.3.4', 'UA')).toHaveLength(64);
    expect(generateStableDeviceFingerprint('device-1234567890123456')).toHaveLength(64);
  });

  it('enforces signup attestation, signup consent, reserved domain, and password policy on registration', async () => {
    const templates = createAuthEmailTemplates();
    const baseRepo = {
      findUserByEmail: vi.fn().mockResolvedValue(null),
      findUserByUsername: vi.fn().mockResolvedValue(null),
      createUser: vi.fn(),
      insertAuthToken: vi.fn(),
      invalidateUnusedAuthTokens: vi.fn(),
    } as unknown as IdentityRepository;

    // Failure 1: createConsentedUserInRepo refuses unconfirmed attestation
    await expect(
      createConsentedUserInRepo(
        baseRepo,
        {
          email: 'a@b.io',
          canonicalEmail: 'a@b.io',
          username: 'ab_user',
          firstName: 'A',
          lastName: 'B',
          passwordHash: 'hash',
          role: 'user',
          emailVerified: false,
        },
        { agreed: true, attested: false },
        {
          peekAgreements: async () => [{ id: 'doc-1' }],
          recordConsents: async () => undefined,
        },
      ),
    ).rejects.toMatchObject({ code: 'ELIGIBILITY_ATTESTATION_REQUIRED' });

    // Failure 2: createConsentedUserInRepo refuses missing consent when agreements exist
    await expect(
      createConsentedUserInRepo(
        baseRepo,
        {
          email: 'a@b.io',
          canonicalEmail: 'a@b.io',
          username: 'ab_user',
          firstName: 'A',
          lastName: 'B',
          passwordHash: 'hash',
          role: 'user',
          emailVerified: false,
        },
        { agreed: false, attested: true },
        {
          peekAgreements: async () => [{ id: 'doc-1' }],
          recordConsents: async () => undefined,
        },
      ),
    ).rejects.toMatchObject({ code: 'SIGNUP_CONSENT_REQUIRED' });

    // Failure 3: reserved anonymized email rejected
    const reservedRes = await registerUserInRepo({
      repo: baseRepo,
      runInTx: (fn) => fn(baseRepo, {} as never),
      email: 'deleted-123@anonymized.invalid',
      password: 'Correct$Horse9Battery!Staple',
      username: 'alice_ok',
      firstName: 'Alice',
      lastName: 'Liddell',
      tosAccepted: true,
      eligibilityAttested: true,
      argon2Config: TEST_ARGON2,
      autoVerifyEmail: false,
      appBaseUrl: 'http://localhost:5173',
      emailTemplates: templates,
      peekAgreements: async () => [],
      recordConsents: async () => undefined,
    });
    expect(reservedRes).toMatchObject({ ok: false, code: 'RESERVED_EMAIL_DOMAIN' });

    // Failure 4: weak password rejected
    const weakRes = await registerUserInRepo({
      repo: baseRepo,
      runInTx: (fn) => fn(baseRepo, {} as never),
      email: 'alice@example.com',
      password: 'password123',
      username: 'alice_ok',
      firstName: 'Alice',
      lastName: 'Liddell',
      tosAccepted: true,
      eligibilityAttested: true,
      argon2Config: TEST_ARGON2,
      autoVerifyEmail: false,
      appBaseUrl: 'http://localhost:5173',
      emailTemplates: templates,
      peekAgreements: async () => [],
      recordConsents: async () => undefined,
    });
    expect(weakRes).toMatchObject({ ok: false, code: 'WEAK_PASSWORD' });

    // Failure 5: taken username rejected with USERNAME_TAKEN
    const takenRepo = {
      ...baseRepo,
      findUserByUsername: vi.fn().mockResolvedValue(makeUser()),
    } as unknown as IdentityRepository;
    const takenRes = await registerUserInRepo({
      repo: takenRepo,
      runInTx: (fn) => fn(takenRepo, {} as never),
      email: 'alice2@example.com',
      password: 'Correct$Horse9Battery!Staple',
      username: 'alice',
      firstName: 'Alice',
      lastName: 'Liddell',
      tosAccepted: true,
      eligibilityAttested: true,
      argon2Config: TEST_ARGON2,
      autoVerifyEmail: false,
      appBaseUrl: 'http://localhost:5173',
      emailTemplates: templates,
      peekAgreements: async () => [],
      recordConsents: async () => undefined,
    });
    expect(takenRes).toMatchObject({ ok: false, code: 'USERNAME_TAKEN' });

    // Positive: autoVerify registration creates user and returns verified status
    const createdUser = makeUser({ email: 'new@example.com', username: 'new_user' });
    const okRepo = {
      ...baseRepo,
      createUser: vi.fn().mockResolvedValue(createdUser),
    } as unknown as IdentityRepository;
    const recordConsents = vi.fn().mockResolvedValue(undefined);
    const okRes = await registerUserInRepo({
      repo: okRepo,
      runInTx: (fn) => fn(okRepo, {} as never),
      email: 'new@example.com',
      password: 'Correct$Horse9Battery!Staple',
      username: 'new_user',
      firstName: 'New',
      lastName: 'User',
      tosAccepted: true,
      eligibilityAttested: true,
      argon2Config: TEST_ARGON2,
      autoVerifyEmail: true,
      appBaseUrl: 'http://localhost:5173',
      emailTemplates: templates,
      peekAgreements: async () => [{ id: 'doc-tos' }],
      recordConsents,
    });
    expect(okRes).toEqual({
      ok: true,
      value: {
        status: 'verified',
        message: 'Account created. Signing you in…',
        email: 'new@example.com',
      },
      createdUser,
    });
    expect(recordConsents).toHaveBeenCalledTimes(1);
  });

  it('enforces lockout, progressive delay, unverified email, deleted grace expiry, and 2FA challenges on login', async () => {
    const validHash = await hashPassword('Correct$Horse9Battery!Staple', TEST_ARGON2);
    const lockoutCfg = {
      maxAttempts: 5,
      lockoutDurationMs: 15 * 60_000,
      progressiveDelay: true,
      baseDelayMs: 2000,
    };

    // Failure 1: account locked via failed attempts
    const lockedRepo = {
      findUserByEmail: vi.fn().mockResolvedValue(makeUser({ passwordHash: validHash })),
      countRecentFailedLoginAttempts: vi.fn().mockResolvedValue(5),
      findMostRecentFailedLoginAttemptAt: vi.fn().mockResolvedValue(new Date()),
      insertLoginAttempt: vi.fn().mockResolvedValue(undefined),
    } as unknown as IdentityRepository;
    expect(await isAccountLockedInRepo(lockedRepo, 'alice@example.com', lockoutCfg)).toBe(true);
    const lockRes = await authenticateUserInRepo({
      repo: lockedRepo,
      runInTx: (fn) => fn(lockedRepo),
      identifier: 'alice@example.com',
      password: 'Correct$Horse9Battery!Staple',
      jwtSecret: JWT_SECRET,
      accessTokenExpiry: '15m',
      spanDays: 0.5,
      argon2Config: TEST_ARGON2,
      lockoutConfig: lockoutCfg,
    });
    expect(lockRes).toMatchObject({ ok: false, code: 'ACCOUNT_LOCKED' });

    // Failure 2: progressive delay active -> TOO_MANY_ATTEMPTS
    const delayRepo = {
      findUserByEmail: vi.fn().mockResolvedValue(makeUser({ passwordHash: validHash })),
      countRecentFailedLoginAttempts: vi
        .fn()
        .mockResolvedValueOnce(0) // isAccountLocked
        .mockResolvedValueOnce(2), // getProgressiveDelay
      findMostRecentFailedLoginAttemptAt: vi.fn().mockResolvedValue(new Date()),
      insertLoginAttempt: vi.fn().mockResolvedValue(undefined),
    } as unknown as IdentityRepository;
    const delayRes = await authenticateUserInRepo({
      repo: delayRepo,
      runInTx: (fn) => fn(delayRepo),
      identifier: 'alice@example.com',
      password: 'Correct$Horse9Battery!Staple',
      jwtSecret: JWT_SECRET,
      accessTokenExpiry: '15m',
      spanDays: 0.5,
      argon2Config: TEST_ARGON2,
      lockoutConfig: lockoutCfg,
    });
    expect(delayRes).toMatchObject({ ok: false, code: 'TOO_MANY_ATTEMPTS' });

    // Failure 3: unverified email -> EMAIL_NOT_VERIFIED with email detail
    const unverifiedRepo = {
      findUserByEmail: vi
        .fn()
        .mockResolvedValue(makeUser({ passwordHash: validHash, emailVerified: false })),
      countRecentFailedLoginAttempts: vi.fn().mockResolvedValue(0),
      findMostRecentFailedLoginAttemptAt: vi.fn().mockResolvedValue(null),
      insertLoginAttempt: vi.fn().mockResolvedValue(undefined),
    } as unknown as IdentityRepository;
    const unvRes = await authenticateUserInRepo({
      repo: unverifiedRepo,
      runInTx: (fn) => fn(unverifiedRepo),
      identifier: 'alice@example.com',
      password: 'Correct$Horse9Battery!Staple',
      jwtSecret: JWT_SECRET,
      accessTokenExpiry: '15m',
      spanDays: 0.5,
      argon2Config: TEST_ARGON2,
      lockoutConfig: { ...lockoutCfg, progressiveDelay: false },
    });
    expect(unvRes).toMatchObject({
      ok: false,
      code: 'EMAIL_NOT_VERIFIED',
      email: 'alice@example.com',
    });

    // Failure 4: deleted past grace period -> generic INVALID_CREDENTIALS
    const expiredDeleted = makeUser({
      passwordHash: validHash,
      deletedAt: new Date('2020-01-01T00:00:00.000Z'),
      deletionGracePeriodEnds: new Date('2020-01-31T00:00:00.000Z'),
    });
    const delRepo = {
      findUserByEmail: vi.fn().mockResolvedValue(expiredDeleted),
      countRecentFailedLoginAttempts: vi.fn().mockResolvedValue(0),
      insertLoginAttempt: vi.fn().mockResolvedValue(undefined),
    } as unknown as IdentityRepository;
    const delRes = await authenticateUserInRepo({
      repo: delRepo,
      runInTx: (fn) => fn(delRepo),
      identifier: 'alice@example.com',
      password: 'Correct$Horse9Battery!Staple',
      jwtSecret: JWT_SECRET,
      accessTokenExpiry: '15m',
      spanDays: 0.5,
      argon2Config: TEST_ARGON2,
      lockoutConfig: { ...lockoutCfg, progressiveDelay: false },
    });
    expect(delRes).toMatchObject({ ok: false, code: 'INVALID_CREDENTIALS' });

    // Positive: TOTP challenge when totpEnabled is true
    const totpRepo = {
      findUserByEmail: vi
        .fn()
        .mockResolvedValue(makeUser({ passwordHash: validHash, totpEnabled: true })),
      countRecentFailedLoginAttempts: vi.fn().mockResolvedValue(0),
      insertLoginAttempt: vi.fn().mockResolvedValue(undefined),
    } as unknown as IdentityRepository;
    const totpRes = await authenticateUserInRepo({
      repo: totpRepo,
      runInTx: (fn) => fn(totpRepo),
      identifier: 'alice@example.com',
      password: 'Correct$Horse9Battery!Staple',
      jwtSecret: JWT_SECRET,
      accessTokenExpiry: '15m',
      spanDays: 0.5,
      argon2Config: TEST_ARGON2,
      lockoutConfig: { ...lockoutCfg, progressiveDelay: false },
    });
    expect(totpRes).toMatchObject({ ok: true, kind: 'totp' });
    expect(
      await getProgressiveDelayInRepo(totpRepo, 'alice@example.com', {
        ...lockoutCfg,
        progressiveDelay: false,
      }),
    ).toBe(0);
  });

  it('detects User-Agent mismatch and rotated token reuse on refresh while supporting grace-window retry', async () => {
    const now = new Date('2026-07-15T10:00:00.000Z');
    const user = makeUser();

    // Failure 1: User-Agent mismatch revokes family and signals reuse
    const uaRepo = {
      findValidRefreshToken: vi.fn().mockResolvedValue({
        id: 'rt-1',
        userId: user.id,
        familyId: 'fam-1',
        token: 'tok-1',
        expiresAt: new Date(now.getTime() + 86_400_000),
        rotatedAt: null,
        familyRevokedAt: null,
        familyIpAddress: '1.1.1.1',
        familyUserAgent: 'Original-UA',
        familyCreatedAt: now,
        createdAt: now,
      }),
      findUserById: vi.fn().mockResolvedValue(user),
      findUserSessionById: vi.fn().mockResolvedValue({
        id: 'fam-1',
        userId: user.id,
        userAgent: 'Original-UA',
      }),
      stampRefreshFamilyRevoked: vi.fn().mockResolvedValue(1),
      deleteRefreshTokensByFamily: vi.fn().mockResolvedValue(1),
      revokeUserSessionById: vi.fn().mockResolvedValue(undefined),
    } as unknown as IdentityRepository;

    const uaRes = await rotateRefreshTokenInRepo({
      repo: uaRepo,
      runInTx: (fn) => fn(uaRepo),
      oldToken: 'tok-1',
      userAgent: 'Attacker-UA',
      expiryDays: 0.5,
      gracePeriodSeconds: 30,
      now,
    });
    expect(uaRes).toMatchObject({ ok: false, kind: 'reuse' });
    expect(uaRepo.stampRefreshFamilyRevoked).toHaveBeenCalledWith(
      'fam-1',
      'Session hijacking detected: User-Agent mismatch',
      now,
    );

    // Failure 2: rotated token outside grace period revokes family
    const staleRepo = {
      findValidRefreshToken: vi.fn().mockResolvedValue({
        id: 'rt-1',
        userId: user.id,
        familyId: 'fam-1',
        token: 'tok-1',
        expiresAt: new Date(now.getTime() + 86_400_000),
        rotatedAt: new Date(now.getTime() - 60_000),
        familyRevokedAt: null,
        familyIpAddress: null,
        familyUserAgent: null,
        familyCreatedAt: now,
        createdAt: now,
      }),
      findUserById: vi.fn().mockResolvedValue(user),
      findUserSessionById: vi.fn().mockResolvedValue(null),
      stampRefreshFamilyRevoked: vi.fn().mockResolvedValue(1),
      deleteRefreshTokensByFamily: vi.fn().mockResolvedValue(1),
      revokeUserSessionById: vi.fn().mockResolvedValue(undefined),
    } as unknown as IdentityRepository;
    const staleRes = await rotateRefreshTokenInRepo({
      repo: staleRepo,
      runInTx: (fn) => fn(staleRepo),
      oldToken: 'tok-1',
      expiryDays: 0.5,
      gracePeriodSeconds: 30,
      now,
    });
    expect(staleRes).toMatchObject({ ok: false, kind: 'reuse' });

    // Positive: rotated token WITHIN grace period returns active successor without revoking
    const graceRepo = {
      findValidRefreshToken: vi.fn().mockResolvedValue({
        id: 'rt-1',
        userId: user.id,
        familyId: 'fam-1',
        token: 'tok-1',
        expiresAt: new Date(now.getTime() + 86_400_000),
        rotatedAt: new Date(now.getTime() - 5_000),
        familyRevokedAt: null,
        familyIpAddress: null,
        familyUserAgent: null,
        familyCreatedAt: now,
        createdAt: now,
      }),
      findUserById: vi.fn().mockResolvedValue(user),
      findUserSessionById: vi.fn().mockResolvedValue(null),
      findActiveRefreshTokenInFamily: vi.fn().mockResolvedValue({
        id: 'rt-2',
        token: 'active-successor-tok',
      }),
    } as unknown as IdentityRepository;
    const graceRes = await rotateRefreshTokenInRepo({
      repo: graceRepo,
      runInTx: (fn) => fn(graceRepo),
      oldToken: 'tok-1',
      expiryDays: 0.5,
      gracePeriodSeconds: 30,
      now,
    });
    expect(graceRes).toEqual({
      ok: true,
      token: 'active-successor-tok',
      user,
    });

    // Failure 3: concurrent rotation race (markRefreshTokenRotated === 0) with gracePeriodSeconds === 0 fails
    const zeroGraceConcurrentRepo = {
      findValidRefreshToken: vi.fn().mockResolvedValue({
        id: 'rt-1',
        userId: user.id,
        familyId: 'fam-1',
        token: 'tok-1',
        expiresAt: new Date(now.getTime() + 86_400_000),
        rotatedAt: null,
        familyRevokedAt: null,
        familyIpAddress: null,
        familyUserAgent: null,
        familyCreatedAt: now,
        createdAt: now,
      }),
      findUserById: vi.fn().mockResolvedValue(user),
      findUserSessionById: vi.fn().mockResolvedValue(null),
      markRefreshTokenRotated: vi.fn().mockResolvedValue(0),
      findActiveRefreshTokenInFamily: vi.fn(),
    } as unknown as IdentityRepository;
    const zeroGraceRes = await rotateRefreshTokenInRepo({
      repo: zeroGraceConcurrentRepo,
      runInTx: (fn) => fn(zeroGraceConcurrentRepo),
      oldToken: 'tok-1',
      expiryDays: 0.5,
      gracePeriodSeconds: 0,
      now,
    });
    expect(zeroGraceRes).toEqual({ ok: false, kind: 'invalid' });

    // Failure 4: concurrent rotation race where family has no active successor fails cleanly
    const noActiveConcurrentRepo = {
      findValidRefreshToken: vi.fn().mockResolvedValue({
        id: 'rt-1',
        userId: user.id,
        familyId: 'fam-1',
        token: 'tok-1',
        expiresAt: new Date(now.getTime() + 86_400_000),
        rotatedAt: null,
        familyRevokedAt: null,
        familyIpAddress: null,
        familyUserAgent: null,
        familyCreatedAt: now,
        createdAt: now,
      }),
      findUserById: vi.fn().mockResolvedValue(user),
      findUserSessionById: vi.fn().mockResolvedValue(null),
      markRefreshTokenRotated: vi.fn().mockResolvedValue(0),
      findActiveRefreshTokenInFamily: vi.fn().mockResolvedValue(null),
    } as unknown as IdentityRepository;
    const noActiveRes = await rotateRefreshTokenInRepo({
      repo: noActiveConcurrentRepo,
      runInTx: (fn) => fn(noActiveConcurrentRepo),
      oldToken: 'tok-1',
      expiryDays: 0.5,
      gracePeriodSeconds: 30,
      now,
    });
    expect(noActiveRes).toEqual({ ok: false, kind: 'invalid' });

    // Positive 2: concurrent rotation race (rotatedAt read as null before peer commits, markRefreshTokenRotated === 0)
    // within gracePeriodSeconds returns the peer's newly minted active token instead of 401 INVALID_TOKEN
    const concurrentRaceRepo = {
      findValidRefreshToken: vi.fn().mockResolvedValue({
        id: 'rt-1',
        userId: user.id,
        familyId: 'fam-1',
        token: 'tok-1',
        expiresAt: new Date(now.getTime() + 86_400_000),
        rotatedAt: null,
        familyRevokedAt: null,
        familyIpAddress: null,
        familyUserAgent: null,
        familyCreatedAt: now,
        createdAt: now,
      }),
      findUserById: vi.fn().mockResolvedValue(user),
      findUserSessionById: vi.fn().mockResolvedValue(null),
      markRefreshTokenRotated: vi.fn().mockResolvedValue(0),
      findActiveRefreshTokenInFamily: vi.fn().mockResolvedValue({
        id: 'rt-2',
        token: 'concurrent-successor-tok',
      }),
    } as unknown as IdentityRepository;
    const concurrentRaceRes = await rotateRefreshTokenInRepo({
      repo: concurrentRaceRepo,
      runInTx: (fn) => fn(concurrentRaceRepo),
      oldToken: 'tok-1',
      expiryDays: 0.5,
      gracePeriodSeconds: 30,
      now,
    });
    expect(concurrentRaceRes).toEqual({
      ok: true,
      token: 'concurrent-successor-tok',
      user,
    });
  });

  it('leaves magic-link and email-OTP tokens unconsumed on missing signup consent while charging wrong OTP attempts', async () => {
    const now = new Date('2026-07-15T10:00:00.000Z');
    const templates = createAuthEmailTemplates();

    // Failure 1: magicLinkRequest email rate-limit
    const rlMagicRepo = {
      countRecentAuthTokensByEmail: vi.fn().mockResolvedValue(3),
    } as unknown as IdentityRepository;
    const rlMagic = await requestMagicLinkInRepo({
      repo: rlMagicRepo,
      email: 'alice@example.com',
      appBaseUrl: 'http://localhost:5173',
      emailTemplates: templates,
      now,
    });
    expect(rlMagic).toMatchObject({ ok: false, code: 'TOO_MANY_ATTEMPTS' });

    // Failure 2: verifyMagicLink pre-consume peek refuses missing consent WITHOUT consuming token
    const consumeValidAuthTokenByHash = vi.fn();
    const peekMagicRepo = {
      findValidAuthTokenByHash: vi.fn().mockResolvedValue({
        id: 'ml-1',
        email: 'newmagic@example.com',
        tokenHash: hashToken('raw-magic'),
        expiresAt: new Date(now.getTime() + 600_000),
        usedAt: null,
      }),
      findUserByEmail: vi.fn().mockResolvedValue(null),
      consumeValidAuthTokenByHash,
    } as unknown as IdentityRepository;
    const peekRes = await verifyMagicLinkInRepo({
      runInTx: (fn) => fn(peekMagicRepo, {} as never),
      token: 'raw-magic',
      eligibilityAttested: true,
      tosAccepted: undefined,
      jwtSecret: JWT_SECRET,
      accessTokenExpiry: '15m',
      refreshExpiryDays: 7,
      cookieConfig: { httpOnly: true, secure: false, sameSite: 'lax', path: '/' },
      peekAgreements: async () => [{ id: 'doc-1' }],
      recordConsents: async () => undefined,
      now,
    });
    expect(peekRes).toMatchObject({ ok: false, code: 'SIGNUP_CONSENT_REQUIRED' });
    expect(consumeValidAuthTokenByHash).not.toHaveBeenCalled();

    // Failure 3: verifyEmailOtp wrong code increments attempts and commits without consuming until 5th
    const updateAuthTokenMetadata = vi.fn().mockResolvedValue(undefined);
    const consumeAuthTokenById = vi.fn();
    const otpWrongRepo = {
      findActiveAuthTokenByEmail: vi.fn().mockResolvedValue({
        id: 'otp-1',
        email: 'newotp@example.com',
        tokenHash: hashToken('newotp@example.com:123456'),
        expiresAt: new Date(now.getTime() + 600_000),
        usedAt: null,
        metadata: { attempts: 2 },
      }),
      updateAuthTokenMetadata,
      consumeAuthTokenById,
    } as unknown as IdentityRepository;
    const otpWrongRes = await verifyEmailOtpInRepo({
      runInTx: (fn) => fn(otpWrongRepo, {} as never),
      email: 'newotp@example.com',
      code: '000000',
      eligibilityAttested: true,
      tosAccepted: true,
      jwtSecret: JWT_SECRET,
      accessTokenExpiry: '15m',
      refreshExpiryDays: 7,
      cookieConfig: { httpOnly: true, secure: false, sameSite: 'lax', path: '/' },
      peekAgreements: async () => [{ id: 'doc-1' }],
      recordConsents: async () => undefined,
      now,
    });
    expect(otpWrongRes).toMatchObject({ ok: false, code: 'INVALID_TOKEN' });
    expect(updateAuthTokenMetadata).toHaveBeenCalledWith('otp-1', { attempts: 3 });
    expect(consumeAuthTokenById).not.toHaveBeenCalled();

    // Failure 4: verifyEmailOtp correct code with missing consent does NOT increment attempts or consume
    const otpConsentRepo = {
      findActiveAuthTokenByEmail: vi.fn().mockResolvedValue({
        id: 'otp-1',
        email: 'newotp@example.com',
        tokenHash: hashToken('newotp@example.com:123456'),
        expiresAt: new Date(now.getTime() + 600_000),
        usedAt: null,
        metadata: { attempts: 2 },
      }),
      findUserByEmail: vi.fn().mockResolvedValue(null),
      updateAuthTokenMetadata: vi.fn(),
      consumeAuthTokenById: vi.fn(),
    } as unknown as IdentityRepository;
    const otpConsentRes = await verifyEmailOtpInRepo({
      runInTx: (fn) => fn(otpConsentRepo, {} as never),
      email: 'newotp@example.com',
      code: '123456',
      eligibilityAttested: true,
      tosAccepted: false,
      jwtSecret: JWT_SECRET,
      accessTokenExpiry: '15m',
      refreshExpiryDays: 7,
      cookieConfig: { httpOnly: true, secure: false, sameSite: 'lax', path: '/' },
      peekAgreements: async () => [{ id: 'doc-1' }],
      recordConsents: async () => undefined,
      now,
    });
    expect(otpConsentRes).toMatchObject({ ok: false, code: 'SIGNUP_CONSENT_REQUIRED' });
    expect(otpConsentRepo.updateAuthTokenMetadata).not.toHaveBeenCalled();
    expect(otpConsentRepo.consumeAuthTokenById).not.toHaveBeenCalled();

    // Failure 5: emailOtpRequest IP rate-limit
    const rlOtpRepo = {
      countRecentAuthTokensByEmail: vi.fn().mockResolvedValue(0),
      countRecentAuthTokensByIp: vi.fn().mockResolvedValue(15),
    } as unknown as IdentityRepository;
    const rlOtp = await requestEmailOtpInRepo({
      repo: rlOtpRepo,
      email: 'a@b.io',
      ipAddress: '203.0.113.9',
      emailTemplates: templates,
      now,
    });
    expect(rlOtp).toMatchObject({ ok: false, code: 'TOO_MANY_ATTEMPTS' });

    // Positive: generateUniqueUsernameInRepo falls back to suffixed candidate on collision
    const uRepo = {
      findUserByUsername: vi.fn().mockResolvedValueOnce(makeUser()).mockResolvedValueOnce(null),
    } as unknown as IdentityRepository;
    const generated = await generateUniqueUsernameInRepo(uRepo, 'alice@example.com');
    expect(generated.startsWith('alice_')).toBe(true);
  });

  it('enforces password reset, setPassword, onboarding, verifyEmail, and email change/revert invariants', async () => {
    const now = new Date('2026-07-15T10:00:00.000Z');
    const validHash = await hashPassword('Correct$Horse9Battery!Staple', TEST_ARGON2);
    const templates = createAuthEmailTemplates();

    // Failure 1: setPassword rejects user who already has a real password
    const pwUserRepo = {
      findUserById: vi.fn().mockResolvedValue(makeUser({ passwordHash: validHash })),
    } as unknown as IdentityRepository;
    const setPwRes = await setPasswordInRepo(
      pwUserRepo,
      'u-1',
      'Another$Strong9Pass!Word',
      TEST_ARGON2,
    );
    expect(setPwRes).toMatchObject({ ok: false, code: 'PASSWORD_ALREADY_SET' });

    // Failure 2: completeOnboarding rejects already-onboarded account
    const onbRes = await completeOnboardingInRepo(
      pwUserRepo,
      pwUserRepo,
      'u-1',
      {
        firstName: 'Alice',
        lastName: 'Liddell',
        username: 'alice_new',
        password: 'Another$Strong9Pass!Word',
      },
      TEST_ARGON2,
    );
    expect(onbRes).toMatchObject({ ok: false, code: 'ONBOARDING_ALREADY_COMPLETE' });

    // Failure 3: resetPassword rejects invalid token
    const emptyTokenRepo = {
      findValidAuthTokenByHash: vi.fn().mockResolvedValue(null),
    } as unknown as IdentityRepository;
    const rstRes = await resetPasswordInRepo({
      repo: emptyTokenRepo,
      runInTx: (fn) => fn(emptyTokenRepo),
      token: 'bad',
      newPassword: 'Another$Strong9Pass!Word',
      argon2Config: TEST_ARGON2,
      now,
    });
    expect(rstRes).toMatchObject({ ok: false, code: 'INVALID_TOKEN' });

    // Failure 4: verifyEmail rejects invalid token
    const verRes = await verifyEmailInRepo({
      repo: emptyTokenRepo,
      runInTx: (fn) => fn(emptyTokenRepo),
      token: 'bad',
      jwtSecret: JWT_SECRET,
      accessTokenExpiry: '15m',
      refreshExpiryDays: 7,
      cookieConfig: { httpOnly: true, secure: false, sameSite: 'lax', path: '/' },
      now,
    });
    expect(verRes).toMatchObject({ ok: false, code: 'INVALID_TOKEN' });

    // Failure 5: initiateEmailChange rejects reserved anonymized domain
    const initRes = await initiateEmailChangeInRepo({
      viewerRepo: pwUserRepo,
      systemRepo: pwUserRepo,
      userId: 'u-1',
      newEmail: 'deleted-1@anonymized.invalid',
      password: 'Correct$Horse9Battery!Staple',
      argon2Config: TEST_ARGON2,
      appBaseUrl: 'http://localhost:5173',
      emailTemplates: templates,
      now,
    });
    expect(initRes).toMatchObject({ ok: false, code: 'RESERVED_EMAIL_DOMAIN' });

    // Failure 6: confirmEmailChange rejects already-used token
    const usedConfirmRepo = {
      findAuthTokenByHash: vi.fn().mockResolvedValue({
        id: 'ec-1',
        userId: 'u-1',
        usedAt: now,
        expiresAt: new Date(now.getTime() + 3600_000),
        metadata: { newEmail: 'new@example.com' },
      }),
    } as unknown as IdentityRepository;
    const confRes = await confirmEmailChangeInRepo(usedConfirmRepo, 'tok', now);
    expect(confRes).toMatchObject({ ok: false, code: 'INVALID_TOKEN' });

    // Positive: revertEmailChange restores previous email, locks account, and revokes all sessions
    const updateUser = vi.fn().mockResolvedValue(makeUser({ email: 'old@example.com' }));
    const consumeAuthTokenById = vi.fn().mockResolvedValue({ id: 'rev-1' });
    const stampAllUserRefreshFamiliesRevoked = vi.fn().mockResolvedValue(1);
    const deleteRefreshTokensByUserId = vi.fn().mockResolvedValue(1);
    const revokeAllUserSessions = vi.fn().mockResolvedValue(1);
    const revRepo = {
      findAuthTokenByHash: vi.fn().mockResolvedValue({
        id: 'rev-1',
        userId: 'u-1',
        usedAt: null,
        expiresAt: new Date(now.getTime() + 3600_000),
        metadata: { oldEmail: 'old@example.com', newEmail: 'hijacked@example.com' },
      }),
      findUserById: vi
        .fn()
        .mockResolvedValue(makeUser({ id: 'u-1', email: 'hijacked@example.com' })),
      updateUser,
      consumeAuthTokenById,
      stampAllUserRefreshFamiliesRevoked,
      deleteRefreshTokensByUserId,
      revokeAllUserSessions,
    } as unknown as IdentityRepository;
    const revRes = await revertEmailChangeInRepo(revRepo, 'revert-tok', now);
    expect(revRes).toEqual({
      ok: true,
      value: {
        message: 'Email address has been reverted and your account has been locked.',
        email: 'old@example.com',
      },
    });
    expect(updateUser).toHaveBeenCalledWith(
      'u-1',
      expect.objectContaining({
        email: 'old@example.com',
        lockedUntil: new Date('2099-12-31T23:59:59.999Z'),
      }),
    );
    expect(revokeAllUserSessions).toHaveBeenCalledWith('u-1', now);
  });
});
