// tests/e2e/fixtures/auth-contracts.ts
/**
 * Contract-pinned mock responses for the advanced-auth e2e specs.
 *
 * OAuth/TOTP/SMS/passkey/magic-link are capability-off in the starter
 * server, so their specs must mock the API — but every mocked body built
 * here is parsed through (or typed by) the shared auth contracts, so
 * contract drift fails the suite at mock-construction time instead of
 * silently testing an invented shape.
 */

import { tosStatusResponseSchema, type TosStatusResponse } from '@bslt/compliance/contract';
import {
  serializedCapabilityContextSchema,
  type SerializedCapabilityContext,
} from '@bslt/contract';
import {
  AUTH_STRATEGIES,
  authResponseSchema,
  emailOtpRequestResponseSchema,
  emailOtpVerifyResponseSchema,
  magicLinkRequestResponseSchema,
  magicLinkVerifyResponseSchema,
  oauthEnabledProvidersResponseSchema,
  profileCompletenessResponseSchema,
  sessionsListResponseSchema,
  totpLoginChallengeResponseSchema,
  userSchema,
  webauthnOptionsResponseSchema,
  type AuthResponse,
  type AuthStrategy,
  type EmailOtpRequestResponse,
  type EmailOtpVerifyResponse,
  type MagicLinkRequestResponse,
  type MagicLinkVerifyResponse,
  type OAuthProvider,
  type ProfileCompletenessResponse,
  type SessionsListResponse,
  type SmsLoginChallengeResponse,
  type TotpLoginChallengeResponse,
  type User,
  type WebauthnOptionsResponse,
} from '@bslt/identity/contract';

export type { AuthStrategy, OAuthProvider };

const BASE_USER = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  email: 'testuser@example.com',
  username: 'testuser',
  firstName: 'Test',
  lastName: 'User',
  role: 'user',
  emailVerified: true,
  phone: null,
  phoneVerified: null,
  dateOfBirth: null,
  gender: null,
  bio: null,
  city: null,
  state: null,
  country: null,
  language: null,
  website: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/** A contract-valid user for users/me and login responses. */
export function buildMockUser(overrides: Record<string, unknown> = {}): User {
  return userSchema.parse({ ...BASE_USER, ...overrides });
}

/**
 * GET /api/auth/strategies — mirrors the real handler exactly:
 * disabled is always AUTH_STRATEGIES minus the enabled set.
 */
export function strategiesResponse(enabled: readonly AuthStrategy[]): {
  enabled: AuthStrategy[];
  disabled: AuthStrategy[];
} {
  return {
    enabled: [...enabled],
    disabled: AUTH_STRATEGIES.filter((strategy) => !enabled.includes(strategy)),
  };
}

/** GET /api/auth/oauth/providers — provider names validated against the contract enum. */
export function oauthProvidersResponse(providers: readonly OAuthProvider[]): {
  providers: OAuthProvider[];
} {
  return oauthEnabledProvidersResponseSchema.parse({ providers: [...providers] });
}

/** Verify-success shape shared by TOTP/SMS/passkey verification endpoints. */
export function authSuccessResponse(user: User, token = 'mock-access-token'): AuthResponse {
  return authResponseSchema.parse({ token, user });
}

/** POST /api/auth/login → 202 TOTP challenge. */
export function totpChallengeResponse(challengeToken: string): TotpLoginChallengeResponse {
  return totpLoginChallengeResponseSchema.parse({
    requiresTotp: true,
    challengeToken,
    message: 'Two-factor authentication required',
  });
}

/** POST /api/auth/login → 202 SMS challenge (type-pinned; no runtime schema exists yet). */
export function smsChallengeResponse(challengeToken: string): SmsLoginChallengeResponse {
  return {
    requiresSms: true,
    challengeToken,
    message: 'SMS verification code sent',
  };
}

/** GET /api/auth/tos/status for an up-to-date user. */
export function tosStatusAccepted(): TosStatusResponse {
  return tosStatusResponseSchema.parse({ accepted: true, requiredVersion: null, documentId: null });
}

/** POST /api/auth/webauthn/login/options — options envelope. */
export function webauthnOptionsResponse(options: Record<string, unknown>): WebauthnOptionsResponse {
  return webauthnOptionsResponseSchema.parse({ options });
}

/** POST /api/auth/magic-link/request — enumeration-safe success message. */
export function magicLinkRequestedResponse(
  message = 'If the email exists, a sign-in link has been sent.',
): MagicLinkRequestResponse {
  return magicLinkRequestResponseSchema.parse({ message });
}

/** GET /api/auth/magic-link/verify success. */
export function magicLinkVerifiedResponse(
  user: User,
  token = 'mock-access-token',
): MagicLinkVerifyResponse {
  return magicLinkVerifyResponseSchema.parse({ token, user });
}

/** POST /api/auth/otp/request success (enumeration-safe). */
export function emailOtpRequestedResponse(
  message = 'If an account exists for this email, a security code has been sent.',
): EmailOtpRequestResponse {
  return emailOtpRequestResponseSchema.parse({ message });
}

/** POST /api/auth/otp/verify success. */
export function emailOtpVerifiedResponse(
  user: User,
  token = 'mock-access-token',
  isNewUser = false,
): EmailOtpVerifyResponse {
  return emailOtpVerifyResponseSchema.parse({ token, user, isNewUser });
}

// ── Signed-in dashboard ───────────────────────────────────────────────────────
// A mocked login lands on the dashboard with a fake access token. Any dashboard
// call left to the real server answers 401, and the client's refresh-then-logout
// handling then signs the mocked user out mid-test. Specs that mock the login
// mock these too.

/** GET /api/notifications/list — an empty inbox. */
export function emptyNotificationsListResponse(): {
  readonly notifications: readonly never[];
  readonly unreadCount: 0;
} {
  return { notifications: [], unreadCount: 0 };
}

/** GET /api/users/me/profile-completeness — a complete profile. */
export function completeProfileCompletenessResponse(): ProfileCompletenessResponse {
  return profileCompletenessResponseSchema.parse({ percentage: 100, missingFields: [] });
}

/** GET /api/users/me/sessions — no other sessions to list. */
export function emptySessionsListResponse(): SessionsListResponse {
  return sessionsListResponseSchema.parse({ sessions: [] });
}

export function anonymousCapabilityContextResponse(
  authStrategies: readonly string[] = ['local'],
): SerializedCapabilityContext {
  return serializedCapabilityContextSchema.parse({
    modules: [],
    flags: {},
    entitlements: [],
    eligibility: {
      tosAccepted: false,
      emailVerified: false,
      ageVerifiedFor: null,
      jurisdiction: null,
    },
    viewer: null,
    actingAs: { kind: 'user' },
    maxAudience: 0,
    authStrategies: [...authStrategies],
  });
}

/**
 * GET /api/platform/context for the mocked user: the SPA refuses a context that
 * answers for another viewer, so it names the same user id.
 */
export function signedInCapabilityContextResponse(
  user: User,
  options?: { readonly authStrategies?: readonly string[] },
): SerializedCapabilityContext {
  return serializedCapabilityContextSchema.parse({
    modules: [],
    flags: {},
    entitlements: [],
    eligibility: {
      tosAccepted: true,
      emailVerified: true,
      ageVerifiedFor: null,
      jurisdiction: null,
    },
    viewer: { userId: user.id, role: user.role },
    actingAs: { kind: 'user' },
    maxAudience: 0,
    authStrategies: options?.authStrategies !== undefined ? [...options.authStrategies] : ['local'],
  });
}
