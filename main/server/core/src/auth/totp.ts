// main/server/core/src/auth/totp.ts

/**
 * TOTP (2FA) Service
 *
 * Provides TOTP setup, verification, enable, disable, and backup code operations.
 * Uses the `otpauth` library for TOTP generation and verification.
 *
 * @module totp
 */

import { randomBytes } from 'node:crypto';

import { TOTP_BACKUP_CODES_TABLE, USERS_TABLE } from '@bslt/db/schema';
import { Secret, TOTP } from 'otpauth';

import { decryptTotpSecret, encryptTotpSecret, isLegacyPlaintextSecret } from './totp-secret';
import { hashPassword, verifyPasswordSafe } from './utils';

import type { DbClient } from '@bslt/db/client';
import type { AuthConfig } from '@bslt/shared/system/config';

// ============================================================================
// Constants
// ============================================================================

const TOTP_DIGITS = 6;
const TOTP_PERIOD = 30;
const TOTP_ALGORITHM = 'SHA1';
const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_BYTES = 4;

const BACKUP_CODE_HASH_CONFIG: AuthConfig['argon2'] = {
  type: 2,
  memoryCost: 8192,
  timeCost: 2,
  parallelism: 1,
};

// ============================================================================
// Types
// ============================================================================

export interface TotpSetupResult {
  /** Base32-encoded TOTP secret */
  secret: string;
  /** otpauth:// URI for QR code generation */
  otpauthUrl: string;
  /** Plaintext backup codes. These should only be shown once. */
  backupCodes: string[];
}

export interface TotpVerifyResult {
  success: boolean;
  message: string;
}

export interface BackupCodesStatusResult {
  remaining: number;
  total: number;
}

export interface BackupCodesRegenerateResult {
  success: boolean;
  message: string;
  backupCodes?: string[];
}

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Generate a new TOTP secret and one-time backup codes for 2FA setup.
 *
 * This does NOT enable 2FA — the user must verify a code first via `enableTotp()`.
 * The secret is stored on the user record (totp_secret) but totp_enabled remains false
 * until verification.
 *
 * @param db - Database client
 * @param userId - User ID
 * @param userEmail - User email (displayed in authenticator app)
 * @param config - Auth configuration (for TOTP issuer/window)
 * @returns Setup result with secret, otpauth URL, and one-time backup codes
 */
export async function setupTotp(
  db: DbClient,
  userId: string,
  userEmail: string,
  config: AuthConfig,
): Promise<TotpSetupResult> {
  // Generate a new TOTP secret
  const secret = new Secret({ size: 20 });

  const totp = new TOTP({
    issuer: config.totp.issuer,
    label: userEmail,
    algorithm: TOTP_ALGORITHM,
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
    secret,
  });

  const otpauthUrl = totp.toString();
  const backupCodes = createBackupCodes();

  await db.transaction(async (tx) => {
    await tx.raw(
      `UPDATE ${USERS_TABLE} SET totp_secret = $1, totp_enabled = false, updated_at = now() WHERE id = $2`,
      [encryptTotpSecret(secret.base32, config.oauthTokenEncryptionKey), userId],
    );
    await replaceBackupCodes(tx, userId, backupCodes);
  });

  return {
    secret: secret.base32,
    otpauthUrl,
    backupCodes,
  };
}

/**
 * Verify a TOTP code and enable 2FA for the user.
 *
 * Called after `setupTotp()` to confirm the user has correctly configured
 * their authenticator app. Sets `totp_enabled = true`.
 *
 * @param db - Database client
 * @param userId - User ID
 * @param code - 6-digit TOTP code from authenticator app
 * @param config - Auth configuration
 * @returns Verification result
 */
export async function enableTotp(
  db: DbClient,
  userId: string,
  code: string,
  config: AuthConfig,
): Promise<TotpVerifyResult> {
  // Get the user's TOTP secret
  const result = await db.raw<{ totp_secret: string | null; totp_enabled: boolean }>(
    `SELECT totp_secret, totp_enabled FROM ${USERS_TABLE} WHERE id = $1`,
    [userId],
  );
  const user = result[0];

  if (user?.totp_secret == null) {
    return { success: false, message: 'TOTP not set up. Call setup first.' };
  }

  if (user.totp_enabled) {
    return { success: false, message: '2FA is already enabled.' };
  }

  // Verify the code
  const isValid = verifyTotpCode(
    user.totp_secret,
    code,
    config.totp.window,
    config.oauthTokenEncryptionKey,
  );
  if (!isValid) {
    return { success: false, message: 'Invalid TOTP code. Please try again.' };
  }

  // Enable 2FA
  await db.raw(`UPDATE ${USERS_TABLE} SET totp_enabled = true, updated_at = now() WHERE id = $1`, [
    userId,
  ]);

  return { success: true, message: '2FA has been enabled successfully.' };
}

/**
 * Disable 2FA for a user after verifying their current TOTP code.
 *
 * @param db - Database client
 * @param userId - User ID
 * @param code - Current TOTP code or one-time backup code
 * @param config - Auth configuration
 * @returns Verification result
 */
export async function disableTotp(
  db: DbClient,
  userId: string,
  code: string,
  config: AuthConfig,
): Promise<TotpVerifyResult> {
  const result = await db.raw<{ totp_secret: string | null; totp_enabled: boolean }>(
    `SELECT totp_secret, totp_enabled FROM ${USERS_TABLE} WHERE id = $1`,
    [userId],
  );
  const user = result[0];

  if (user === undefined || !user.totp_enabled || user.totp_secret === null) {
    return { success: false, message: '2FA is not enabled.' };
  }

  if (
    !(await verifyTotpOrBackupCode(
      db,
      userId,
      user.totp_secret,
      code,
      config.totp.window,
      config.oauthTokenEncryptionKey,
    ))
  ) {
    return { success: false, message: 'Invalid code. Please try again.' };
  }

  await db.transaction(async (tx) => {
    await tx.raw(
      `UPDATE ${USERS_TABLE} SET totp_enabled = false, totp_secret = NULL, updated_at = now() WHERE id = $1`,
      [userId],
    );
    await tx.raw(`DELETE FROM ${TOTP_BACKUP_CODES_TABLE} WHERE user_id = $1`, [userId]);
  });

  return { success: true, message: '2FA has been disabled.' };
}

/**
 * Check if a user has 2FA enabled.
 */
export async function getTotpStatus(db: DbClient, userId: string): Promise<{ enabled: boolean }> {
  const result = await db.raw<{ totp_enabled: boolean }>(
    `SELECT totp_enabled FROM ${USERS_TABLE} WHERE id = $1`,
    [userId],
  );
  const user = result[0];
  return { enabled: user?.totp_enabled === true };
}

/**
 * Count remaining and total backup codes for a user.
 */
export async function getBackupCodesStatus(
  db: DbClient,
  userId: string,
): Promise<BackupCodesStatusResult> {
  const result = await db.raw<{ remaining: number | string; total: number | string }>(
    `SELECT
      COUNT(*) FILTER (WHERE used_at IS NULL)::int AS remaining,
      COUNT(*)::int AS total
    FROM ${TOTP_BACKUP_CODES_TABLE}
    WHERE user_id = $1`,
    [userId],
  );
  const row = result[0];
  return {
    remaining: Number(row?.remaining ?? 0),
    total: Number(row?.total ?? 0),
  };
}

/**
 * Replace all existing backup codes after verifying a current TOTP or backup code.
 */
export async function regenerateBackupCodes(
  db: DbClient,
  userId: string,
  code: string,
  config: AuthConfig,
): Promise<BackupCodesRegenerateResult> {
  const result = await db.raw<{ totp_secret: string | null; totp_enabled: boolean }>(
    `SELECT totp_secret, totp_enabled FROM ${USERS_TABLE} WHERE id = $1`,
    [userId],
  );
  const user = result[0];

  if (user === undefined || !user.totp_enabled || user.totp_secret === null) {
    return {
      success: false,
      message: '2FA must be enabled before regenerating backup codes.',
    };
  }

  if (
    !(await verifyTotpOrBackupCode(
      db,
      userId,
      user.totp_secret,
      code,
      config.totp.window,
      config.oauthTokenEncryptionKey,
    ))
  ) {
    return { success: false, message: 'Invalid code. Please try again.' };
  }

  const backupCodes = createBackupCodes();
  await db.transaction(async (tx) => {
    await replaceBackupCodes(tx, userId, backupCodes);
  });

  return {
    success: true,
    message: 'Backup codes regenerated.',
    backupCodes,
  };
}

/**
 * Verify a TOTP code during login (when 2FA is required).
 *
 * @param db - Database client
 * @param userId - User ID
 * @param code - TOTP code or one-time backup code
 * @param config - Auth configuration
 * @returns Whether the code is valid
 */
export async function verifyTotpForLogin(
  db: DbClient,
  userId: string,
  code: string,
  config: AuthConfig,
): Promise<boolean> {
  const result = await db.raw<{ totp_secret: string | null; totp_enabled: boolean }>(
    `SELECT totp_secret, totp_enabled FROM ${USERS_TABLE} WHERE id = $1`,
    [userId],
  );
  const user = result[0];

  if (user === undefined || !user.totp_enabled || user.totp_secret === null) {
    return false;
  }

  return verifyTotpOrBackupCode(
    db,
    userId,
    user.totp_secret,
    code,
    config.totp.window,
    config.oauthTokenEncryptionKey,
  );
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Verify a TOTP code against a secret.
 */
/**
 * Verify a code against the seed AS STORED — encrypted, or legacy plaintext.
 *
 * `encryptionKey` is required, not optional, on purpose. This function is
 * exported and `handlers/sudo.ts` calls it with the value straight off the user
 * record; had the key been optional, encrypting the column would have silently
 * fed a ciphertext to the base32 parser and broken sudo-by-TOTP for every user,
 * with nothing in the type-check to say so. Now the compiler makes every caller
 * confront it.
 */
export function verifyTotpCode(
  storedSecret: string,
  code: string,
  window: number,
  encryptionKey: string,
): boolean {
  const totp = new TOTP({
    algorithm: TOTP_ALGORITHM,
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
    secret: Secret.fromBase32(decryptTotpSecret(storedSecret, encryptionKey)),
  });

  const delta = totp.validate({ token: code, window });
  return delta !== null;
}

/**
 * Upgrade a legacy plaintext row to ciphertext once we have seen it.
 *
 * Compare-and-set on the exact value read: if anything rewrote the column in the
 * meantime — a fresh setup, a disable — this writes nothing rather than
 * resurrect a seed its owner has already replaced.
 *
 * Existing 2FA users are precisely the people this bug exposed, so leaving their
 * rows in the clear and only encrypting new ones would fix the vulnerability for
 * everyone who never had it. This heals a row the first time its owner touches
 * TOTP; a dormant account still needs the one-off backfill.
 */
async function reencryptTotpSecretIfLegacy(
  db: DbClient,
  userId: string,
  storedSecret: string,
  encryptionKey: string,
): Promise<void> {
  if (!isLegacyPlaintextSecret(storedSecret)) return;

  await db.raw(
    `UPDATE ${USERS_TABLE} SET totp_secret = $1, updated_at = now() WHERE id = $2 AND totp_secret = $3`,
    [encryptTotpSecret(storedSecret, encryptionKey), userId, storedSecret],
  );
}

async function verifyTotpOrBackupCode(
  db: DbClient,
  userId: string,
  storedSecret: string,
  code: string,
  window: number,
  encryptionKey: string,
): Promise<boolean> {
  if (verifyTotpCode(storedSecret, code, window, encryptionKey)) {
    await reencryptTotpSecretIfLegacy(db, userId, storedSecret, encryptionKey);
    return true;
  }
  return verifyBackupCode(db, userId, code);
}

async function verifyBackupCode(db: DbClient, userId: string, code: string): Promise<boolean> {
  const rows = await db.raw<{ id: string; code_hash: string }>(
    `SELECT id, code_hash FROM ${TOTP_BACKUP_CODES_TABLE} WHERE user_id = $1 AND used_at IS NULL`,
    [userId],
  );

  for (const row of rows) {
    if (await verifyPasswordSafe(code, row.code_hash)) {
      const claimed = await db.raw<{ id: string }>(
        `UPDATE ${TOTP_BACKUP_CODES_TABLE}
         SET used_at = now()
         WHERE id = $1 AND used_at IS NULL
         RETURNING id`,
        [row.id],
      );
      return claimed.length > 0;
    }
  }

  return false;
}

async function replaceBackupCodes(
  db: DbClient,
  userId: string,
  backupCodes: readonly string[],
): Promise<void> {
  const codeHashes = await Promise.all(
    backupCodes.map((code) => hashPassword(code, BACKUP_CODE_HASH_CONFIG)),
  );

  await db.raw(`DELETE FROM ${TOTP_BACKUP_CODES_TABLE} WHERE user_id = $1`, [userId]);
  for (const codeHash of codeHashes) {
    await db.raw(`INSERT INTO ${TOTP_BACKUP_CODES_TABLE} (user_id, code_hash) VALUES ($1, $2)`, [
      userId,
      codeHash,
    ]);
  }
}

function createBackupCodes(): string[] {
  return Array.from({ length: BACKUP_CODE_COUNT }, () => {
    const raw = randomBytes(BACKUP_CODE_BYTES).toString('hex').toUpperCase();
    return `${raw.slice(0, 4)}-${raw.slice(4)}`;
  });
}
