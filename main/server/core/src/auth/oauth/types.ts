// main/server/core/src/auth/oauth/types.ts
/**
 * OAuth Types
 *
 * Shared type definitions for OAuth authentication flows.
 *
 * @module oauth/types
 */

import type { OAuthProvider } from '@bslt/db/schema';

// Re-export OAuthProvider for convenience
export type { OAuthProvider };

// ============================================================================
// OAuth User Info
// ============================================================================

/**
 * User information returned from OAuth provider.
 */
export interface OAuthUserInfo {
  /** Provider-specific user ID */
  id: string;
  /** User's email address */
  email: string;
  /** User's display name */
  name: string | null;
  /** Whether the email is verified by the provider */
  emailVerified: boolean;
  /** URL to user's profile picture */
  picture?: string;
}

// ============================================================================
// OAuth Token Response
// ============================================================================

/**
 * Token response from OAuth provider.
 */
export interface OAuthTokenResponse {
  /** Access token for API calls */
  accessToken: string;
  /** Refresh token for refreshing access (if available) */
  refreshToken?: string | undefined;
  /** Token expiry timestamp */
  expiresAt?: Date | undefined;
  /** Token type (usually 'Bearer') */
  tokenType: string;
  /** Scopes granted */
  scope?: string | undefined;
  /** OIDC id_token, when the provider issues one (required for Apple) */
  idToken?: string | undefined;
}

// ============================================================================
// OAuth Provider Interface
// ============================================================================

/**
 * OAuth provider configuration and methods.
 */
export interface OAuthProviderClient {
  /** Provider name */
  provider: OAuthProvider;

  /**
   * Generate authorization URL for the OAuth flow.
   *
   * @param state - CSRF protection state parameter
   * @param redirectUri - Callback URL after authorization
   * @returns Full authorization URL
   */
  getAuthorizationUrl(state: string, redirectUri: string): string;

  /**
   * Exchange authorization code for tokens.
   *
   * @param code - Authorization code from callback
   * @param redirectUri - Callback URL (must match getAuthorizationUrl)
   * @returns Token response
   */
  exchangeCode(code: string, redirectUri: string): Promise<OAuthTokenResponse>;

  /**
   * Get user information from the provider.
   *
   * @param accessToken - Valid access token
   * @returns User info from provider
   */
  getUserInfo(accessToken: string): Promise<OAuthUserInfo>;
}

// ============================================================================
// OAuth State
// ============================================================================

/**
 * OAuth state stored in session/cookie.
 */
export interface OAuthState {
  /** CSRF protection random value */
  state: string;
  /** Original redirect URI */
  redirectUri: string;
  /** Provider being used */
  provider: OAuthProvider;
  /** Whether this is a link operation (vs login/register) */
  isLinking: boolean;
  /** User ID if linking to existing account */
  userId?: string | undefined;
  /**
   * Confirmation of the signup eligibility statement, sealed in at initiate
   * time (`?attested=true` from the sign-up surface). Required at the callback
   * if — and only if — that callback would create an account. Tamper-proof:
   * the whole state is AES-256-GCM encrypted with the cookie secret.
   */
  eligibilityAttested?: boolean | undefined;
  /**
   * Consent to the published signup agreements, sealed in at initiate time
   * (`?consented=true` from the sign-up surface). Same trust model as
   * `eligibilityAttested`: required at the callback only when that callback
   * would create an account, and tamper-proof inside the encrypted state.
   */
  tosAccepted?: boolean | undefined;
  /** Timestamp for expiry check */
  createdAt: number;
}

// ============================================================================
// OAuth Connection Info (for API responses)
// ============================================================================

/**
 * OAuth connection info returned to clients (without sensitive tokens).
 */
export interface OAuthConnectionInfo {
  /** Connection ID */
  id: string;
  /** Provider name */
  provider: OAuthProvider;
  /** Email from provider */
  providerEmail: string | null;
  /** When connection was created */
  connectedAt: Date;
}
