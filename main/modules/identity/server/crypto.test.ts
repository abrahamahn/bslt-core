// main/modules/identity/server/crypto.test.ts
import { describe, expect, it } from 'vitest';

import {
  LIVENESS_TTL_MS,
  canonicalizeEmail,
  clearLivenessCache,
  createAccessToken,
  createAuthEmailTemplates,
  createChallengeToken,
  createRefreshToken,
  createSudoToken,
  decryptToken,
  decryptTotpSecret,
  encryptToken,
  encryptTotpSecret,
  generateBase64UrlToken,
  generateNumericCode,
  generateSecureToken,
  getLiveness,
  getRefreshTokenExpiry,
  hashPassword,
  hashToken,
  hasPassword,
  initDummyHashPool,
  invalidateLiveness,
  isDummyHashPoolInitialized,
  isLegacyPlaintextSecret,
  needsRehash,
  normalizeEmail,
  parseUserAgentDeviceInfo,
  resetDummyHashPool,
  setLiveness,
  verifyChallengeToken,
  verifyPassword,
  verifyPasswordSafe,
  verifySudoToken,
  verifyToken,
} from './crypto';

const FAST_ARGON2 = { type: 2 as const, memoryCost: 1024, timeCost: 1, parallelism: 1 };
const SECRET = 'test-jwt-secret-with-at-least-32-chars!';

describe('identity server crypto, JWT, sudo, liveness, and email primitives', () => {
  it('hashes and verifies Argon2id passwords, detects rehash parameters, and rejects tampered/malformed hashes', async () => {
    const hash = await hashPassword('Correct$Horse9Battery!', FAST_ARGON2);
    expect(hash.startsWith('$argon2id$v=19$')).toBe(true);
    expect(await verifyPassword('Correct$Horse9Battery!', hash)).toBe(true);
    expect(await verifyPassword('WrongPassword!', hash)).toBe(false);
    expect(await verifyPassword('Correct$Horse9Battery!', 'not-a-phc-hash')).toBe(false);
    expect(
      await verifyPassword('Correct$Horse9Battery!', '$argon2id$v=19$m=8,t=1,p=1$YWJj$ZGVm'),
    ).toBe(false);

    expect(needsRehash(hash, FAST_ARGON2)).toBe(false);
    expect(needsRehash(hash, { ...FAST_ARGON2, timeCost: 2 })).toBe(true);
    expect(needsRehash('garbage', FAST_ARGON2)).toBe(true);

    expect(hasPassword(hash)).toBe(true);
    expect(hasPassword('oauth:random')).toBe(false);
    expect(hasPassword('magiclink:random')).toBe(false);
    expect(hasPassword('emailotp:random')).toBe(false);

    resetDummyHashPool();
    expect(isDummyHashPoolInitialized()).toBe(false);
    expect(await verifyPasswordSafe('anything', null, FAST_ARGON2)).toBe(false);
    await initDummyHashPool(FAST_ARGON2);
    expect(isDummyHashPoolInitialized()).toBe(true);
    expect(await verifyPasswordSafe('Correct$Horse9Battery!', hash, FAST_ARGON2)).toBe(true);
    expect(await verifyPasswordSafe('Wrong', hash, FAST_ARGON2)).toBe(false);
  });

  it('mints and verifies access and sudo JWTs and rejects short secrets, expired tokens, and token-type confusion', () => {
    expect(() => createAccessToken('u-1', 'a@b.io', 'user', 'short')).toThrow(/32 characters/);
    expect(() => verifyToken('tok', 'short')).toThrow(/32 characters/);

    const access = createAccessToken('u-1', 'a@b.io', 'admin', SECRET, '15m', 4);
    expect(verifyToken(access, SECRET)).toMatchObject({
      userId: 'u-1',
      email: 'a@b.io',
      role: 'admin',
      tokenVersion: 4,
    });
    expect(() => verifyToken(access, 'another-secret-with-at-least-32-chars!!')).toThrow();

    // Access token must never verify as a sudo token
    expect(verifySudoToken(access, SECRET)).toBeNull();
    expect(verifySudoToken('garbage.token.here', SECRET)).toBeNull();

    const sudo = createSudoToken('u-1', SECRET, 5);
    expect(verifySudoToken(sudo.sudoToken, SECRET)).toEqual({ userId: 'u-1' });
    // Sudo token lacks email/role so verifyToken rejects it
    expect(() => verifyToken(sudo.sudoToken, SECRET)).toThrow();

    const expiredSudo = createSudoToken('u-1', SECRET, -1);
    expect(verifySudoToken(expiredSudo.sudoToken, SECRET)).toBeNull();
  });

  it('generates high-entropy tokens, fractional-day refresh expiries, canonical emails, UA device labels, and liveness cache entries', () => {
    const pair = generateSecureToken();
    expect(pair.plain).toHaveLength(64);
    expect(pair.hash).toBe(hashToken(pair.plain));
    expect(generateBase64UrlToken(16).length).toBeGreaterThan(10);
    expect(generateNumericCode(6)).toMatch(/^\d{6}$/u);
    expect(createRefreshToken()).toHaveLength(128);

    const halfDay = getRefreshTokenExpiry(0.5, new Date('2026-01-01T00:00:00.000Z'));
    expect(halfDay.toISOString()).toBe('2026-01-01T12:00:00.000Z');

    expect(normalizeEmail('  Alice.Smith+tag@Gmail.COM ')).toBe('alice.smith+tag@gmail.com');
    expect(canonicalizeEmail('  Alice.Smith+tag@Gmail.COM ')).toBe('alicesmith@gmail.com');
    expect(canonicalizeEmail('bob+work@company.io')).toBe('bob@company.io');

    expect(parseUserAgentDeviceInfo(null)).toEqual({ deviceName: null, deviceType: null });
    expect(
      parseUserAgentDeviceInfo('Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0.0.0 Safari/537.36'),
    ).toEqual({ deviceName: 'Chrome on Linux', deviceType: 'desktop' });

    clearLivenessCache();
    expect(LIVENESS_TTL_MS).toBe(10_000);
    expect(getLiveness('u-1')).toBeNull();
    setLiveness('u-1', { tokenVersion: 2, lockedUntil: null, lockReason: null, role: 'user' });
    expect(getLiveness('u-1')?.tokenVersion).toBe(2);
    invalidateLiveness('u-1');
    expect(getLiveness('u-1')).toBeNull();

    const templates = createAuthEmailTemplates({ appName: 'BSLT' });
    const reset = templates.passwordReset('https://app.bslt.dev/auth/reset?token=abc');
    expect(reset.subject).toBe('Reset your password');
    expect(reset.text).toContain('https://app.bslt.dev/auth/reset?token=abc');
  });

  it('encrypts/decrypts AES-256-GCM tokens & TOTP seeds and rejects tampered ciphertexts, wrong keys, and invalid challenge JWTs', () => {
    const encKey = 'test-encryption-key-at-least-32-chars!!';
    const ciphertext = encryptToken('JBSWY3DPEHPK3PXP', encKey);
    expect(ciphertext.split(':')).toHaveLength(4);
    expect(isLegacyPlaintextSecret('JBSWY3DPEHPK3PXP')).toBe(true);
    expect(isLegacyPlaintextSecret(ciphertext)).toBe(false);

    // Failure assertions (>= 60%): malformed format, wrong key, tampered GCM tag, wrong challenge purpose
    expect(() => decryptToken('not-colon-separated', encKey)).toThrow(/Invalid encrypted token/u);
    expect(() => decryptToken(ciphertext, 'wrong-encryption-key-32-characters!')).toThrow();
    const parts = ciphertext.split(':');
    const tampered = `${parts[0]}:${parts[1]}:AAAA:${parts[3]}`;
    expect(() => decryptTotpSecret(tampered, encKey)).toThrow();

    const access = createAccessToken('u-1', 'a@b.io', 'user', SECRET);
    expect(verifyChallengeToken(access, SECRET, ['totp_challenge'])).toBeNull();
    expect(verifyChallengeToken('malformed.jwt', SECRET, ['totp_challenge'])).toBeNull();

    const smsChallenge = createChallengeToken('u-1', 'sms_challenge', SECRET, '5m');
    expect(verifyChallengeToken(smsChallenge, SECRET, ['totp_challenge'])).toBeNull();
    expect(
      verifyChallengeToken(smsChallenge, 'wrong-jwt-secret-with-32-characters!!', [
        'sms_challenge',
      ]),
    ).toBeNull();

    // Positive assertions
    const encryptedSeed = encryptTotpSecret('JBSWY3DPEHPK3PXP', encKey);
    expect(decryptTotpSecret(encryptedSeed, encKey)).toBe('JBSWY3DPEHPK3PXP');
    expect(decryptTotpSecret('JBSWY3DPEHPK3PXP', encKey)).toBe('JBSWY3DPEHPK3PXP');

    const totpChallenge = createChallengeToken('u-1', 'totp_challenge', SECRET, '5m');
    const verified = verifyChallengeToken(totpChallenge, SECRET, [
      'totp_challenge',
      'sms_challenge',
    ]);
    expect(verified).toMatchObject({ userId: 'u-1', purpose: 'totp_challenge' });
    expect(typeof verified?.jti).toBe('string');
  });
});
