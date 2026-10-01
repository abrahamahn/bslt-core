// main/server/core/src/auth/totp-secret.ts
/**
 * Encryption at rest for the TOTP seed.
 *
 * `users.totp_secret` held the raw base32 seed. Anyone with a copy of the
 * database — a backup, a dump, a leaked read replica, an over-broad analytics
 * grant — could mint valid authenticator codes for every 2FA user, forever. A
 * TOTP seed cannot be rotated by a victim who does not know it was taken, and it
 * never expires. It is the second factor: a password hash is useless to an
 * attacker with a dump, and this was not.
 *
 * The same table already encrypted the third-party OAuth token beside it, using
 * `oauth/token-crypto` (AES-256-GCM, scrypt-derived key). The MFA seed sat in
 * the clear next to it. This reuses that helper and that key rather than
 * inventing a second scheme — one key to configure, one to rotate, one to get
 * wrong.
 */

import { decryptToken, encryptToken } from './oauth/token-crypto';

/**
 * Ciphertext is `salt:iv:tag:ciphertext` (base64 parts, colon-joined).
 *
 * A stored value is legacy plaintext if and only if it has no colon. That is not
 * a heuristic: RFC 4648 base32 is exactly `A–Z`, `2–7` and `=` padding, so a
 * colon cannot occur in a seed. The discriminator is total, which is what makes
 * it safe to run both formats side by side while old rows are migrated.
 */
function isEncrypted(stored: string): boolean {
  return stored.includes(':');
}

/** Encrypt a freshly generated base32 seed for storage. */
export function encryptTotpSecret(secretBase32: string, encryptionKey: string): string {
  return encryptToken(secretBase32, encryptionKey);
}

/**
 * Recover the base32 seed from whatever is in the column.
 *
 * Tolerates a legacy plaintext row so that existing 2FA users are not locked out
 * of their own accounts the moment this ships. `reencryptTotpSecretIfLegacy`
 * upgrades those rows as their owners use them.
 */
export function decryptTotpSecret(stored: string, encryptionKey: string): string {
  return isEncrypted(stored) ? decryptToken(stored, encryptionKey) : stored;
}

/** True when the stored value is still an unencrypted seed. */
export function isLegacyPlaintextSecret(stored: string): boolean {
  return !isEncrypted(stored);
}
