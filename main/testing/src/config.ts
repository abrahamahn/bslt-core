// main/testing/src/config.ts
/**
 * The config a test app runs on.
 *
 * It is the real loader's config (`load`) for a fixed test environment, so every
 * section has the shape and the defaults production has, with the values tests
 * depend on pinned on top: fast password hashing, generous rate limits, known
 * secrets, no lockout delay. A suite passes overrides for what it tests.
 */

import { load, type AppConfig } from '@bslt/server-system/config';

/** `T` with every nested property optional. Arrays are replaced whole. */
export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/** JWT secret of every test config; `createTestJwt` signs with it. */
export const TEST_JWT_SECRET = 'test-secret-that-is-at-least-32-chars-long!!';

const TEST_COOKIE_SECRET = 'test-cookie-secret-32-chars-long!';

/** The environment the loader reads. Nothing comes from `process.env`. */
const TEST_ENV: Readonly<Record<string, string>> = {
  NODE_ENV: 'test',
  JWT_SECRET: TEST_JWT_SECRET,
  COOKIE_SECRET: TEST_COOKIE_SECRET,
  OAUTH_TOKEN_ENCRYPTION_KEY: TEST_COOKIE_SECRET,
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  LOG_LEVEL: 'error',
};

/** The values tests rely on, over the loader's defaults. */
const TEST_VALUES: DeepPartial<AppConfig> = {
  app: { name: 'Your App' },
  env: 'test',
  server: {
    host: '127.0.0.1',
    port: 0,
    portFallbacks: [],
    cors: {
      origin: ['*'],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
    },
    trustProxy: false,
    logLevel: 'info',
    ipBlocklist: { blocklist: [], strictBlocklist: [], allowlist: [] },
    geo: {
      blockedRegions: [],
      countryHeader: 'cf-ipcountry',
      regionHeaders: ['cf-region-code', 'x-geo-region', 'cf-region'],
    },
    logging: { clientErrorLevel: 'warn', requestContext: true },
    maintenanceMode: false,
    auditRetentionDays: 90,
    // Every request of a suite comes from one address: the global limiter must
    // not be what a test runs into unless the suite sets a limit to test it.
    rateLimit: { windowMs: 60000, max: 1_000_000 },
    appBaseUrl: 'http://localhost:5173',
    apiBaseUrl: 'http://localhost:0',
  },
  auth: {
    strategies: ['local'],
    jwt: {
      secret: TEST_JWT_SECRET,
      accessTokenExpiry: '15m',
      issuer: 'test',
      audience: 'test',
    },
    refreshToken: { expiryDays: 7, gracePeriodSeconds: 30 },
    argon2: { type: 2, memoryCost: 1024, timeCost: 2, parallelism: 1 },
    password: { minLength: 8, maxLength: 64, minZxcvbnScore: 2 },
    lockout: {
      maxAttempts: 10,
      lockoutDurationMs: 1800000,
      progressiveDelay: false,
      baseDelayMs: 0,
    },
    proxy: { trustProxy: false, trustedProxies: [], maxProxyDepth: 1 },
    rateLimit: {
      login: { max: 100, windowMs: 60000 },
      register: { max: 100, windowMs: 60000 },
      forgotPassword: { max: 100, windowMs: 60000 },
      verifyEmail: { max: 100, windowMs: 60000 },
    },
    cookie: {
      name: 'refreshToken',
      secret: TEST_COOKIE_SECRET,
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
    },
    oauthTokenEncryptionKey: TEST_COOKIE_SECRET,
    oauth: {},
    magicLink: { tokenExpiryMinutes: 15, maxAttempts: 3 },
    totp: { issuer: 'Test', window: 1 },
  },
  email: {
    provider: 'console',
    smtp: {
      host: '',
      port: 587,
      secure: false,
      auth: { user: '', pass: '' },
      connectionTimeout: 5000,
      socketTimeout: 5000,
    },
    from: { name: 'Test', address: 'test@test.com' },
    replyTo: 'test@test.com',
  },
  storage: {
    provider: 'local',
    rootPath: './test-uploads',
    signingSecret: 'test-storage-signing-secret-at-least-32-chars',
  },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
  );
}

/** `base` with `overrides` merged in, object by object. Arrays and scalars are replaced. */
export function mergeConfig<T>(base: T, overrides: DeepPartial<T> | undefined): T {
  if (overrides === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(overrides)) return overrides as T;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    merged[key] = mergeConfig(merged[key], value as never);
  }
  return merged as T;
}

/**
 * The test config, with `overrides` merged in.
 *
 * @param overrides - What the suite tests (`{ auth: { strategies: [...] } }`).
 * @returns A full `AppConfig`.
 */
export function createTestConfig(overrides: DeepPartial<AppConfig> = {}): AppConfig {
  const loaded: AppConfig = load({ ...TEST_ENV });
  return mergeConfig<AppConfig>(mergeConfig<AppConfig>(loaded, TEST_VALUES), overrides);
}
