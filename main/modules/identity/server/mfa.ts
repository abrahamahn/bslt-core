// main/modules/identity/server/mfa.ts
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

import { createTotpSecret, totpUri, verifyTotp } from '@bslt/protocols/totp';
import { RateLimiter } from '@bslt/server-system/security';

import {
  decryptTotpSecret,
  encryptTotpSecret,
  hashPassword,
  isLegacyPlaintextSecret,
  verifyPasswordSafe,
  type Argon2Config,
} from './crypto';

import type {
  BackupCodesRegenerateResponse,
  BackupCodesStatusResponse,
  TotpSetupResponse,
  TotpStatusResponse,
} from '../contract';
import type { IdentityRepository } from './repository';

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_BYTES = 4;
const BACKUP_CODE_HASH_CONFIG: Argon2Config = {
  type: 2,
  memoryCost: 8192,
  timeCost: 2,
  parallelism: 1,
};

const SMS_CODE_EXPIRY_MS = 5 * MS_PER_MINUTE;
const SMS_MAX_ATTEMPTS = 5;
const SMS_RATE_LIMIT_HOURLY = 3;
const SMS_RATE_LIMIT_DAILY = 10;
export const PHONE_REGEX = /^\+?[0-9\s\-()]{7,20}$/u;

// ============================================================================
// 1. Burned Challenge Tracker & Per-Account TOTP Guess Rate Limiter (5/min)
// ============================================================================

const burnedChallenges = new Map<string, number>();
let totpVerifyLimiter = new RateLimiter({ max: 5, windowMs: 60_000 });

function sweepBurned(now: number): void {
  for (const [jti, expiresAt] of burnedChallenges) {
    if (expiresAt <= now) {
      burnedChallenges.delete(jti);
    }
  }
}

export function burnChallenge(jti: string, ttlMs: number): void {
  const now = Date.now();
  sweepBurned(now);
  burnedChallenges.set(jti, now + Math.max(0, ttlMs));
}

export function isChallengeBurned(jti: string): boolean {
  const expiresAt = burnedChallenges.get(jti);
  if (expiresAt === undefined) return false;
  if (expiresAt <= Date.now()) {
    burnedChallenges.delete(jti);
    return false;
  }
  return true;
}

export function resetBurnedChallenges(): void {
  burnedChallenges.clear();
}

export async function checkTotpVerifyRateLimit(
  userId: string,
): Promise<{ readonly allowed: boolean; readonly resetMs: number }> {
  const res = await totpVerifyLimiter.check(userId);
  return { allowed: res.allowed, resetMs: res.resetMs };
}

export function resetTotpVerifyRateLimiter(): void {
  totpVerifyLimiter = new RateLimiter({ max: 5, windowMs: 60_000 });
}

// ============================================================================
// 2. TOTP & Backup Codes
// ============================================================================

export interface TotpServiceOptions {
  readonly issuer: string;
  readonly window: number;
  readonly encryptionKey: string;
  readonly argon2Config?: Argon2Config | undefined;
}

interface TotpOperationResult {
  readonly success: boolean;
  readonly message: string;
}

function createBackupCodes(): string[] {
  return Array.from({ length: BACKUP_CODE_COUNT }, () => {
    const raw = randomBytes(BACKUP_CODE_BYTES).toString('hex').toUpperCase();
    return `${raw.slice(0, 4)}-${raw.slice(4)}`;
  });
}

export function verifyTotpCode(
  storedSecret: string,
  code: string,
  window: number,
  encryptionKey: string,
): boolean {
  return verifyTotp(decryptTotpSecret(storedSecret, encryptionKey), code, window);
}

async function verifyBackupCodeInRepo(
  repo: Pick<IdentityRepository, 'listUnusedBackupCodes' | 'claimUnusedBackupCode'>,
  userId: string,
  code: string,
): Promise<boolean> {
  const rows = await repo.listUnusedBackupCodes(userId);
  for (const row of rows) {
    if (await verifyPasswordSafe(code, row.codeHash, BACKUP_CODE_HASH_CONFIG)) {
      return repo.claimUnusedBackupCode(row.id);
    }
  }
  return false;
}

async function verifyTotpOrBackupCodeInRepo(
  repo: Pick<
    IdentityRepository,
    'compareAndSwapUserTotpSecret' | 'listUnusedBackupCodes' | 'claimUnusedBackupCode'
  >,
  userId: string,
  storedSecret: string,
  code: string,
  options: TotpServiceOptions,
): Promise<boolean> {
  if (verifyTotpCode(storedSecret, code, options.window, options.encryptionKey)) {
    if (isLegacyPlaintextSecret(storedSecret)) {
      await repo.compareAndSwapUserTotpSecret(
        userId,
        storedSecret,
        encryptTotpSecret(storedSecret, options.encryptionKey),
      );
    }
    return true;
  }
  return verifyBackupCodeInRepo(repo, userId, code);
}

export async function setupTotpInRepo(
  repo: Pick<IdentityRepository, 'setUserTotpSetup' | 'replaceUserBackupCodes'>,
  userId: string,
  userEmail: string,
  options: TotpServiceOptions,
): Promise<TotpSetupResponse> {
  const secret = createTotpSecret();
  const otpauthUrl = totpUri({ issuer: options.issuer, label: userEmail, secret });
  const backupCodes = createBackupCodes();
  const hashCfg = options.argon2Config ?? BACKUP_CODE_HASH_CONFIG;
  const codeHashes = await Promise.all(backupCodes.map((code) => hashPassword(code, hashCfg)));

  await repo.setUserTotpSetup(userId, encryptTotpSecret(secret, options.encryptionKey));
  await repo.replaceUserBackupCodes(userId, codeHashes);

  return { secret, otpauthUrl, backupCodes };
}

export async function enableTotpInRepo(
  repo: Pick<IdentityRepository, 'getUserTotpState' | 'setUserTotpEnabled'>,
  userId: string,
  code: string,
  options: TotpServiceOptions,
): Promise<TotpOperationResult> {
  const state = await repo.getUserTotpState(userId);
  if (state?.totpSecret == null) {
    return { success: false, message: 'TOTP not set up. Call setup first.' };
  }
  if (state.totpEnabled) {
    return { success: false, message: '2FA is already enabled.' };
  }
  if (!verifyTotpCode(state.totpSecret, code, options.window, options.encryptionKey)) {
    return { success: false, message: 'Invalid TOTP code. Please try again.' };
  }
  await repo.setUserTotpEnabled(userId, true, false);
  return { success: true, message: '2FA has been enabled successfully.' };
}

export async function disableTotpInRepo(
  repo: Pick<
    IdentityRepository,
    | 'getUserTotpState'
    | 'setUserTotpEnabled'
    | 'deleteUserBackupCodes'
    | 'compareAndSwapUserTotpSecret'
    | 'listUnusedBackupCodes'
    | 'claimUnusedBackupCode'
  >,
  userId: string,
  code: string,
  options: TotpServiceOptions,
): Promise<TotpOperationResult> {
  const state = await repo.getUserTotpState(userId);
  if (state === null || !state.totpEnabled || state.totpSecret === null) {
    return { success: false, message: '2FA is not enabled.' };
  }
  if (!(await verifyTotpOrBackupCodeInRepo(repo, userId, state.totpSecret, code, options))) {
    return { success: false, message: 'Invalid code. Please try again.' };
  }
  await repo.setUserTotpEnabled(userId, false, true);
  await repo.deleteUserBackupCodes(userId);
  return { success: true, message: '2FA has been disabled.' };
}

export async function getTotpStatusInRepo(
  repo: Pick<IdentityRepository, 'getUserTotpState'>,
  userId: string,
): Promise<TotpStatusResponse> {
  const state = await repo.getUserTotpState(userId);
  return { enabled: state?.totpEnabled === true };
}

export async function getBackupCodesStatusInRepo(
  repo: Pick<IdentityRepository, 'getBackupCodesCounts'>,
  userId: string,
): Promise<BackupCodesStatusResponse> {
  return repo.getBackupCodesCounts(userId);
}

export async function regenerateBackupCodesInRepo(
  repo: Pick<
    IdentityRepository,
    | 'getUserTotpState'
    | 'replaceUserBackupCodes'
    | 'compareAndSwapUserTotpSecret'
    | 'listUnusedBackupCodes'
    | 'claimUnusedBackupCode'
  >,
  userId: string,
  code: string,
  options: TotpServiceOptions,
): Promise<
  | { readonly ok: true; readonly value: BackupCodesRegenerateResponse }
  | { readonly ok: false; readonly message: string }
> {
  const state = await repo.getUserTotpState(userId);
  if (state === null || !state.totpEnabled || state.totpSecret === null) {
    return { ok: false, message: '2FA must be enabled before regenerating backup codes.' };
  }
  if (!(await verifyTotpOrBackupCodeInRepo(repo, userId, state.totpSecret, code, options))) {
    return { ok: false, message: 'Invalid code. Please try again.' };
  }
  const backupCodes = createBackupCodes();
  const hashCfg = options.argon2Config ?? BACKUP_CODE_HASH_CONFIG;
  const codeHashes = await Promise.all(backupCodes.map((c) => hashPassword(c, hashCfg)));
  await repo.replaceUserBackupCodes(userId, codeHashes);
  return { ok: true, value: { backupCodes } };
}

export async function verifyTotpForLoginInRepo(
  repo: Pick<
    IdentityRepository,
    | 'getUserTotpState'
    | 'compareAndSwapUserTotpSecret'
    | 'listUnusedBackupCodes'
    | 'claimUnusedBackupCode'
  >,
  userId: string,
  code: string,
  options: TotpServiceOptions,
): Promise<boolean> {
  const state = await repo.getUserTotpState(userId);
  if (state === null || !state.totpEnabled || state.totpSecret === null) {
    return false;
  }
  return verifyTotpOrBackupCodeInRepo(repo, userId, state.totpSecret, code, options);
}

// ============================================================================
// 3. Phone Verification & SMS 2FA
// ============================================================================

type IdentitySmsSender = (options: {
  readonly to: string;
  readonly body: string;
}) => Promise<{ readonly success: boolean; readonly error?: string | undefined }>;

function generateSmsCode(): string {
  return String(randomInt(100000, 999999));
}

function hashSmsCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

function timingSafeHexCompare(hash1: string, hash2: string): boolean {
  if (hash1.length !== hash2.length) return false;
  return timingSafeEqual(Buffer.from(hash1, 'hex'), Buffer.from(hash2, 'hex'));
}

export async function checkSmsRateLimitInRepo(
  repo: Pick<IdentityRepository, 'countRecentSmsCodes'>,
  userId: string,
  now: Date = new Date(),
): Promise<{ readonly allowed: boolean; readonly retryAfter?: Date | undefined }> {
  const hourly = await repo.countRecentSmsCodes(userId, 1);
  if (hourly.count >= SMS_RATE_LIMIT_HOURLY) {
    const retryAfter =
      hourly.oldestCreatedAt !== null
        ? new Date(hourly.oldestCreatedAt.getTime() + MS_PER_HOUR)
        : new Date(now.getTime() + MS_PER_HOUR);
    return { allowed: false, retryAfter };
  }

  const daily = await repo.countRecentSmsCodes(userId, 24);
  if (daily.count >= SMS_RATE_LIMIT_DAILY) {
    const retryAfter =
      daily.oldestCreatedAt !== null
        ? new Date(daily.oldestCreatedAt.getTime() + MS_PER_DAY)
        : new Date(now.getTime() + MS_PER_DAY);
    return { allowed: false, retryAfter };
  }

  return { allowed: true };
}

export async function sendSms2faCodeInRepo(
  repo: Pick<IdentityRepository, 'invalidatePendingSmsCodes' | 'insertSmsVerificationCode'>,
  sendSms: IdentitySmsSender,
  userId: string,
  phone: string,
  now: Date = new Date(),
): Promise<{ readonly success: boolean; readonly error?: string | undefined }> {
  const code = generateSmsCode();
  const codeHash = hashSmsCode(code);
  const expiresAt = new Date(now.getTime() + SMS_CODE_EXPIRY_MS);

  await repo.invalidatePendingSmsCodes(userId);
  await repo.insertSmsVerificationCode({ userId, phone, codeHash, expiresAt });

  const sent = await sendSms({
    to: phone,
    body: `Your verification code is: ${code}. It expires in 5 minutes.`,
  });
  if (!sent.success) {
    return { success: false, error: sent.error ?? 'Failed to send SMS' };
  }
  return { success: true };
}

export async function verifySms2faCodeInRepo(
  repo: Pick<
    IdentityRepository,
    'findPendingSmsCode' | 'incrementSmsCodeAttempts' | 'markSmsCodeVerified'
  >,
  userId: string,
  code: string,
): Promise<{ readonly valid: boolean; readonly message: string }> {
  const record = await repo.findPendingSmsCode(userId);
  if (record === null) {
    return { valid: false, message: 'No pending verification code. Please request a new one.' };
  }

  if (record.attempts >= SMS_MAX_ATTEMPTS) {
    await repo.markSmsCodeVerified(record.id);
    return { valid: false, message: 'Too many attempts. Please request a new code.' };
  }

  await repo.incrementSmsCodeAttempts(record.id);

  if (!timingSafeHexCompare(hashSmsCode(code), record.codeHash)) {
    const remaining = SMS_MAX_ATTEMPTS - record.attempts - 1;
    return {
      valid: false,
      message:
        remaining > 0
          ? `Invalid code. ${String(remaining)} attempt${remaining === 1 ? '' : 's'} remaining.`
          : 'Invalid code. Please request a new one.',
    };
  }

  await repo.markSmsCodeVerified(record.id);
  return { valid: true, message: 'Code verified successfully.' };
}

export async function verifyPhoneInRepo(
  repo: Pick<
    IdentityRepository,
    | 'findPendingSmsCode'
    | 'incrementSmsCodeAttempts'
    | 'markSmsCodeVerified'
    | 'findLatestVerifiedSmsPhone'
    | 'setUserVerifiedPhone'
  >,
  userId: string,
  code: string,
): Promise<
  | { readonly ok: true; readonly value: { readonly verified: true } }
  | {
      readonly ok: false;
      readonly code: 'SMS_VERIFICATION_FAILED' | 'PHONE_VERIFICATION_PENDING';
      readonly message: string;
    }
> {
  const verified = await verifySms2faCodeInRepo(repo, userId, code);
  if (!verified.valid) {
    return { ok: false, code: 'SMS_VERIFICATION_FAILED', message: verified.message };
  }
  const phone = await repo.findLatestVerifiedSmsPhone(userId);
  if (phone === null) {
    return {
      ok: false,
      code: 'PHONE_VERIFICATION_PENDING',
      message: 'No phone number to verify',
    };
  }
  await repo.setUserVerifiedPhone(userId, phone);
  return { ok: true, value: { verified: true } };
}
