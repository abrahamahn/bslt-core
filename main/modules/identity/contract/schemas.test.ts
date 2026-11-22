// main/modules/identity/contract/schemas.test.ts
import { describe, expect, it } from 'vitest';

import { emptyBodySchema } from '@bslt/contract';
import { describe as describeSchema } from '@bslt/schema';

import {
  ACCOUNT_DELETION_GRACE_PERIOD_DAYS,
  ADMIN_LIST_MAX_OFFSET,
  ADMIN_USER_SEARCH_MAX_LIMIT,
  API_KEY_MAX_EXPIRY_DAYS,
  DEFAULT_SESSION_DAYS,
  LOCKOUT_DURATION_MINUTES,
  MAX_IDLE_MS,
  MAX_LOCKOUT_DURATION_MINUTES,
  REMEMBERED_SESSION_DAYS,
  SIGNUP_ATTESTATION_VERSION,
  USER_STATUSES,
  accountLifecycleResponseSchema,
  adminCreateUserRequestSchema,
  adminHardBanResponseSchema,
  adminLockUserRequestSchema,
  adminUpdateUserRequestSchema,
  adminUserListFiltersSchema,
  adminUserListResponseSchema,
  adminUserSchema,
  adminUserSearchQuerySchema,
  adminUserSearchResponseSchema,
  apiKeySchema,
  apiKeysListResponseSchema,
  authResponseSchema,
  authStrategiesResponseSchema,
  backupCodesRegenerateResponseSchema,
  backupCodesStatusResponseSchema,
  bffLoginResponseSchema,
  calculateDeletionGracePeriodEnd,
  canDeactivate,
  canReactivate,
  canRequestDeletion,
  changeEmailRequestSchema,
  changePasswordRequestSchema,
  completeOnboardingRequestSchema,
  confirmEmailChangeRequestSchema,
  createApiKeyRequestSchema,
  createApiKeyResponseSchema,
  createSignupAttestation,
  createdApiKeySchema,
  deactivateAccountRequestSchema,
  deleteAccountRequestSchema,
  deleteApiKeyResponseSchema,
  deviceItemSchema,
  deviceListResponseSchema,
  emailOtpRequestSchema,
  emailOtpVerifyRequestSchema,
  emailOtpVerifyResponseSchema,
  emailVerificationRequestSchema,
  forgotPasswordRequestSchema,
  getAccountStatus,
  getNextUsernameChangeDate,
  getProfileFieldLabel,
  getUserDisplayName,
  isAttestationConfirmed,
  isUsernameChangeCooldownActive,
  loginRequestSchema,
  loginResponseSchema,
  magicLinkRequestSchema,
  magicLinkVerifyRequestSchema,
  passkeyListItemSchema,
  passkeyListResponseSchema,
  profileCompletenessResponseSchema,
  refreshResponseSchema,
  registerRequestSchema,
  registerResponseSchema,
  renamePasskeyRequestSchema,
  resendVerificationRequestSchema,
  resetPasswordRequestSchema,
  revertEmailChangeRequestSchema,
  sessionIdleWindowMs,
  sessionSchema,
  sessionSpanDays,
  sessionSpanDaysOf,
  sessionsListResponseSchema,
  setPasswordRequestSchema,
  setPhoneRequestSchema,
  smsChallengeRequestSchema,
  smsLoginChallengeResponseSchema,
  smsVerifyRequestSchema,
  sudoRequestSchema,
  sudoResponseSchema,
  totpLoginChallengeResponseSchema,
  totpLoginVerifyRequestSchema,
  totpSetupResponseSchema,
  totpStatusResponseSchema,
  totpVerifyRequestSchema,
  trustDeviceResponseSchema,
  updateProfileRequestSchema,
  updateUsernameRequestSchema,
  userSchema,
  usernameSchema,
  validatePassword,
  validatePasswordBasic,
  verifyPhoneRequestSchema,
  webauthnLoginOptionsRequestSchema,
  webauthnLoginVerifyRequestSchema,
  webauthnOptionsResponseSchema,
  webauthnRegisterVerifyRequestSchema,
  webauthnRegisterVerifyResponseSchema,
} from './schemas';

const VALID_KEY = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'CI deploy bot',
  keyPrefix: 'bslt_abcdef',
  last4: 'wxyz',
  lastUsedAt: null,
  expiresAt: '2027-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const VALID_USER = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'alice@example.com',
  username: 'alice_1',
  firstName: 'Alice',
  lastName: 'Liddell',
  role: 'user' as const,
  emailVerified: true,
  phone: null,
  phoneVerified: null,
  dateOfBirth: null,
  gender: null,
  bio: null,
  city: null,
  state: null,
  country: null,
  language: 'en-US',
  website: 'https://example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deactivatedAt: null,
  deletedAt: null,
  deletionGracePeriodEnds: null,
};

const VALID_ADMIN_USER = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'alice@example.com',
  username: 'alice_1',
  firstName: 'Alice',
  lastName: 'Liddell',
  role: 'admin' as const,
  emailVerified: true,
  emailVerifiedAt: '2026-01-01T00:00:00.000Z',
  lockedUntil: null,
  lockReason: null,
  failedLoginAttempts: 0,
  phone: null,
  phoneVerified: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('identity contract schemas', () => {
  it('introspects every schema via describe() without opaque nodes', () => {
    const schemas = [
      apiKeySchema,
      createdApiKeySchema,
      createApiKeyRequestSchema,
      apiKeysListResponseSchema,
      createApiKeyResponseSchema,
      deleteApiKeyResponseSchema,
      usernameSchema,
      userSchema,
      updateProfileRequestSchema,
      profileCompletenessResponseSchema,
      changePasswordRequestSchema,
      sessionSchema,
      sessionsListResponseSchema,
      deactivateAccountRequestSchema,
      deleteAccountRequestSchema,
      accountLifecycleResponseSchema,
      adminUserSchema,
      adminUserListFiltersSchema,
      adminUserListResponseSchema,
      adminUserSearchQuerySchema,
      adminUserSearchResponseSchema,
      adminUpdateUserRequestSchema,
      adminLockUserRequestSchema,
      adminCreateUserRequestSchema,
      adminHardBanResponseSchema,
      sudoRequestSchema,
      sudoResponseSchema,
      authResponseSchema,
      deviceItemSchema,
      deviceListResponseSchema,
      trustDeviceResponseSchema,
      setPhoneRequestSchema,
      verifyPhoneRequestSchema,
      smsChallengeRequestSchema,
      smsVerifyRequestSchema,
      totpSetupResponseSchema,
      totpVerifyRequestSchema,
      totpStatusResponseSchema,
      backupCodesStatusResponseSchema,
      backupCodesRegenerateResponseSchema,
      totpLoginVerifyRequestSchema,
      totpLoginChallengeResponseSchema,
      webauthnOptionsResponseSchema,
      webauthnRegisterVerifyRequestSchema,
      webauthnRegisterVerifyResponseSchema,
      webauthnLoginOptionsRequestSchema,
      webauthnLoginVerifyRequestSchema,
      renamePasskeyRequestSchema,
      passkeyListItemSchema,
      passkeyListResponseSchema,
    ];
    for (const s of schemas) {
      expect(describeSchema(s).kind).not.toBe('opaque');
    }
  });

  it('parses valid API key requests and rejects empty/overlong names, invalid expiry, and unknown keys', () => {
    expect(API_KEY_MAX_EXPIRY_DAYS).toBe(3650);
    expect(createApiKeyRequestSchema.parse({ name: '  CI deploy bot  ' })).toEqual({
      name: 'CI deploy bot',
    });
    expect(apiKeySchema.parse(VALID_KEY)).toEqual(VALID_KEY);
    expect(createdApiKeySchema.parse({ ...VALID_KEY, token: 'bslt_sec' }).token).toBe('bslt_sec');
    expect(apiKeysListResponseSchema.parse({ keys: [VALID_KEY] }).keys).toHaveLength(1);
    expect(
      createApiKeyResponseSchema.parse({ key: { ...VALID_KEY, token: 'bslt_s' } }).key.id,
    ).toBe(VALID_KEY.id);
    expect(deleteApiKeyResponseSchema.parse({ id: VALID_KEY.id }).id).toBe(VALID_KEY.id);
    expect(emptyBodySchema.parse({})).toEqual({});

    expect(createApiKeyRequestSchema.safeParse({ name: '' }).success).toBe(false);
    expect(createApiKeyRequestSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(createApiKeyRequestSchema.safeParse({ name: 'x'.repeat(101) }).success).toBe(false);
    expect(createApiKeyRequestSchema.safeParse({ name: 'ok', expiresInDays: 0 }).success).toBe(
      false,
    );
    expect(createApiKeyRequestSchema.safeParse({ name: 'ok', expiresInDays: 3651 }).success).toBe(
      false,
    );
    expect(createApiKeyRequestSchema.safeParse({ name: 'ok', tokenHash: 'x' }).success).toBe(false);
    expect(apiKeySchema.safeParse({ ...VALID_KEY, token: 'leak' }).success).toBe(false);
  });

  it('normalizes valid usernames and rejects reserved, short, numeric-leading, and punctuation usernames', () => {
    expect(usernameSchema.parse('  Alice_42  ')).toBe('alice_42');
    expect(updateUsernameRequestSchema.parse({ username: 'Valid_Name' })).toEqual({
      username: 'valid_name',
    });

    for (const invalid of [
      '',
      'a',
      '1alice',
      '_alice',
      'alice-bob',
      'admin',
      'root',
      'system',
      'a'.repeat(31),
    ]) {
      expect(usernameSchema.safeParse(invalid).success, `username=${invalid}`).toBe(false);
    }
  });

  it('validates user profile, completeness, sessions, and rejects avatarUrl or unknown properties', () => {
    expect(userSchema.parse(VALID_USER)).toEqual(VALID_USER);
    expect(userSchema.safeParse({ ...VALID_USER, avatarUrl: 'https://cdn/a.png' }).success).toBe(
      false,
    );
    expect(updateProfileRequestSchema.parse({ firstName: 'Alice', language: 'en, ko' })).toEqual({
      firstName: 'Alice',
      language: 'en, ko',
    });
    expect(updateProfileRequestSchema.safeParse({ firstName: '' }).success).toBe(false);
    expect(updateProfileRequestSchema.safeParse({ website: 'not-a-url' }).success).toBe(false);
    expect(updateProfileRequestSchema.safeParse({ bio: 'x'.repeat(501) }).success).toBe(false);

    expect(
      profileCompletenessResponseSchema.parse({ percentage: 80, missingFields: ['bio'] }),
    ).toEqual({ percentage: 80, missingFields: ['bio'] });
    expect(profileCompletenessResponseSchema.safeParse({ percentage: '80' }).success).toBe(false);

    expect(
      sessionsListResponseSchema.parse({
        sessions: [
          {
            id: VALID_KEY.id,
            createdAt: VALID_KEY.createdAt,
            expiresAt: VALID_KEY.expiresAt,
            lastUsedAt: VALID_KEY.createdAt,
            device: 'Chrome on Linux',
            ipAddress: '127.0.0.1',
            userAgent: 'Mozilla/5.0',
            isCurrent: true,
          },
        ],
      }).sessions,
    ).toHaveLength(1);
    expect(sessionSchema.safeParse({ id: 'bad' }).success).toBe(false);
    expect(getProfileFieldLabel('firstName')).toBe('First name');
    expect(getProfileFieldLabel('custom')).toBe('custom');
    expect(getUserDisplayName({ firstName: 'Alice', lastName: 'Liddell' })).toBe('Alice Liddell');
    expect(getUserDisplayName({ firstName: '', lastName: '', username: 'alice' })).toBe('alice');
  });

  it('validates admin user filters, search queries, lockout durations, and rejects invalid inputs', () => {
    expect(MAX_LOCKOUT_DURATION_MINUTES).toBe(LOCKOUT_DURATION_MINUTES.thirtyDays);
    expect(ADMIN_LIST_MAX_OFFSET).toBe(100_000);
    expect(adminUserSchema.parse(VALID_ADMIN_USER)).toEqual(VALID_ADMIN_USER);

    expect(
      adminUserListFiltersSchema.parse({ page: '2', limit: '25', role: 'admin', status: 'active' }),
    ).toEqual({ page: 2, limit: 25, role: 'admin', status: 'active' });
    expect(adminUserListFiltersSchema.safeParse({ sortBy: 'passwordHash' }).success).toBe(false);
    expect(adminUserListFiltersSchema.safeParse({ page: '0' }).success).toBe(false);
    expect(adminUserListFiltersSchema.safeParse({ limit: '101' }).success).toBe(false);

    expect(adminUserSearchQuerySchema.parse({ q: '  alice  ' })).toEqual({
      q: 'alice',
      limit: 20,
      offset: 0,
    });
    expect(adminUserSearchQuerySchema.safeParse({ q: '   ' }).success).toBe(false);
    expect(
      adminUserSearchQuerySchema.safeParse({ q: 'a', offset: ADMIN_LIST_MAX_OFFSET + 1 }).success,
    ).toBe(false);

    expect(adminUpdateUserRequestSchema.safeParse({}).success).toBe(false);
    expect(adminUpdateUserRequestSchema.parse({ role: 'moderator' })).toEqual({
      role: 'moderator',
    });

    expect(
      adminLockUserRequestSchema.safeParse({
        reason: 'spam',
        durationMinutes: MAX_LOCKOUT_DURATION_MINUTES + 1,
      }).success,
    ).toBe(false);
    expect(adminLockUserRequestSchema.safeParse({ reason: '' }).success).toBe(false);

    expect(
      adminCreateUserRequestSchema.parse({
        email: 'New@Example.com',
        firstName: 'New',
        lastName: 'User',
        username: 'New_User',
      }),
    ).toEqual({
      email: 'new@example.com',
      firstName: 'New',
      lastName: 'User',
      username: 'new_user',
    });
    expect(
      adminCreateUserRequestSchema.safeParse({
        email: 'bad',
        firstName: 'New',
        lastName: 'User',
      }).success,
    ).toBe(false);

    expect(
      adminHardBanResponseSchema.parse({
        message: 'Banned',
        gracePeriodEnds: '2026-02-01T00:00:00.000Z',
        subscriptionsCancelled: false,
      }),
    ).toEqual({
      message: 'Banned',
      gracePeriodEnds: '2026-02-01T00:00:00.000Z',
      subscriptionsCancelled: false,
    });
  });

  it('enforces lifecycle state transitions, username cooldowns, and password strength rules', () => {
    expect(ACCOUNT_DELETION_GRACE_PERIOD_DAYS).toBe(30);
    const active = { deactivatedAt: null, deletedAt: null, deletionGracePeriodEnds: null };
    const deactivated = {
      deactivatedAt: new Date('2026-01-01T00:00:00.000Z'),
      deletedAt: null,
      deletionGracePeriodEnds: null,
    };
    const expiredDelete = {
      deactivatedAt: null,
      deletedAt: new Date('2020-01-01T00:00:00.000Z'),
      deletionGracePeriodEnds: new Date('2020-01-31T00:00:00.000Z'),
    };
    expect(getAccountStatus(active)).toBe('active');
    expect(canDeactivate(active)).toBe(true);
    expect(canDeactivate(deactivated)).toBe(false);
    expect(canReactivate(active)).toBe(false);
    expect(canReactivate(deactivated)).toBe(true);
    expect(canReactivate(expiredDelete)).toBe(false);
    expect(canRequestDeletion(expiredDelete)).toBe(false);
    expect(
      calculateDeletionGracePeriodEnd(new Date('2026-01-01T00:00:00.000Z')).toISOString(),
    ).toBe('2026-01-31T00:00:00.000Z');

    expect(isUsernameChangeCooldownActive(null)).toBe(false);
    expect(isUsernameChangeCooldownActive(new Date())).toBe(true);
    expect(getNextUsernameChangeDate(new Date('2026-01-01T00:00:00.000Z')).toISOString()).toBe(
      '2026-01-31T00:00:00.000Z',
    );

    expect(
      changePasswordRequestSchema.safeParse({ currentPassword: '', newPassword: 'short' }).success,
    ).toBe(false);
    expect(validatePassword('password123').isValid).toBe(false);
    expect(validatePassword('AliceLiddell!23', ['alice@example.com', 'Alice']).isValid).toBe(false);
    expect(validatePasswordBasic('aaaaaaaaaa').isValid).toBe(false);
    expect(validatePassword('Correct$Horse9Battery!Staple').isValid).toBe(true);

    expect(deactivateAccountRequestSchema.parse({})).toEqual({});
    expect(deleteAccountRequestSchema.parse({ reason: 'bye' })).toEqual({ reason: 'bye' });
    expect(accountLifecycleResponseSchema.parse({ message: 'ok', status: 'deactivated' })).toEqual({
      message: 'ok',
      status: 'deactivated',
    });
    expect(
      accountLifecycleResponseSchema.safeParse({ message: 'ok', status: 'invalid' }).success,
    ).toBe(false);
  });

  it('validates core auth, magic-link, OTP, onboarding, email-change, attestation, and session span rules with >= 60% failure assertions', () => {
    // Attestation strictness (rejects non-true values)
    expect(isAttestationConfirmed(false)).toBe(false);
    expect(isAttestationConfirmed('true')).toBe(false);
    expect(isAttestationConfirmed(1)).toBe(false);
    expect(isAttestationConfirmed(undefined)).toBe(false);
    expect(isAttestationConfirmed(null)).toBe(false);
    expect(isAttestationConfirmed(true)).toBe(true);
    const att = createSignupAttestation(new Date('2026-07-15T00:00:00.000Z'));
    expect(att.version).toBe(SIGNUP_ATTESTATION_VERSION);

    // Session span & idle window math
    expect(sessionSpanDays(undefined)).toBe(DEFAULT_SESSION_DAYS);
    expect(sessionSpanDays(false)).toBe(DEFAULT_SESSION_DAYS);
    expect(sessionSpanDays(true)).toBe(REMEMBERED_SESSION_DAYS);
    const t0 = new Date('2026-01-01T00:00:00.000Z');
    const t30 = new Date('2026-01-31T00:00:00.000Z');
    expect(sessionSpanDaysOf(t0, t30)).toBe(30);
    expect(sessionIdleWindowMs(30)).toBe(MAX_IDLE_MS);
    expect(sessionIdleWindowMs(0.5)).toBeLessThan(MAX_IDLE_MS);

    // Failure assertions across auth schemas
    expect(registerRequestSchema.safeParse({}).success).toBe(false);
    expect(
      registerRequestSchema.safeParse({
        email: 'bad',
        username: 'alice_ok',
        firstName: 'Alice',
        lastName: 'Liddell',
        password: 'ValidPassword123!',
        tosAccepted: true,
        eligibilityAttested: true,
      }).success,
    ).toBe(false);
    expect(
      registerRequestSchema.safeParse({
        email: 'alice@example.com',
        username: 'admin',
        firstName: 'Alice',
        lastName: 'Liddell',
        password: 'ValidPassword123!',
        tosAccepted: true,
        eligibilityAttested: true,
      }).success,
    ).toBe(false);
    expect(
      loginRequestSchema.safeParse({ identifier: '   ', password: 'ValidPassword123!' }).success,
    ).toBe(false);
    // BFF login response MUST reject token / accessToken fields
    expect(
      bffLoginResponseSchema.safeParse({ user: VALID_USER, token: 'leaked-jwt' }).success,
    ).toBe(false);
    expect(
      bffLoginResponseSchema.safeParse({ user: VALID_USER, accessToken: 'leaked-jwt' }).success,
    ).toBe(false);
    expect(loginResponseSchema.safeParse({ user: VALID_USER, token: 'leaked-jwt' }).success).toBe(
      false,
    );
    expect(refreshResponseSchema.safeParse({ token: '' }).success).toBe(false);
    expect(authStrategiesResponseSchema.safeParse({ enabled: [''], disabled: [] }).success).toBe(
      false,
    );
    expect(emailVerificationRequestSchema.safeParse({ token: '' }).success).toBe(false);
    expect(resendVerificationRequestSchema.safeParse({ email: 'not-email' }).success).toBe(false);
    expect(forgotPasswordRequestSchema.safeParse({ email: '' }).success).toBe(false);
    expect(
      resetPasswordRequestSchema.safeParse({ token: '', password: 'ValidPassword123!' }).success,
    ).toBe(false);
    expect(setPasswordRequestSchema.safeParse({ password: 'short' }).success).toBe(false);
    expect(magicLinkRequestSchema.safeParse({ email: 'bad' }).success).toBe(false);
    expect(magicLinkVerifyRequestSchema.safeParse({ token: '' }).success).toBe(false);
    expect(emailOtpRequestSchema.safeParse({ email: 'bad' }).success).toBe(false);
    expect(emailOtpVerifyRequestSchema.safeParse({ email: 'a@b.io', code: '12345' }).success).toBe(
      false,
    );
    expect(emailOtpVerifyRequestSchema.safeParse({ email: 'a@b.io', code: '12345a' }).success).toBe(
      false,
    );
    expect(
      completeOnboardingRequestSchema.safeParse({
        firstName: '',
        lastName: 'B',
        username: 'valid_user',
        password: 'ValidPassword123!',
      }).success,
    ).toBe(false);
    expect(
      changeEmailRequestSchema.safeParse({ newEmail: 'bad', password: 'ValidPassword123!' })
        .success,
    ).toBe(false);
    expect(confirmEmailChangeRequestSchema.safeParse({ token: '' }).success).toBe(false);
    expect(revertEmailChangeRequestSchema.safeParse({ token: '' }).success).toBe(false);

    // Positive assertions
    expect(loginResponseSchema.parse({ user: VALID_USER, isNewDevice: true })).toEqual({
      user: VALID_USER,
      isNewDevice: true,
    });
    expect(
      loginResponseSchema.parse({
        requiresSms: true,
        challengeToken: 'sms-chal',
        message: 'SMS required',
      }),
    ).toEqual(
      smsLoginChallengeResponseSchema.parse({
        requiresSms: true,
        challengeToken: 'sms-chal',
        message: 'SMS required',
      }),
    );
    expect(
      registerResponseSchema.parse({
        status: 'pending_verification',
        message: 'Sent',
        email: 'alice@example.com',
      }).status,
    ).toBe('pending_verification');
    expect(
      emailOtpVerifyRequestSchema.parse({
        email: 'Alice@Example.com',
        code: ' 042918 ',
        eligibilityAttested: true,
        tosAccepted: true,
      }),
    ).toEqual({
      email: 'alice@example.com',
      code: '042918',
      eligibilityAttested: true,
      tosAccepted: true,
    });
    expect(
      emailOtpVerifyResponseSchema.parse({
        token: 'jwt',
        user: VALID_USER,
        isNewUser: true,
      }).isNewUser,
    ).toBe(true);
    expect(USER_STATUSES).toContain('active');
    expect(USER_STATUSES).toContain('locked');
    expect(ADMIN_USER_SEARCH_MAX_LIMIT).toBeGreaterThan(0);
  });
});
