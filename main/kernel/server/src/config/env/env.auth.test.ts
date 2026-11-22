// main/kernel/server/src/config/env/env.auth.test.ts
import { describe, expect, it, test } from 'vitest';

import { AuthEnvSchema } from './env.auth';

const REQUIRED = { JWT_SECRET: 'a'.repeat(32) };

describe('AuthEnvSchema', () => {
  it('requires JWT_SECRET', () => {
    expect(() => AuthEnvSchema.parse({})).toThrow();
    expect(() => AuthEnvSchema.parse(REQUIRED)).not.toThrow();
  });

  it('applies documented defaults', () => {
    const parsed = AuthEnvSchema.parse(REQUIRED);
    expect(parsed.ACCESS_TOKEN_EXPIRY).toBe('15m');
    expect(parsed.JWT_ISSUER).toBe('bslt');
    expect(parsed.JWT_AUDIENCE).toBe('bslt-api');
    expect(parsed.REFRESH_TOKEN_EXPIRY_DAYS).toBe(7);
    expect(parsed.REFRESH_TOKEN_GRACE_PERIOD).toBe(30);
    expect(parsed.PASSWORD_MIN_LENGTH).toBe(8);
    expect(parsed.PASSWORD_MAX_LENGTH).toBe(64);
    expect(parsed.PASSWORD_MIN_SCORE).toBe(3);
    expect(parsed.LOCKOUT_MAX_ATTEMPTS).toBe(10);
    expect(parsed.LOCKOUT_DURATION_MS).toBe(1_800_000);
    expect(parsed.MAGIC_LINK_EXPIRY_MINUTES).toBe(15);
    expect(parsed.MAGIC_LINK_MAX_ATTEMPTS).toBe(3);
    // No default here by design: `edc2a15d` moved it downstream so an unset
    // issuer resolves to the configured app name rather than the literal
    // "Your App" (see config/auth/auth.ts — `env.TOTP_ISSUER ?? appName`).
    expect(parsed.TOTP_ISSUER).toBeUndefined();
    expect(parsed.TOTP_WINDOW).toBe(1);
  });

  it('coerces numeric env strings', () => {
    const parsed = AuthEnvSchema.parse({
      ...REQUIRED,
      REFRESH_TOKEN_EXPIRY_DAYS: '14',
      LOCKOUT_MAX_ATTEMPTS: '5',
      TOTP_WINDOW: '2',
    });
    expect(parsed.REFRESH_TOKEN_EXPIRY_DAYS).toBe(14);
    expect(parsed.LOCKOUT_MAX_ATTEMPTS).toBe(5);
    expect(parsed.TOTP_WINDOW).toBe(2);
  });

  it('leaves optional OAuth credentials undefined when absent', () => {
    const parsed = AuthEnvSchema.parse(REQUIRED);
    expect(parsed.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(parsed.APPLE_PRIVATE_KEY).toBeUndefined();
    expect(parsed.COOKIE_SECRET).toBeUndefined();
  });

  test.each([
    ['non-numeric REFRESH_TOKEN_EXPIRY_DAYS', { REFRESH_TOKEN_EXPIRY_DAYS: 'soon' }],
    ['non-numeric PASSWORD_MIN_LENGTH', { PASSWORD_MIN_LENGTH: 'eight' }],
    ['invalid TRUST_PROXY flag', { TRUST_PROXY: 'yes' }],
    ['invalid CAPTCHA_ENABLED flag', { CAPTCHA_ENABLED: '1' }],
    ['unknown CAPTCHA_PROVIDER', { CAPTCHA_PROVIDER: 'recaptcha' }],
    ['non-string JWT_SECRET', { JWT_SECRET: 12345 }],
  ])('rejects %s', (_label, overrides) => {
    expect(() => AuthEnvSchema.parse({ ...REQUIRED, ...overrides })).toThrow();
  });

  it('accepts true/false flags and turnstile provider', () => {
    const parsed = AuthEnvSchema.parse({
      ...REQUIRED,
      TRUST_PROXY: 'true',
      CAPTCHA_ENABLED: 'false',
      CAPTCHA_PROVIDER: 'turnstile',
    });
    expect(parsed.TRUST_PROXY).toBe('true');
    expect(parsed.CAPTCHA_PROVIDER).toBe('turnstile');
  });

  it('rejects non-object input', () => {
    expect(() => AuthEnvSchema.parse(null)).toThrow();
    expect(() => AuthEnvSchema.parse('env')).toThrow();
  });
});
