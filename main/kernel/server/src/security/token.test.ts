// main/kernel/server/src/security/token.test.ts
/**
 * CSRF token primitives: generation, HMAC signing, AES-256-GCM encryption, and
 * the double-submit comparison built on top of them.
 *
 * This file had no tests. Everything here is a function whose *failure* is the
 * security property — a signature check that accepts a forgery, a decrypt that
 * returns plaintext for a tampered ciphertext, or a comparison that throws
 * instead of returning false, are all indistinguishable from working code until
 * someone attacks them. So the failure states carry the weight, and the
 * happy-path tests exist mainly to prove the failures are not vacuous.
 */

import { describe, expect, it } from 'vitest';

import {
  decryptToken,
  encryptToken,
  generateToken,
  signToken,
  TOKEN_LENGTH,
  validateCsrfToken,
  verifyToken,
} from './token';

const SECRET = 'test-secret-value-for-csrf-signing';
const OTHER_SECRET = 'a-different-secret-entirely';

/**
 * Flip one bit of a base64url segment, via its decoded bytes.
 *
 * Mutating the encoded *characters* is not enough: a 16-byte value encodes to
 * 22 base64url characters, and the last one carries only two significant bits.
 * Changing 'A' to 'B' there alters a padding bit and decodes to the same bytes,
 * so the tamper is not a tamper — a test doing that passes or fails depending
 * on which character the value happened to end with.
 */
function tamper(segment: string): string {
  const bytes = Buffer.from(segment, 'base64url');
  bytes.writeUInt8(bytes.readUInt8(0) ^ 0xff, 0);
  return bytes.toString('base64url');
}

describe('generateToken', () => {
  it('returns a base64url encoding of TOKEN_LENGTH random bytes', () => {
    const token = generateToken();

    expect(Buffer.from(token, 'base64url')).toHaveLength(TOKEN_LENGTH);
  });

  /** base64url must not leak `+`, `/` or `=`; those break cookies and URLs. */
  it('uses the URL-safe alphabet with no padding', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('does not repeat across many calls', () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateToken()));

    expect(seen.size).toBe(500);
  });
});

describe('signToken / verifyToken', () => {
  it('verifies a token it just signed', () => {
    const token = generateToken();

    expect(verifyToken(signToken(token, SECRET), SECRET)).toEqual({ valid: true, token });
  });

  /**
   * The token is everything before the LAST dot, so a token containing dots
   * still round-trips. If it split on the first dot instead, base64url tokens
   * would be fine but any dotted payload would silently verify as a truncated
   * token.
   */
  it('round-trips a token that itself contains dots', () => {
    const token = 'a.b.c';

    expect(verifyToken(signToken(token, SECRET), SECRET)).toEqual({ valid: true, token });
  });

  describe('failure states', () => {
    it('rejects a token signed with a different secret', () => {
      const signed = signToken(generateToken(), OTHER_SECRET);

      expect(verifyToken(signed, SECRET)).toEqual({ valid: false, token: null });
    });

    it('rejects a payload swapped under a valid signature', () => {
      const [, signature] = signToken('original', SECRET).split('.');

      expect(verifyToken(`tampered.${String(signature)}`, SECRET)).toEqual({
        valid: false,
        token: null,
      });
    });

    it('rejects a mutated signature', () => {
      const signed = signToken('payload', SECRET);
      const [payload, signature] = signed.split('.');
      const mutated = `${String(payload)}.${tamper(String(signature))}`;

      expect(verifyToken(mutated, SECRET).valid).toBe(false);
    });

    it('rejects a value with no signature separator at all', () => {
      expect(verifyToken('no-dot-here', SECRET)).toEqual({ valid: false, token: null });
    });

    it('rejects an empty signature', () => {
      expect(verifyToken('payload.', SECRET).valid).toBe(false);
    });

    /**
     * `timingSafeEqual` throws on length mismatch, so a short signature must not
     * become a 500. Note what this does *not* pin: the explicit length guard is
     * belt-and-braces, because the surrounding `catch` already converts the
     * throw into the same `false`. Deleting the guard fails nothing here, and
     * that was verified rather than assumed.
     */
    it('returns false rather than throwing on a short signature', () => {
      expect(() => verifyToken('payload.AA', SECRET)).not.toThrow();
      expect(verifyToken('payload.AA', SECRET).valid).toBe(false);
    });

    it('returns false rather than throwing on a non-base64 signature', () => {
      expect(() => verifyToken('payload.!!!!not base64!!!!', SECRET)).not.toThrow();
      expect(verifyToken('payload.!!!!not base64!!!!', SECRET).valid).toBe(false);
    });

    it('rejects the empty string', () => {
      expect(verifyToken('', SECRET)).toEqual({ valid: false, token: null });
    });
  });
});

describe('encryptToken / decryptToken', () => {
  it('decrypts what it encrypted', () => {
    const token = generateToken();

    expect(decryptToken(encryptToken(token, SECRET), SECRET)).toBe(token);
  });

  /**
   * A fresh IV per call. Without it, identical plaintexts produce identical
   * ciphertexts and the cookie becomes a stable fingerprint.
   */
  it('produces a different ciphertext each time for the same input', () => {
    const token = 'stable-plaintext';
    const first = encryptToken(token, SECRET);
    const second = encryptToken(token, SECRET);

    expect(first).not.toBe(second);
    expect(decryptToken(first, SECRET)).toBe(token);
    expect(decryptToken(second, SECRET)).toBe(token);
  });

  it('emits the documented iv.ciphertext.authTag shape', () => {
    const parts = encryptToken('x', SECRET).split('.');

    expect(parts).toHaveLength(3);
    expect(Buffer.from(String(parts[0]), 'base64url')).toHaveLength(16);
    expect(Buffer.from(String(parts[2]), 'base64url')).toHaveLength(16);
  });

  describe('failure states — all return null, none throw', () => {
    it('refuses a ciphertext encrypted under another secret', () => {
      expect(decryptToken(encryptToken('secret-value', OTHER_SECRET), SECRET)).toBeNull();
    });

    /** The GCM auth tag is what makes the ciphertext non-malleable. */
    it('refuses a tampered ciphertext', () => {
      const [iv, encrypted, tag] = encryptToken('secret-value', SECRET).split('.');

      expect(
        decryptToken(`${String(iv)}.${tamper(String(encrypted))}.${String(tag)}`, SECRET),
      ).toBeNull();
    });

    it('refuses a tampered auth tag', () => {
      const [iv, encrypted, tag] = encryptToken('secret-value', SECRET).split('.');

      expect(
        decryptToken(`${String(iv)}.${String(encrypted)}.${tamper(String(tag))}`, SECRET),
      ).toBeNull();
    });

    it('refuses a swapped IV', () => {
      const [, encrypted, tag] = encryptToken('secret-value', SECRET).split('.');
      const otherIv = encryptToken('anything', SECRET).split('.')[0];

      expect(
        decryptToken(`${String(otherIv)}.${String(encrypted)}.${String(tag)}`, SECRET),
      ).toBeNull();
    });

    it.each([
      ['too few parts', 'onlyone'],
      ['two parts', 'iv.encrypted'],
      ['four parts', 'a.b.c.d'],
      ['empty iv', '.encrypted.tag'],
      ['empty ciphertext', 'aXY..tag'],
      ['empty auth tag', 'aXY.encrypted.'],
      ['empty string', ''],
      ['not base64 at all', '!!!.???.***'],
    ])('refuses %s', (_label, input) => {
      expect(() => decryptToken(input, SECRET)).not.toThrow();
      expect(decryptToken(input, SECRET)).toBeNull();
    });
  });
});

describe('validateCsrfToken', () => {
  describe('signed cookies (the default)', () => {
    it('accepts a matching pair', () => {
      const token = generateToken();

      expect(validateCsrfToken(signToken(token, SECRET), token, { secret: SECRET })).toBe(true);
    });

    it('rejects a request token that does not match the cookie', () => {
      const cookie = signToken(generateToken(), SECRET);

      expect(validateCsrfToken(cookie, generateToken(), { secret: SECRET })).toBe(false);
    });

    it('rejects a cookie signed with another secret', () => {
      const token = generateToken();

      expect(validateCsrfToken(signToken(token, OTHER_SECRET), token, { secret: SECRET })).toBe(
        false,
      );
    });

    /** An attacker who can set an unsigned cookie must not pass the check. */
    it('rejects an unsigned cookie when signing is expected', () => {
      const token = generateToken();

      expect(validateCsrfToken(token, token, { secret: SECRET })).toBe(false);
    });
  });

  describe('encrypted cookies', () => {
    it('accepts an encrypted, signed pair', () => {
      const token = generateToken();
      const cookie = encryptToken(signToken(token, SECRET), SECRET);

      expect(validateCsrfToken(cookie, token, { secret: SECRET, encrypted: true })).toBe(true);
    });

    it('accepts an encrypted, unsigned pair when signing is disabled', () => {
      const token = generateToken();
      const cookie = encryptToken(token, SECRET);

      expect(
        validateCsrfToken(cookie, token, { secret: SECRET, encrypted: true, signed: false }),
      ).toBe(true);
    });

    /** Downgrade: a plaintext cookie must not satisfy an encrypted config. */
    it('rejects a plaintext cookie when encryption is expected', () => {
      const token = generateToken();

      expect(
        validateCsrfToken(signToken(token, SECRET), token, { secret: SECRET, encrypted: true }),
      ).toBe(false);
    });

    it('rejects a cookie encrypted under another secret', () => {
      const token = generateToken();
      const cookie = encryptToken(signToken(token, OTHER_SECRET), OTHER_SECRET);

      expect(validateCsrfToken(cookie, token, { secret: SECRET, encrypted: true })).toBe(false);
    });
  });

  describe('missing and malformed input', () => {
    it.each([
      ['both undefined', undefined, undefined],
      ['no cookie', undefined, 'request-token'],
      ['no request token', 'cookie-token', undefined],
      ['empty cookie', '', 'request-token'],
      ['empty request token', 'cookie-token', ''],
    ])('rejects %s', (_label, cookie, request) => {
      expect(validateCsrfToken(cookie, request, { secret: SECRET })).toBe(false);
    });

    /**
     * `timingSafeEqual` throws when the buffers differ in length, so the
     * comparison must be length-guarded. Otherwise a request token of the wrong
     * size turns a CSRF rejection into an unhandled exception.
     */
    it('returns false rather than throwing when the lengths differ', () => {
      const token = generateToken();
      const cookie = signToken(token, SECRET);

      expect(() => validateCsrfToken(cookie, 'short', { secret: SECRET })).not.toThrow();
      expect(validateCsrfToken(cookie, 'short', { secret: SECRET })).toBe(false);
    });
  });

  /**
   * With `signed: false` and no encryption nothing authenticates the cookie —
   * the check degrades to a bare double-submit, which only proves the caller
   * could read the cookie. Pinned so the weakening is a visible decision rather
   * than a surprise.
   */
  it('accepts any self-consistent pair when signing and encryption are both off', () => {
    expect(
      validateCsrfToken('attacker-chosen', 'attacker-chosen', { secret: SECRET, signed: false }),
    ).toBe(true);
  });
});
