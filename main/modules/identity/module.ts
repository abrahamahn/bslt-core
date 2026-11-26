// main/modules/identity/module.ts
import { defineModule, job } from '@bslt/contract';
import { boolean, enumOf, number, object, optional, string } from '@bslt/schema';

import { identityEndpoints, identityEvents } from './contract';

const emptyJobPayloadSchema = object({});

const identityJobs = {
  sessionCleanup: job('identity.session_cleanup', emptyJobPayloadSchema, {
    queue: 'default',
    maxAttempts: 3,
    timeoutMs: 120_000,
  }),
  userRetention: job('identity.user_retention', emptyJobPayloadSchema, {
    queue: 'default',
    maxAttempts: 3,
    timeoutMs: 120_000,
  }),
  loginCleanup: job('identity.login_cleanup', emptyJobPayloadSchema, {
    queue: 'default',
    maxAttempts: 3,
    timeoutMs: 120_000,
  }),
  authTokensCleanup: job('identity.auth_tokens_cleanup', emptyJobPayloadSchema, {
    queue: 'default',
    maxAttempts: 3,
    timeoutMs: 120_000,
  }),
  oauthRefresh: job('identity.oauth_refresh', emptyJobPayloadSchema, {
    queue: 'default',
    maxAttempts: 3,
    timeoutMs: 120_000,
  }),
} as const;

const identityEnvSchema = object({
  APP_NAME: optional(string({ min: 1 })),
  JWT_SECRET: optional(string({ min: 1 })),
  JWT_ACCESS_EXPIRY: optional(string({ min: 1 })),
  REFRESH_EXPIRY_DAYS: optional(number({ coerce: true, int: true, min: 1 })),
  REFRESH_GRACE_PERIOD_SECONDS: optional(number({ coerce: true, int: true, min: 0 })),
  MAX_CONCURRENT_SESSIONS: optional(number({ coerce: true, int: true, min: 0 })),
  AUTH_AUTO_VERIFY_EMAIL: optional(boolean({ coerce: true })),
  LOCKOUT_MAX_ATTEMPTS: optional(number({ coerce: true, int: true, min: 0 })),
  LOCKOUT_DURATION_MS: optional(number({ coerce: true, int: true, min: 0 })),
  LOCKOUT_PROGRESSIVE_DELAY: optional(boolean({ coerce: true })),
  LOCKOUT_BASE_DELAY_MS: optional(number({ coerce: true, int: true, min: 0 })),
  CAPTCHA_ENABLED: optional(boolean({ coerce: true })),
  CAPTCHA_SECRET_KEY: optional(string()),
  MAGIC_LINK_EXPIRY_MINUTES: optional(number({ coerce: true, int: true, min: 1 })),
  MAGIC_LINK_MAX_ATTEMPTS: optional(number({ coerce: true, int: true, min: 1 })),
  LOGIN_ATTEMPTS_RETENTION_DAYS: optional(number({ coerce: true, int: true, min: 1 })),
  COOKIE_HTTP_ONLY: optional(boolean({ coerce: true })),
  COOKIE_SECURE: optional(boolean({ coerce: true })),
  COOKIE_SAME_SITE: optional(enumOf(['strict', 'lax', 'none'] as const)),
  COOKIE_PATH: optional(string({ min: 1 })),
  COOKIE_SECRET: optional(string({ min: 1 })),
  APP_BASE_URL: optional(string()),
  API_BASE_URL: optional(string()),
  ARGON2_TYPE: optional(number({ coerce: true, int: true, min: 0, max: 2 })),
  ARGON2_MEMORY_COST: optional(number({ coerce: true, int: true, min: 1024 })),
  ARGON2_TIME_COST: optional(number({ coerce: true, int: true, min: 1 })),
  ARGON2_PARALLELISM: optional(number({ coerce: true, int: true, min: 1 })),
  OAUTH_TOKEN_ENCRYPTION_KEY: optional(string({ min: 1 })),
  GOOGLE_CLIENT_ID: optional(string()),
  GOOGLE_CLIENT_SECRET: optional(string()),
  GOOGLE_CALLBACK_URL: optional(string()),
  GITHUB_CLIENT_ID: optional(string()),
  GITHUB_CLIENT_SECRET: optional(string()),
  GITHUB_CALLBACK_URL: optional(string()),
  APPLE_CLIENT_ID: optional(string()),
  APPLE_CALLBACK_URL: optional(string()),
  APPLE_TEAM_ID: optional(string()),
  APPLE_KEY_ID: optional(string()),
  APPLE_PRIVATE_KEY: optional(string()),
  APPLE_PRIVATE_KEY_BASE64: optional(string()),
  TOTP_ISSUER: optional(string({ min: 1 })),
  TOTP_WINDOW: optional(number({ coerce: true, int: true, min: 0, max: 10 })),
  AUTH_STRATEGIES: optional(string()),
  WEBAUTHN_RP_NAME: optional(string({ min: 1 })),
  WEBAUTHN_RP_ID: optional(string({ min: 1 })),
  WEBAUTHN_ORIGIN: optional(string({ min: 1 })),
  WEBAUTHN_ATTESTATION: optional(enumOf(['none', 'direct'] as const)),
});

export const identityModule = defineModule({
  id: 'identity',
  summary: 'User identity, authentication, sessions, and API keys.',
  status: 'stable',
  dependsOn: [],
  csp: {
    'img-src': ['https://lh3.googleusercontent.com', 'https://avatars.githubusercontent.com'],
  },
  endpoints: identityEndpoints,
  events: identityEvents,
  jobs: identityJobs,
  tables: [
    'identity_users',
    'identity_credentials',
    'identity_lockouts',
    'identity_profiles',
    'identity_refresh_tokens',
    'identity_login_attempts',
    'identity_auth_tokens',
    'identity_mfa_backup_codes',
    'identity_mfa_sms_codes',
    'identity_passkeys',
    'identity_trusted_devices',
    'identity_sessions',
    'identity_oauth_accounts',
    'identity_api_keys',
  ],
  env: identityEnvSchema,
});
