// main/server/core/src/auth/utils/crypto.ts
/**
 * Auth Crypto Utilities
 *
 * SHA-256 token hashing for deterministic lookup of high-entropy tokens
 * (password reset, email verification, magic link, email change).
 *
 * Uses SHA-256 (not Argon2) because tokens are already high-entropy
 * (32 random bytes), so fast hashing is acceptable for single-use tokens.
 *
 * @module auth/utils/crypto
 */

import { createHash, randomBytes, randomInt } from 'node:crypto';

/**
 * Hash a token using SHA-256 for deterministic lookup.
 *
 * @param token - The token to hash
 * @returns Hex-encoded SHA-256 hash
 * @complexity O(1)
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Generate a random token and return both plain and hashed versions.
 *
 * @returns Object with plain text (hex) and SHA-256 hashed token
 * @complexity O(1)
 */
export function generateSecureToken(): { plain: string; hash: string } {
  const plain = randomBytes(32).toString('hex');
  const hash = hashToken(plain);
  return { plain, hash };
}

/**
 * Generate a cryptographically secure token in base64url encoding.
 * Suitable for URL-safe token usage (e.g., magic links).
 *
 * @param bytes - Number of random bytes (default: 32 = 256 bits)
 * @returns Base64url-encoded random token
 * @complexity O(1)
 */
export function generateBase64UrlToken(bytes: number = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Generate a zero-padded numeric one-time code (e.g. a 6-digit email OTP).
 *
 * Uses `crypto.randomInt` for a uniform, unbiased distribution across the
 * full range — unlike modulo on random bytes, which skews toward lower values.
 *
 * @param digits - Number of digits in the code (default: 6)
 * @returns Zero-padded numeric string of the requested length
 * @complexity O(1)
 */
export function generateNumericCode(digits: number = 6): string {
  const max = 10 ** digits;
  return randomInt(0, max).toString().padStart(digits, '0');
}
