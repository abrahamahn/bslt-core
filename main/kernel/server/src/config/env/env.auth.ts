// main/kernel/server/src/config/env/env.auth.ts
/**
 * Authentication Environment Configuration
 *
 * Auth types, env interface, and validation schema.
 * Merged from config/types/auth.ts and the auth section of config/env.ts.
 *
 * @module config/env.auth
 */

import { defaulted, enumOf, number, object, optional, string } from '@bslt/schema';

import { trueFalseSchema } from './env.base';

import type { Schema } from '@bslt/schema';

// ============================================================================
// Types
// ============================================================================

/**
 * Supported authentication strategies.
 * Enable multiple strategies by listing them in AUTH_STRATEGIES env var.
 */
export type AuthStrategy =
  | 'local' // Email + password
  | 'magic' // Magic link (passwordless)
  | 'webauthn' // Passkeys/biometric
  | 'google'
  | 'github'
  | 'apple';

/**
 * OAuth provider credentials.
 * Obtain these from each provider's developer console.
 */
export interface OAuthProviderConfig {
  /** OAuth client ID from provider */
  clientId: string;
  /** OAuth client secret from provider */
  clientSecret: string;
  /** Callback URL registered with provider */
  callbackUrl: string;
}

/**
 * Complete authentication configuration.
 * Controls JWT, sessions, password policy, rate limiting, and OAuth.
 */
export interface AuthConfig {
  /** Enabled authentication strategies */
  strategies: AuthStrategy[];

  /**
   * Demo/testing convenience: when true, registration creates the user already
   * email-verified and skips the verification email so the client can auto-log
   * in immediately. Never enable in real deployments. Default: false.
   */
  autoVerifyEmail?: boolean;

  /** JWT token configuration */
  jwt: {
    /** Secret for signing tokens (min 32 chars, use openssl rand -base64 32) */
    secret: string;
    /** Previous secret for zero-downtime key rotation */
    previousSecret?: string;
    /** Access token expiry (e.g., '15m', '1h', or seconds as number) */
    accessTokenExpiry: string | number;
    /** Token issuer claim */
    issuer: string;
    /** Token audience claim */
    audience: string;
    /** Clock skew tolerance in seconds for token verification (default: 30) */
    clockToleranceSeconds?: number;
  };

  /** Refresh token configuration */
  refreshToken: {
    /** Token validity in days */
    expiryDays: number;
    /** Grace period for concurrent refresh requests (seconds) */
    gracePeriodSeconds: number;
  };

  /** Argon2 password hashing parameters (OWASP recommended) */
  argon2: {
    /** Algorithm variant: 0=argon2d, 1=argon2i, 2=argon2id (recommended) */
    type: 0 | 1 | 2;
    /** Memory cost in KiB */
    memoryCost: number;
    /** Number of iterations */
    timeCost: number;
    /** Degree of parallelism */
    parallelism: number;
  };

  /** Password policy settings */
  password: {
    /** Minimum password length */
    minLength: number;
    /** Maximum password length (prevent DoS) */
    maxLength: number;
    /** Minimum zxcvbn score (0-4, recommend 3+) */
    minZxcvbnScore: 0 | 1 | 2 | 3 | 4;
  };

  /** Account lockout settings for brute-force protection */
  lockout: {
    /** Failed attempts before lockout */
    maxAttempts: number;
    /** Lockout duration in milliseconds */
    lockoutDurationMs: number;
    /** Enable progressive delay between attempts */
    progressiveDelay: boolean;
    /** Base delay for progressive backoff (milliseconds) */
    baseDelayMs: number;
  };

  /** Reverse proxy configuration for accurate IP detection */
  proxy: {
    /** Trust X-Forwarded-For headers */
    trustProxy: boolean;
    /** Trusted proxy IP ranges (CIDR notation) */
    trustedProxies: string[];
    /** Maximum proxy chain depth to trust */
    maxProxyDepth: number;
  };

  /** Per-endpoint rate limiting */
  rateLimit: {
    login: { max: number; windowMs: number };
    register: { max: number; windowMs: number };
    forgotPassword: { max: number; windowMs: number };
    verifyEmail: { max: number; windowMs: number };
  };

  /** Refresh token cookie settings */
  cookie: {
    /** Cookie name */
    name: string;
    /** Cookie signing secret */
    secret: string;
    /** Prevent JavaScript access */
    httpOnly: boolean;
    /** Require HTTPS */
    secure: boolean;
    /** SameSite policy */
    sameSite: 'strict' | 'lax' | 'none';
    /** Cookie path */
    path: string;
  };

  /**
   * Encryption key for stored OAuth access/refresh tokens.
   * Separate from cookie.secret to allow independent key rotation.
   * Min 32 chars. Falls back to cookie.secret if not set (backwards-compatible).
   */
  oauthTokenEncryptionKey: string;

  /** OAuth provider configurations */
  oauth: {
    google?: OAuthProviderConfig;
    github?: OAuthProviderConfig;
    apple?: OAuthProviderConfig & {
      /** Apple Developer Team ID */
      teamId: string;
      /** Sign In with Apple Key ID */
      keyId: string;
      /** Private key (PEM format) */
      privateKey: string;
    };
  };

  /** Magic link (passwordless) settings */
  magicLink: {
    /** Link validity in minutes */
    tokenExpiryMinutes: number;
    /** Max attempts before temporary block */
    maxAttempts: number;
  };

  /** TOTP (2FA) settings */
  totp: {
    /** Issuer name shown in authenticator apps */
    issuer: string;
    /** Time window tolerance (number of periods) */
    window: number;
  };

  /**
   * CAPTCHA configuration for bot protection on public endpoints.
   * When enabled, login, register, and forgot-password require a valid CAPTCHA token.
   * Currently supports Cloudflare Turnstile.
   */
  captcha?: {
    /** Whether CAPTCHA verification is enabled */
    enabled: boolean;
    /** CAPTCHA provider (currently only Turnstile is supported) */
    provider: 'turnstile';
    /** Site key (public, sent to client) */
    siteKey: string;
    /** Secret key (server-side, for verification API calls) */
    secretKey: string;
  };

  /**
   * Session management settings.
   * Controls idle timeout and concurrent session limits.
   */
  sessions?: {
    /** Idle timeout in minutes. Sessions inactive longer are rejected on refresh. Default: 30 */
    idleTimeoutMinutes?: number;
    /** Maximum concurrent sessions per user. Oldest evicted when exceeded. Default: 10 */
    maxConcurrentSessions?: number;
  };

  /** WebAuthn/Passkey configuration */
  webauthn?: {
    /** Relying Party display name shown during registration */
    rpName: string;
    /** Relying Party ID (typically the domain, e.g. 'example.com') */
    rpId: string;
    /** Expected origin (e.g. 'https://example.com') */
    origin: string;
    /** Attestation preference. Default: 'none' */
    attestation?: 'none' | 'direct';
  };
}

/**
 * JWT rotation configuration for seamless secret key rotation.
 * Allows accepting tokens signed with previous secret during rotation period.
 */
export interface JwtRotationConfig {
  /** Current JWT signing secret */
  secret: string;
  /** Previous secret for accepting tokens during rotation */
  previousSecret?: string;
}

// ============================================================================
// Env Interface
// ============================================================================

/** Authentication environment variables */
export interface AuthEnv {
  AUTH_STRATEGIES?: string | undefined;
  JWT_SECRET: string;
  JWT_SECRET_PREVIOUS?: string | undefined;
  ACCESS_TOKEN_EXPIRY: string;
  JWT_ISSUER: string;
  JWT_AUDIENCE: string;
  REFRESH_TOKEN_EXPIRY_DAYS: number;
  REFRESH_TOKEN_GRACE_PERIOD: number;
  PASSWORD_MIN_LENGTH: number;
  PASSWORD_MAX_LENGTH: number;
  PASSWORD_MIN_SCORE: number;
  LOCKOUT_MAX_ATTEMPTS: number;
  LOCKOUT_DURATION_MS: number;
  RATE_LIMIT_LOGIN_MAX?: number | undefined;
  RATE_LIMIT_REGISTER_MAX?: number | undefined;
  RATE_LIMIT_FORGOT_PASSWORD_MAX?: number | undefined;
  RATE_LIMIT_VERIFY_EMAIL_MAX?: number | undefined;
  COOKIE_SECRET?: string | undefined;
  OAUTH_TOKEN_ENCRYPTION_KEY?: string | undefined;
  TRUST_PROXY?: 'true' | 'false' | undefined;
  TRUSTED_PROXIES?: string | undefined;
  MAX_PROXY_DEPTH?: number | undefined;
  GOOGLE_CLIENT_ID?: string | undefined;
  GOOGLE_CLIENT_SECRET?: string | undefined;
  GOOGLE_CALLBACK_URL?: string | undefined;
  GITHUB_CLIENT_ID?: string | undefined;
  GITHUB_CLIENT_SECRET?: string | undefined;
  GITHUB_CALLBACK_URL?: string | undefined;
  APPLE_CLIENT_ID?: string | undefined;
  APPLE_CLIENT_SECRET?: string | undefined;
  APPLE_CALLBACK_URL?: string | undefined;
  APPLE_TEAM_ID?: string | undefined;
  APPLE_KEY_ID?: string | undefined;
  APPLE_PRIVATE_KEY?: string | undefined;
  APPLE_PRIVATE_KEY_BASE64?: string | undefined;
  MAGIC_LINK_EXPIRY_MINUTES: number;
  MAGIC_LINK_MAX_ATTEMPTS: number;
  TOTP_ISSUER?: string | undefined;
  TOTP_WINDOW: number;
  CAPTCHA_ENABLED?: 'true' | 'false' | undefined;
  CAPTCHA_PROVIDER?: 'turnstile' | undefined;
  CAPTCHA_SITE_KEY?: string | undefined;
  CAPTCHA_SECRET_KEY?: string | undefined;
  AUTH_AUTO_VERIFY_EMAIL?: 'true' | 'false' | undefined;
  WEBAUTHN_RP_ID?: string | undefined;
  WEBAUTHN_RP_NAME?: string | undefined;
  WEBAUTHN_ORIGIN?: string | undefined;
  WEBAUTHN_ATTESTATION?: 'none' | 'direct' | undefined;
}

// ============================================================================
// Env Schema
// ============================================================================

export const AuthEnvSchema: Schema<AuthEnv> = object(
  {
    AUTH_STRATEGIES: optional(string({ label: 'AUTH_STRATEGIES' })),
    JWT_SECRET: string({ label: 'JWT_SECRET' }),
    JWT_SECRET_PREVIOUS: optional(string({ label: 'JWT_SECRET_PREVIOUS' })),
    ACCESS_TOKEN_EXPIRY: defaulted(string({ label: 'ACCESS_TOKEN_EXPIRY' }), '15m'),
    JWT_ISSUER: defaulted(string({ label: 'JWT_ISSUER' }), 'bslt'),
    JWT_AUDIENCE: defaulted(string({ label: 'JWT_AUDIENCE' }), 'bslt-api'),
    REFRESH_TOKEN_EXPIRY_DAYS: defaulted(
      number({ coerce: true, label: 'REFRESH_TOKEN_EXPIRY_DAYS' }),
      7,
    ),
    REFRESH_TOKEN_GRACE_PERIOD: defaulted(
      number({ coerce: true, label: 'REFRESH_TOKEN_GRACE_PERIOD' }),
      30,
    ),
    PASSWORD_MIN_LENGTH: defaulted(number({ coerce: true, label: 'PASSWORD_MIN_LENGTH' }), 8),
    PASSWORD_MAX_LENGTH: defaulted(number({ coerce: true, label: 'PASSWORD_MAX_LENGTH' }), 64),
    PASSWORD_MIN_SCORE: defaulted(number({ coerce: true, label: 'PASSWORD_MIN_SCORE' }), 3),
    LOCKOUT_MAX_ATTEMPTS: defaulted(number({ coerce: true, label: 'LOCKOUT_MAX_ATTEMPTS' }), 10),
    LOCKOUT_DURATION_MS: defaulted(number({ coerce: true, label: 'LOCKOUT_DURATION_MS' }), 1800000),
    RATE_LIMIT_LOGIN_MAX: optional(number({ coerce: true, label: 'RATE_LIMIT_LOGIN_MAX' })),
    RATE_LIMIT_REGISTER_MAX: optional(number({ coerce: true, label: 'RATE_LIMIT_REGISTER_MAX' })),
    RATE_LIMIT_FORGOT_PASSWORD_MAX: optional(
      number({ coerce: true, label: 'RATE_LIMIT_FORGOT_PASSWORD_MAX' }),
    ),
    RATE_LIMIT_VERIFY_EMAIL_MAX: optional(
      number({ coerce: true, label: 'RATE_LIMIT_VERIFY_EMAIL_MAX' }),
    ),
    COOKIE_SECRET: optional(string({ label: 'COOKIE_SECRET' })),
    OAUTH_TOKEN_ENCRYPTION_KEY: optional(string({ label: 'OAUTH_TOKEN_ENCRYPTION_KEY' })),
    TRUST_PROXY: optional(trueFalseSchema),
    TRUSTED_PROXIES: optional(string({ label: 'TRUSTED_PROXIES' })),
    MAX_PROXY_DEPTH: optional(number({ coerce: true, label: 'MAX_PROXY_DEPTH' })),
    GOOGLE_CLIENT_ID: optional(string({ label: 'GOOGLE_CLIENT_ID' })),
    GOOGLE_CLIENT_SECRET: optional(string({ label: 'GOOGLE_CLIENT_SECRET' })),
    GOOGLE_CALLBACK_URL: optional(string({ label: 'GOOGLE_CALLBACK_URL' })),
    GITHUB_CLIENT_ID: optional(string({ label: 'GITHUB_CLIENT_ID' })),
    GITHUB_CLIENT_SECRET: optional(string({ label: 'GITHUB_CLIENT_SECRET' })),
    GITHUB_CALLBACK_URL: optional(string({ label: 'GITHUB_CALLBACK_URL' })),
    APPLE_CLIENT_ID: optional(string({ label: 'APPLE_CLIENT_ID' })),
    APPLE_CLIENT_SECRET: optional(string({ label: 'APPLE_CLIENT_SECRET' })),
    APPLE_CALLBACK_URL: optional(string({ label: 'APPLE_CALLBACK_URL' })),
    APPLE_TEAM_ID: optional(string({ label: 'APPLE_TEAM_ID' })),
    APPLE_KEY_ID: optional(string({ label: 'APPLE_KEY_ID' })),
    APPLE_PRIVATE_KEY: optional(string({ label: 'APPLE_PRIVATE_KEY' })),
    APPLE_PRIVATE_KEY_BASE64: optional(string({ label: 'APPLE_PRIVATE_KEY_BASE64' })),
    MAGIC_LINK_EXPIRY_MINUTES: defaulted(
      number({ coerce: true, label: 'MAGIC_LINK_EXPIRY_MINUTES' }),
      15,
    ),
    MAGIC_LINK_MAX_ATTEMPTS: defaulted(
      number({ coerce: true, label: 'MAGIC_LINK_MAX_ATTEMPTS' }),
      3,
    ),
    TOTP_ISSUER: optional(string({ label: 'TOTP_ISSUER' })),
    TOTP_WINDOW: defaulted(number({ coerce: true, label: 'TOTP_WINDOW' }), 1),
    CAPTCHA_ENABLED: optional(trueFalseSchema),
    CAPTCHA_PROVIDER: optional(enumOf(['turnstile'] as const, 'CAPTCHA_PROVIDER')),
    CAPTCHA_SITE_KEY: optional(string({ label: 'CAPTCHA_SITE_KEY' })),
    CAPTCHA_SECRET_KEY: optional(string({ label: 'CAPTCHA_SECRET_KEY' })),
    AUTH_AUTO_VERIFY_EMAIL: optional(trueFalseSchema),
    WEBAUTHN_RP_ID: optional(string({ label: 'WEBAUTHN_RP_ID' })),
    WEBAUTHN_RP_NAME: optional(string({ label: 'WEBAUTHN_RP_NAME' })),
    WEBAUTHN_ORIGIN: optional(string({ label: 'WEBAUTHN_ORIGIN' })),
    WEBAUTHN_ATTESTATION: optional(enumOf(['none', 'direct'] as const, 'WEBAUTHN_ATTESTATION')),
  },
  { unknownKeys: 'strip' },
);
