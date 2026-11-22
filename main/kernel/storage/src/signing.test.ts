// main/kernel/storage/src/signing.test.ts
/**
 * Local signed-URL primitives.
 *
 * Risk assessment — how this code could leak data:
 * 1. A signature not bound to the object key or the expiry lets one URL be
 *    replayed against another user's file, or kept alive forever.
 * 2. Accepting several encodings of one signature, or comparing with `===`,
 *    turns verification into a forgery/timing oracle.
 * 3. Keying the HMAC with the raw cookie secret would let any signed cookie
 *    value double as a storage signature (cross-protocol reuse).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  deriveStorageUrlKey,
  MAX_SIGNED_URL_EXPIRES_SECONDS,
  signStorageUrl,
  verifyStorageUrl,
  type StorageUrlClaims,
} from './signing';

vi.mock('node:crypto', async (importOriginal) => {
  const actual: Record<string, unknown> & { timingSafeEqual: typeof timingSafeEqual } =
    await importOriginal();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

const SECRET = 'storage-url-signing-test-secret-0123456789';
const OTHER_SECRET = 'a-completely-different-secret-9876543210';
const NOW_MS = Date.UTC(2026, 10, 10, 12, 0, 0);
const NOW_S = NOW_MS / 1000;
const SIGNING_KEY = deriveStorageUrlKey(SECRET);

const CLAIMS: StorageUrlClaims = {
  method: 'GET',
  key: 'files/user-1/abc123.png',
  expiresAt: NOW_S + 3600,
};

function signedRequest(
  overrides: Partial<{ method: 'GET' | 'PUT'; key: string; expires: unknown; signature: unknown }>,
): { method: 'GET' | 'PUT'; key: string; expires: unknown; signature: unknown } {
  return {
    method: CLAIMS.method,
    key: CLAIMS.key,
    expires: String(CLAIMS.expiresAt),
    signature: signStorageUrl(CLAIMS, SIGNING_KEY),
    ...overrides,
  };
}

describe('deriveStorageUrlKey', () => {
  it('derives a 32-byte key that is not the raw secret', () => {
    expect(SIGNING_KEY).toHaveLength(32);
    expect(SIGNING_KEY.equals(Buffer.from(SECRET))).toBe(false);
  });

  it('is deterministic for one secret and distinct across secrets', () => {
    expect(deriveStorageUrlKey(SECRET).equals(SIGNING_KEY)).toBe(true);
    expect(deriveStorageUrlKey(OTHER_SECRET).equals(SIGNING_KEY)).toBe(false);
  });

  it.each(['', 'short', 'x'.repeat(31)])('refuses a secret shorter than 32 chars (%#)', (s) => {
    expect(() => deriveStorageUrlKey(s)).toThrow(/at least 32/);
  });
});

describe('signStorageUrl', () => {
  it('produces a 64-char lowercase hex HMAC-SHA-256', () => {
    expect(signStorageUrl(CLAIMS, SIGNING_KEY)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('binds method, key and expiry: changing any one changes the signature', () => {
    const base = signStorageUrl(CLAIMS, SIGNING_KEY);
    expect(signStorageUrl({ ...CLAIMS, method: 'PUT' }, SIGNING_KEY)).not.toBe(base);
    expect(signStorageUrl({ ...CLAIMS, key: 'files/user-2/abc123.png' }, SIGNING_KEY)).not.toBe(
      base,
    );
    expect(signStorageUrl({ ...CLAIMS, expiresAt: CLAIMS.expiresAt + 1 }, SIGNING_KEY)).not.toBe(
      base,
    );
  });

  it.each([
    ['empty key', { ...CLAIMS, key: '' }],
    ['fractional expiry', { ...CLAIMS, expiresAt: NOW_S + 0.5 }],
    ['zero expiry', { ...CLAIMS, expiresAt: 0 }],
    ['negative expiry', { ...CLAIMS, expiresAt: -1 }],
    ['NaN expiry', { ...CLAIMS, expiresAt: Number.NaN }],
  ])('refuses to sign %s', (_label, claims) => {
    expect(() => signStorageUrl(claims, SIGNING_KEY)).toThrow();
  });
});

describe('verifyStorageUrl', () => {
  it('accepts an untampered, unexpired signature and reports its expiry', () => {
    expect(verifyStorageUrl(signedRequest({}), SIGNING_KEY, NOW_MS)).toEqual({
      valid: true,
      expiresAt: CLAIMS.expiresAt,
    });
  });

  it('compares signatures with timingSafeEqual over equal-length digests', () => {
    const compare = vi.mocked(timingSafeEqual);
    compare.mockClear();

    verifyStorageUrl(signedRequest({}), SIGNING_KEY, NOW_MS);

    expect(compare).toHaveBeenCalledTimes(1);
    const [given, expected] = compare.mock.calls[0] ?? [];
    expect(Buffer.isBuffer(given) && given.length).toBe(32);
    expect(Buffer.isBuffer(expected) && expected.length).toBe(32);
  });

  describe('expiry', () => {
    it('accepts one second before expiry', () => {
      const result = verifyStorageUrl(signedRequest({}), SIGNING_KEY, CLAIMS.expiresAt * 1000 - 1);
      expect(result.valid).toBe(true);
    });

    it('rejects at the exact expiry instant', () => {
      expect(verifyStorageUrl(signedRequest({}), SIGNING_KEY, CLAIMS.expiresAt * 1000)).toEqual({
        valid: false,
        reason: 'expired',
      });
    });

    it('rejects after expiry', () => {
      expect(
        verifyStorageUrl(signedRequest({}), SIGNING_KEY, CLAIMS.expiresAt * 1000 + 60_000),
      ).toEqual({ valid: false, reason: 'expired' });
    });
  });

  describe('missing parameters', () => {
    it.each([
      ['signature undefined', { signature: undefined }],
      ['signature empty', { signature: '' }],
      ['expires undefined', { expires: undefined }],
      ['expires empty', { expires: '' }],
    ])('rejects %s', (_label, overrides) => {
      expect(verifyStorageUrl(signedRequest(overrides), SIGNING_KEY, NOW_MS)).toEqual({
        valid: false,
        reason: 'missing',
      });
    });

    it('rejects an empty key', () => {
      expect(verifyStorageUrl(signedRequest({ key: '' }), SIGNING_KEY, NOW_MS)).toEqual({
        valid: false,
        reason: 'missing',
      });
    });
  });

  describe('malformed parameters', () => {
    const good = signStorageUrl(CLAIMS, SIGNING_KEY);

    it.each([
      ['repeated param (array)', [good, good]],
      ['uppercase hex', good.toUpperCase()],
      ['truncated', good.slice(0, 63)],
      ['extended', `${good}0`],
      ['non-hex', `${good.slice(0, 63)}g`],
      ['base64url of the digest', Buffer.from(good, 'hex').toString('base64url')],
      ['number', 12345],
    ])('rejects a %s signature', (_label, signature) => {
      expect(verifyStorageUrl(signedRequest({ signature }), SIGNING_KEY, NOW_MS)).toEqual({
        valid: false,
        reason: 'malformed',
      });
    });

    it.each([
      ['fractional', `${String(CLAIMS.expiresAt)}.5`],
      ['negative', '-1'],
      ['zero', '0'],
      ['exponent', '1e10'],
      ['hex', '0x10'],
      ['leading space', ` ${String(CLAIMS.expiresAt)}`],
      ['leading zero', `0${String(CLAIMS.expiresAt)}`],
      ['absurdly large', '9'.repeat(20)],
      ['repeated param (array)', [String(CLAIMS.expiresAt), String(CLAIMS.expiresAt)]],
    ])('rejects a %s expiry', (_label, expires) => {
      expect(verifyStorageUrl(signedRequest({ expires }), SIGNING_KEY, NOW_MS)).toEqual({
        valid: false,
        reason: 'malformed',
      });
    });
  });

  describe('tampering', () => {
    it('rejects the signature replayed onto another object key', () => {
      expect(
        verifyStorageUrl(signedRequest({ key: 'files/user-2/abc123.png' }), SIGNING_KEY, NOW_MS),
      ).toEqual({ valid: false, reason: 'invalid' });
    });

    it('rejects a key that differs only in case', () => {
      expect(
        verifyStorageUrl(signedRequest({ key: CLAIMS.key.toUpperCase() }), SIGNING_KEY, NOW_MS),
      ).toEqual({ valid: false, reason: 'invalid' });
    });

    it('rejects an expiry pushed forward by one second', () => {
      expect(
        verifyStorageUrl(
          signedRequest({ expires: String(CLAIMS.expiresAt + 1) }),
          SIGNING_KEY,
          NOW_MS,
        ),
      ).toEqual({ valid: false, reason: 'invalid' });
    });

    it('rejects a signature with one flipped hex digit', () => {
      const good = signStorageUrl(CLAIMS, SIGNING_KEY);
      const flipped = `${good.slice(0, 10)}${good[10] === 'a' ? 'b' : 'a'}${good.slice(11)}`;
      expect(verifyStorageUrl(signedRequest({ signature: flipped }), SIGNING_KEY, NOW_MS)).toEqual({
        valid: false,
        reason: 'invalid',
      });
    });

    it('rejects a signature made with a different secret', () => {
      const foreign = signStorageUrl(CLAIMS, deriveStorageUrlKey(OTHER_SECRET));
      expect(verifyStorageUrl(signedRequest({ signature: foreign }), SIGNING_KEY, NOW_MS)).toEqual({
        valid: false,
        reason: 'invalid',
      });
    });

    it('rejects a signature keyed by the raw (underived) secret', () => {
      const rawKeyed = signStorageUrl(CLAIMS, Buffer.from(SECRET));
      const plainHmac = createHmac('sha256', SECRET)
        .update(JSON.stringify([CLAIMS.method, CLAIMS.key, CLAIMS.expiresAt]))
        .digest('hex');
      for (const signature of [rawKeyed, plainHmac]) {
        expect(verifyStorageUrl(signedRequest({ signature }), SIGNING_KEY, NOW_MS)).toEqual({
          valid: false,
          reason: 'invalid',
        });
      }
    });

    it('rejects a GET request carrying a PUT-bound signature', () => {
      const putSignature = signStorageUrl({ ...CLAIMS, method: 'PUT' }, SIGNING_KEY);
      expect(
        verifyStorageUrl(signedRequest({ signature: putSignature }), SIGNING_KEY, NOW_MS),
      ).toEqual({ valid: false, reason: 'invalid' });
    });

    // Killer: an attacker holding an expired link for their own file both
    // revives it and retargets it at a victim's key — every lever at once.
    it('rejects an expired link revived with a later expiry and a foreign key', () => {
      const expired = signStorageUrl({ ...CLAIMS, expiresAt: NOW_S - 1 }, SIGNING_KEY);
      expect(
        verifyStorageUrl(
          {
            method: 'GET',
            key: 'avatars/victim/photo.png',
            expires: String(NOW_S + MAX_SIGNED_URL_EXPIRES_SECONDS),
            signature: expired,
          },
          SIGNING_KEY,
          NOW_MS,
        ),
      ).toEqual({ valid: false, reason: 'invalid' });
    });
  });
});
