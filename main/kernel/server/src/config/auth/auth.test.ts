// main/kernel/server/src/config/auth/auth.test.ts
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { loadAuthConfig, validateAuthConfig } from './auth';

import type { FullEnv } from '../env/env.validation';

/**
 * Creates a base environment with auth-related defaults (as applied by Zod schema).
 * Used to simulate properly parsed FullEnv in tests.
 */
function createBaseEnv(overrides: Partial<FullEnv> = {}): FullEnv {
  return {
    ACCESS_TOKEN_EXPIRY: '15m',
    JWT_ISSUER: 'your-app',
    JWT_AUDIENCE: 'your-app-api',
    REFRESH_TOKEN_EXPIRY_DAYS: 7,
    REFRESH_TOKEN_GRACE_PERIOD: 30,
    PASSWORD_MIN_LENGTH: 8,
    PASSWORD_MAX_LENGTH: 64,
    PASSWORD_MIN_SCORE: 3,
    LOCKOUT_MAX_ATTEMPTS: 10,
    LOCKOUT_DURATION_MS: 1800000,
    MAGIC_LINK_EXPIRY_MINUTES: 15,
    MAGIC_LINK_MAX_ATTEMPTS: 3,
    TOTP_ISSUER: 'Your App',
    TOTP_WINDOW: 1,
    ...overrides,
  } as unknown as FullEnv;
}

const apiBaseUrl = 'http://localhost:8080';
const load = (env: unknown) => loadAuthConfig(env as FullEnv, apiBaseUrl);

describe('Auth Configuration', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  test('should load default values when no env vars set', () => {
    const config = load(
      createBaseEnv({
        ['JWT_SECRET']: 'a-very-secure-secret-key-at-least-32-chars!',
      }),
    );
    expect(config.strategies).toEqual(['local']);
    expect(config.jwt.secret).toBe('a-very-secure-secret-key-at-least-32-chars!');
    expect(config.jwt.issuer).toBe('your-app');
  });

  test('should parse proxy settings', () => {
    vi.stubEnv('JWT_SECRET', 'a-very-secure-secret-key-at-least-32-chars!');
    vi.stubEnv('TRUST_PROXY', 'true');
    vi.stubEnv('TRUSTED_PROXIES', '192.168.1.1, 10.0.0.1');

    const config = load(process.env);
    expect(config.proxy.trustProxy).toBe(true);
  });

  test('should use dedicated oauth token encryption key when provided', () => {
    const config = load(
      createBaseEnv({
        ['JWT_SECRET']: 'a-very-secure-secret-key-at-least-32-chars!',
        ['OAUTH_TOKEN_ENCRYPTION_KEY']: 'dedicated-oauth-encryption-key-32-chars!',
      }),
    );
    expect(config.oauthTokenEncryptionKey).toBe('dedicated-oauth-encryption-key-32-chars!');
  });

  test('should fall back to cookie secret for oauth encryption key', () => {
    const config = load(
      createBaseEnv({
        ['JWT_SECRET']: 'a-very-secure-secret-key-at-least-32-chars!',
        ['COOKIE_SECRET']: 'cookie-signing-secret-key-at-least-32-chars!',
      }),
    );
    expect(config.oauthTokenEncryptionKey).toBe('cookie-signing-secret-key-at-least-32-chars!');
  });

  test('should fall back to jwt secret for oauth encryption key when no other keys set', () => {
    const config = load(
      createBaseEnv({
        ['JWT_SECRET']: 'a-very-secure-secret-key-at-least-32-chars!',
      }),
    );
    expect(config.oauthTokenEncryptionKey).toBe('a-very-secure-secret-key-at-least-32-chars!');
  });

  test('should have stricter rate limits in production', () => {
    const dev = load(
      createBaseEnv({
        ['NODE_ENV']: 'development',
        ['JWT_SECRET']: 'a-very-secure-secret-key-at-least-32-chars!',
      }),
    );
    const prod = load(
      createBaseEnv({
        ['NODE_ENV']: 'production',
        ['JWT_SECRET']: 'a-very-secure-secret-key-at-least-32-chars!',
      }),
    );
    expect(dev.rateLimit.login.max).toBe(100);
    expect(prod.rateLimit.login.max).toBe(5);
  });
});

describe('parseStrategies', () => {
  test('should handle whitespace and aliases', () => {
    const env = createBaseEnv({
      ['AUTH_STRATEGIES']: ' local , magic-link , google ',
      ['JWT_SECRET']: 'a-very-secure-secret-key-at-least-32-chars!',
    });
    const config = load(env);
    expect(config.strategies).toEqual(['local', 'magic', 'google']);
  });

  test('should throw for invalid strategies instead of silently dropping', () => {
    const env = createBaseEnv({
      ['AUTH_STRATEGIES']: 'local,invalid_provider',
      ['JWT_SECRET']: 'a-very-secure-secret-key-at-least-32-chars!',
    });
    expect(() => load(env)).toThrow(/Invalid auth strategies/);
  });
});

describe('TOTP issuer defaulting', () => {
  const jwt = 'a-very-secure-secret-key-at-least-32-chars!';

  test('defaults the issuer to the app name (shown in the authenticator app)', () => {
    const config = loadAuthConfig(
      createBaseEnv({ ['TOTP_ISSUER']: undefined, ['JWT_SECRET']: jwt }),
      apiBaseUrl,
      'Acme Corp',
    );
    expect(config.totp.issuer).toBe('Acme Corp');
  });

  test('an explicit TOTP_ISSUER wins over the app name', () => {
    const config = loadAuthConfig(
      createBaseEnv({ ['TOTP_ISSUER']: 'Acme 2FA', ['JWT_SECRET']: jwt }),
      apiBaseUrl,
      'Acme Corp',
    );
    expect(config.totp.issuer).toBe('Acme 2FA');
  });
});

describe('WebAuthn relying-party config', () => {
  const jwt = 'a-very-secure-secret-key-at-least-32-chars!';

  test('is absent when the webauthn strategy is not enabled', () => {
    const config = load(createBaseEnv({ ['AUTH_STRATEGIES']: 'local', ['JWT_SECRET']: jwt }));
    expect(config.webauthn).toBeUndefined();
  });

  test('is built (so the ceremony works) when webauthn is enabled', () => {
    const config = load(
      createBaseEnv({ ['AUTH_STRATEGIES']: 'local,webauthn', ['JWT_SECRET']: jwt }),
    );
    // apiBaseUrl is http://localhost:8080 → rpId derives to the hostname.
    expect(config.webauthn).toMatchObject({
      rpId: 'localhost',
      origin: 'http://localhost:8080',
      attestation: 'none',
    });
  });

  test('explicit WEBAUTHN_* env vars win over derivation', () => {
    const config = load(
      createBaseEnv({
        ['AUTH_STRATEGIES']: 'local,webauthn',
        ['JWT_SECRET']: jwt,
        ['WEBAUTHN_RP_ID']: 'example.com',
        ['WEBAUTHN_RP_NAME']: 'Acme',
        ['WEBAUTHN_ORIGIN']: 'https://app.example.com',
        ['WEBAUTHN_ATTESTATION']: 'direct',
      } as Partial<FullEnv>),
    );
    expect(config.webauthn).toEqual({
      rpId: 'example.com',
      rpName: 'Acme',
      origin: 'https://app.example.com',
      attestation: 'direct',
    });
  });
});

describe('Security Validation', () => {
  const baseValidConfig = () =>
    load(
      createBaseEnv({
        ['JWT_SECRET']: 'long-enough-secret-key-32-characters-minimum',
        ['COOKIE_SECRET']: 'another-long-enough-secret-32-characters',
      }),
    );

  test('should throw if JWT secret is too short', () => {
    const config = baseValidConfig();
    (config.jwt as any).secret = 'short';

    expect(() => {
      validateAuthConfig(config);
    }).toThrow(/JWT secret must be at least 32 characters/);
  });

  test('should throw if JWT secret is a weak value', () => {
    const config = baseValidConfig();
    (config.jwt as any).secret = 'password' + ' '.repeat(24);

    expect(() => {
      validateAuthConfig(config);
    }).toThrow(/JWT secret is a weak value/);
  });

  test('should throw if password minLength is too small', () => {
    const config = baseValidConfig();
    (config.password as any).minLength = 6;

    expect(() => {
      validateAuthConfig(config);
    }).toThrow(/Min password length must be at least 8 characters/);
  });

  test('should throw if lockout duration is too short', () => {
    const config = baseValidConfig();
    (config.lockout as any).lockoutDurationMs = 30000;

    expect(() => {
      validateAuthConfig(config);
    }).toThrow(/Lockout duration must be at least 60000ms/);
  });

  test('should throw if oauth token encryption key is too short', () => {
    const config = baseValidConfig();
    (config as any).oauthTokenEncryptionKey = 'too-short';

    expect(() => {
      validateAuthConfig(config);
    }).toThrow(/OAuth token encryption key must be at least 32 characters/);
  });
});
