// main/kernel/storage/src/signing.ts
/**
 * URL Signing Utilities
 *
 * HMAC-SHA-256 signed, expiring URLs for the local storage provider — the local
 * equivalent of an S3 presigned GET. The provider signs `{method, key,
 * expiresAt}`; the file-serving route recomputes the HMAC over the same claims
 * and refuses the request before touching the filesystem unless it matches.
 */

import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

import { AUTH_VALIDATION, SECONDS_PER_DAY } from '@bslt/contract';

import { StorageError } from './errors';

/** HTTP method a signature is bound to, so a GET link can never authorize a write. */
export type StorageUrlMethod = 'GET' | 'PUT';

/** The claims a storage URL signature covers. */
export interface StorageUrlClaims {
  method: StorageUrlMethod;
  /** Canonical storage key: no leading slash, no `.`/`..` segments. */
  key: string;
  /** Unix epoch seconds at which the URL stops being accepted. */
  expiresAt: number;
}

/** A request's claimed key plus the raw (unvalidated) query values that carry its signature. */
interface StorageUrlRequest {
  method: StorageUrlMethod;
  key: string;
  expires: unknown;
  signature: unknown;
}

/** Why a signed URL was refused. */
type StorageUrlRejection = 'missing' | 'malformed' | 'invalid' | 'expired';

/** Outcome of verifying a signed storage URL. */
export type StorageUrlVerdict =
  { valid: true; expiresAt: number } | { valid: false; reason: StorageUrlRejection };

/** Query parameter names that carry the expiry and the signature. */
export const SIGNED_URL_QUERY = { expires: 'expires', signature: 'signature' } as const;

/** Longest lifetime a signed URL may have: the S3 SigV4 presign ceiling (7 days). */
export const MAX_SIGNED_URL_EXPIRES_SECONDS = 7 * SECONDS_PER_DAY;

/** HKDF `info` label: binds the derived key to this one purpose (domain separation). */
const KEY_DERIVATION_INFO = 'bslt/storage/signed-url/v1';
const SIGNING_KEY_BYTES = 32;
/** Exactly one canonical encoding: lowercase hex of a 32-byte HMAC-SHA-256. */
const SIGNATURE_PATTERN = /^[0-9a-f]{64}$/;
/** Canonical positive decimal seconds, no sign/exponent/leading zero, at most 12 digits. */
const EXPIRES_PATTERN = /^[1-9]\d{0,11}$/;

/**
 * Derive the storage URL signing key from an application secret.
 *
 * The secret is reused from validated config (the cookie secret), so it is never
 * used as an HMAC key directly: HKDF-SHA-256 with a purpose label yields an
 * independent key, and a value signed under the raw secret (e.g. a signed
 * cookie) can never double as a storage URL signature.
 *
 * @param secret - Application secret, at least 32 characters
 * @returns A 32-byte signing key
 * @throws StorageError when the secret is shorter than 32 characters
 * @complexity O(1)
 */
export function deriveStorageUrlKey(secret: string): Buffer {
  if (secret.length < AUTH_VALIDATION.MIN_SECRET_LENGTH) {
    throw new StorageError(
      `Storage URL signing secret must be at least ${String(AUTH_VALIDATION.MIN_SECRET_LENGTH)} characters`,
    );
  }
  return Buffer.from(hkdfSync('sha256', secret, '', KEY_DERIVATION_INFO, SIGNING_KEY_BYTES));
}

function computeDigest(claims: StorageUrlClaims, signingKey: Buffer): Buffer {
  // A JSON array is an unambiguous encoding: no key/expiry split can collide.
  return createHmac('sha256', signingKey)
    .update(JSON.stringify([claims.method, claims.key, claims.expiresAt]))
    .digest();
}

/**
 * Sign storage URL claims.
 *
 * @param claims - Method, canonical key and absolute expiry (epoch seconds)
 * @param signingKey - Key from {@link deriveStorageUrlKey}
 * @returns Lowercase hex HMAC-SHA-256 (64 chars)
 * @throws StorageError for an empty key or a non-positive-integer expiry
 * @complexity O(n) in the key length
 */
export function signStorageUrl(claims: StorageUrlClaims, signingKey: Buffer): string {
  if (claims.key === '' || !Number.isSafeInteger(claims.expiresAt) || claims.expiresAt <= 0) {
    throw new StorageError('Refusing to sign an empty key or a non-positive-integer expiry');
  }
  return computeDigest(claims, signingKey).toString('hex');
}

/**
 * Verify a signed storage URL request.
 *
 * Rejects missing parameters, any non-canonical encoding of the expiry or
 * signature (including repeated query parameters), a signature that does not
 * cover exactly this method + key + expiry, and an expired URL. The comparison
 * is constant-time over equal-length digests.
 *
 * @param request - Claimed method/key plus the raw `expires`/`signature` query values
 * @param signingKey - Key from {@link deriveStorageUrlKey}
 * @param nowMs - Current time in epoch milliseconds
 * @returns `{ valid: true, expiresAt }`, or the reason for refusal
 * @complexity O(n) in the key length
 */
export function verifyStorageUrl(
  request: StorageUrlRequest,
  signingKey: Buffer,
  nowMs: number = Date.now(),
): StorageUrlVerdict {
  const { method, key, expires, signature } = request;
  if (key === '' || expires === undefined || expires === '') {
    return { valid: false, reason: 'missing' };
  }
  if (signature === undefined || signature === '') {
    return { valid: false, reason: 'missing' };
  }
  if (
    typeof expires !== 'string' ||
    !EXPIRES_PATTERN.test(expires) ||
    typeof signature !== 'string' ||
    !SIGNATURE_PATTERN.test(signature)
  ) {
    return { valid: false, reason: 'malformed' };
  }

  const expiresAt = Number(expires);
  const expected = computeDigest({ method, key, expiresAt }, signingKey);
  if (!timingSafeEqual(Buffer.from(signature, 'hex'), expected)) {
    return { valid: false, reason: 'invalid' };
  }
  if (nowMs >= expiresAt * 1000) {
    return { valid: false, reason: 'expired' };
  }
  return { valid: true, expiresAt };
}

/**
 * Whether a decoded storage key can be mapped onto the filesystem safely:
 * non-empty segments only, no `.`/`..` segments, no backslash or NUL byte.
 * The provider never signs, and the serving route never serves, any other key.
 *
 * @param key - Decoded storage key
 * @returns True when every segment is a plain name
 * @complexity O(n)
 */
export function isServableStorageKey(key: string): boolean {
  return key
    .split('/')
    .every(
      (segment) =>
        segment !== '' &&
        segment !== '.' &&
        segment !== '..' &&
        !segment.includes('\\') &&
        !segment.includes('\0'),
    );
}

/**
 * Normalize a storage key for safe file system access.
 */
export function normalizeStorageKey(key: string, stripParentRefs = false): string {
  let normalized = key.replace(/^\/+/, '');

  if (stripParentRefs) {
    normalized = normalized.replace(/\.\./g, '');
    normalized = normalized.replace(/\/+/g, '/');
    normalized = normalized.replace(/^\/+/, '');
  }

  return normalized;
}
