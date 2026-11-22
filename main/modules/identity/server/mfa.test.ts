// main/modules/identity/server/mfa.test.ts
import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { totpCode } from '@bslt/protocols/totp';

import {
  burnChallenge,
  checkSmsRateLimitInRepo,
  checkTotpVerifyRateLimit,
  disableTotpInRepo,
  enableTotpInRepo,
  getBackupCodesStatusInRepo,
  getTotpStatusInRepo,
  isChallengeBurned,
  regenerateBackupCodesInRepo,
  resetBurnedChallenges,
  resetTotpVerifyRateLimiter,
  sendSms2faCodeInRepo,
  setupTotpInRepo,
  verifyPhoneInRepo,
  verifySms2faCodeInRepo,
  verifyTotpCode,
  verifyTotpForLoginInRepo,
} from './mfa';

import type { IdentityRepository } from './repository';

const ENC_KEY = 'test-encryption-key-with-at-least-32-chars!';
const FAST_ARGON2 = { type: 2 as const, memoryCost: 1024, timeCost: 1, parallelism: 1 };
const TOTP_OPTS = {
  issuer: 'BSLT Test',
  window: 1,
  encryptionKey: ENC_KEY,
  argon2Config: FAST_ARGON2,
};

function stubRepo(overrides: Partial<IdentityRepository> = {}): IdentityRepository {
  return {
    getUserTotpState: vi.fn().mockResolvedValue(null),
    setUserTotpSetup: vi.fn().mockResolvedValue(undefined),
    setUserTotpEnabled: vi.fn().mockResolvedValue(undefined),
    compareAndSwapUserTotpSecret: vi.fn().mockResolvedValue(undefined),
    getBackupCodesCounts: vi.fn().mockResolvedValue({ remaining: 0, total: 0 }),
    listUnusedBackupCodes: vi.fn().mockResolvedValue([]),
    claimUnusedBackupCode: vi.fn().mockResolvedValue(false),
    replaceUserBackupCodes: vi.fn().mockResolvedValue(undefined),
    deleteUserBackupCodes: vi.fn().mockResolvedValue(undefined),
    countRecentSmsCodes: vi.fn().mockResolvedValue({ count: 0, oldestCreatedAt: null }),
    invalidatePendingSmsCodes: vi.fn().mockResolvedValue(undefined),
    insertSmsVerificationCode: vi.fn().mockResolvedValue(undefined),
    findPendingSmsCode: vi.fn().mockResolvedValue(null),
    incrementSmsCodeAttempts: vi.fn().mockResolvedValue(undefined),
    markSmsCodeVerified: vi.fn().mockResolvedValue(undefined),
    findLatestVerifiedSmsPhone: vi.fn().mockResolvedValue(null),
    setUserVerifiedPhone: vi.fn().mockResolvedValue(undefined),
    clearUserPhone: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as IdentityRepository;
}

describe('identity MFA (TOTP, backup codes, burned challenges, and SMS 2FA)', () => {
  beforeEach(() => {
    resetBurnedChallenges();
    resetTotpVerifyRateLimiter();
  });

  it('rejects missing setup, already-enabled 2FA, wrong TOTP/backup codes, and burned/rate-limited challenges before enabling/disabling', async () => {
    // Failure 1: enable without setup
    const noSetup = await enableTotpInRepo(stubRepo(), 'u-1', '123456', TOTP_OPTS);
    expect(noSetup).toEqual({ success: false, message: 'TOTP not set up. Call setup first.' });

    // Setup generates secret + 10 backup codes and stores encrypted secret
    const setSetup = vi.fn().mockResolvedValue(undefined);
    const replaceCodes = vi.fn().mockResolvedValue(undefined);
    const setupRes = await setupTotpInRepo(
      stubRepo({ setUserTotpSetup: setSetup, replaceUserBackupCodes: replaceCodes }),
      'u-1',
      'alice@example.com',
      TOTP_OPTS,
    );
    expect(setupRes.backupCodes).toHaveLength(10);
    const storedEncrypted = setSetup.mock.calls[0]?.[1] as string;
    const storedHashes = replaceCodes.mock.calls[0]?.[1] as string[];
    expect(storedEncrypted).toContain(':');

    // Failure 2: already enabled
    const alreadyOn = await enableTotpInRepo(
      stubRepo({
        getUserTotpState: vi
          .fn()
          .mockResolvedValue({ totpSecret: storedEncrypted, totpEnabled: true }),
      }),
      'u-1',
      '123456',
      TOTP_OPTS,
    );
    expect(alreadyOn).toEqual({ success: false, message: '2FA is already enabled.' });

    // Failure 3: wrong TOTP code during enable
    const wrongCode = await enableTotpInRepo(
      stubRepo({
        getUserTotpState: vi
          .fn()
          .mockResolvedValue({ totpSecret: storedEncrypted, totpEnabled: false }),
      }),
      'u-1',
      '000000',
      TOTP_OPTS,
    );
    expect(wrongCode.success).toBe(false);

    // Failure 4: disable when not enabled
    const notEnabled = await disableTotpInRepo(stubRepo(), 'u-1', '123456', TOTP_OPTS);
    expect(notEnabled).toEqual({ success: false, message: '2FA is not enabled.' });

    // Failure 5: regenerate backup codes when 2FA is off
    const regenOff = await regenerateBackupCodesInRepo(stubRepo(), 'u-1', '123456', TOTP_OPTS);
    expect(regenOff.ok).toBe(false);

    // Failure 6: burned challenge tracking + 5/min per-account rate limit
    burnChallenge('jti-1', 60_000);
    expect(isChallengeBurned('jti-1')).toBe(true);
    burnChallenge('jti-expired', 0);
    expect(isChallengeBurned('jti-expired')).toBe(false);
    for (let i = 0; i < 5; i++) {
      expect((await checkTotpVerifyRateLimit('u-rate')).allowed).toBe(true);
    }
    expect((await checkTotpVerifyRateLimit('u-rate')).allowed).toBe(false);

    // Positive: valid TOTP code enables 2FA, upgrades legacy plaintext seed on login, and backup code claims once
    const validCode = totpCode(setupRes.secret);
    expect(verifyTotpCode(storedEncrypted, validCode, 1, ENC_KEY)).toBe(true);
    const enabled = await enableTotpInRepo(
      stubRepo({
        getUserTotpState: vi
          .fn()
          .mockResolvedValue({ totpSecret: storedEncrypted, totpEnabled: false }),
      }),
      'u-1',
      validCode,
      TOTP_OPTS,
    );
    expect(enabled.success).toBe(true);

    const casSpy = vi.fn().mockResolvedValue(undefined);
    const legacyOk = await verifyTotpForLoginInRepo(
      stubRepo({
        getUserTotpState: vi
          .fn()
          .mockResolvedValue({ totpSecret: setupRes.secret, totpEnabled: true }),
        compareAndSwapUserTotpSecret: casSpy,
      }),
      'u-1',
      validCode,
      TOTP_OPTS,
    );
    expect(legacyOk).toBe(true);
    expect(casSpy).toHaveBeenCalledTimes(1);

    // Backup code login: succeeds when claimUnusedBackupCode returns true, fails on lost race (false)
    const firstPlainBackup = setupRes.backupCodes[0]!;
    const firstHash = storedHashes[0]!;
    const raceLost = await verifyTotpForLoginInRepo(
      stubRepo({
        getUserTotpState: vi
          .fn()
          .mockResolvedValue({ totpSecret: storedEncrypted, totpEnabled: true }),
        listUnusedBackupCodes: vi.fn().mockResolvedValue([{ id: 'bc-1', codeHash: firstHash }]),
        claimUnusedBackupCode: vi.fn().mockResolvedValue(false),
      }),
      'u-1',
      firstPlainBackup,
      TOTP_OPTS,
    );
    expect(raceLost).toBe(false);

    const backupWon = await verifyTotpForLoginInRepo(
      stubRepo({
        getUserTotpState: vi
          .fn()
          .mockResolvedValue({ totpSecret: storedEncrypted, totpEnabled: true }),
        listUnusedBackupCodes: vi.fn().mockResolvedValue([{ id: 'bc-1', codeHash: firstHash }]),
        claimUnusedBackupCode: vi.fn().mockResolvedValue(true),
      }),
      'u-1',
      firstPlainBackup,
      TOTP_OPTS,
    );
    expect(backupWon).toBe(true);

    expect(
      await getTotpStatusInRepo(
        stubRepo({
          getUserTotpState: vi
            .fn()
            .mockResolvedValue({ totpSecret: storedEncrypted, totpEnabled: true }),
        }),
        'u-1',
      ),
    ).toEqual({ enabled: true });
    expect(
      await getBackupCodesStatusInRepo(
        stubRepo({
          getBackupCodesCounts: vi.fn().mockResolvedValue({ remaining: 9, total: 10 }),
        }),
        'u-1',
      ),
    ).toEqual({ remaining: 9, total: 10 });
  });

  it('enforces SMS hourly/daily rate limits, max 5 code attempts, provider errors, and missing pending phone verification', async () => {
    const now = new Date('2026-01-01T12:00:00.000Z');

    // Failure 1: hourly SMS rate limit (>= 3)
    const hourlyBlocked = await checkSmsRateLimitInRepo(
      stubRepo({
        countRecentSmsCodes: vi.fn().mockResolvedValue({
          count: 3,
          oldestCreatedAt: new Date('2026-01-01T11:30:00.000Z'),
        }),
      }),
      'u-1',
      now,
    );
    expect(hourlyBlocked.allowed).toBe(false);

    // Failure 2: daily SMS rate limit (>= 10)
    const dailyBlocked = await checkSmsRateLimitInRepo(
      stubRepo({
        countRecentSmsCodes: vi
          .fn()
          .mockResolvedValueOnce({ count: 1, oldestCreatedAt: now })
          .mockResolvedValueOnce({
            count: 10,
            oldestCreatedAt: new Date('2026-01-01T01:00:00.000Z'),
          }),
      }),
      'u-1',
      now,
    );
    expect(dailyBlocked.allowed).toBe(false);

    // Failure 3: SMS provider failure
    const sendFail = await sendSms2faCodeInRepo(
      stubRepo(),
      async () => ({ success: false, error: 'Gateway timeout' }),
      'u-1',
      '+15551234567',
      now,
    );
    expect(sendFail).toEqual({ success: false, error: 'Gateway timeout' });

    // Failure 4: no pending SMS code
    expect(await verifySms2faCodeInRepo(stubRepo(), 'u-1', '123456')).toMatchObject({
      valid: false,
    });

    // Failure 5: exhausted attempts (>= 5) marks verified/consumed and rejects
    const markVerified = vi.fn().mockResolvedValue(undefined);
    const exhausted = await verifySms2faCodeInRepo(
      stubRepo({
        findPendingSmsCode: vi.fn().mockResolvedValue({
          id: 'sms-1',
          codeHash: createHash('sha256').update('123456').digest('hex'),
          attempts: 5,
          expiresAt: new Date('2026-01-01T12:05:00.000Z'),
        }),
        markSmsCodeVerified: markVerified,
      }),
      'u-1',
      '123456',
    );
    expect(exhausted.valid).toBe(false);
    expect(markVerified).toHaveBeenCalledWith('sms-1');

    // Failure 6: wrong SMS code reports remaining attempts
    const wrongSms = await verifySms2faCodeInRepo(
      stubRepo({
        findPendingSmsCode: vi.fn().mockResolvedValue({
          id: 'sms-1',
          codeHash: createHash('sha256').update('123456').digest('hex'),
          attempts: 3,
          expiresAt: new Date('2026-01-01T12:05:00.000Z'),
        }),
      }),
      'u-1',
      '999999',
    );
    expect(wrongSms).toEqual({ valid: false, message: 'Invalid code. 1 attempt remaining.' });

    // Failure 7: verifyPhoneInRepo when code valid but no verified phone row found
    const missingPhone = await verifyPhoneInRepo(
      stubRepo({
        findPendingSmsCode: vi.fn().mockResolvedValue({
          id: 'sms-1',
          codeHash: createHash('sha256').update('123456').digest('hex'),
          attempts: 0,
          expiresAt: new Date('2026-01-01T12:05:00.000Z'),
        }),
        findLatestVerifiedSmsPhone: vi.fn().mockResolvedValue(null),
      }),
      'u-1',
      '123456',
    );
    expect(missingPhone).toEqual({
      ok: false,
      code: 'PHONE_VERIFICATION_PENDING',
      message: 'No phone number to verify',
    });

    // Positive: verifyPhoneInRepo updates user phone
    const setVerified = vi.fn().mockResolvedValue(undefined);
    const verifiedPhone = await verifyPhoneInRepo(
      stubRepo({
        findPendingSmsCode: vi.fn().mockResolvedValue({
          id: 'sms-1',
          codeHash: createHash('sha256').update('654321').digest('hex'),
          attempts: 0,
          expiresAt: new Date('2026-01-01T12:05:00.000Z'),
        }),
        findLatestVerifiedSmsPhone: vi.fn().mockResolvedValue('+15551234567'),
        setUserVerifiedPhone: setVerified,
      }),
      'u-1',
      '654321',
    );
    expect(verifiedPhone).toEqual({ ok: true, value: { verified: true } });
    expect(setVerified).toHaveBeenCalledWith('u-1', '+15551234567');
  });
});
