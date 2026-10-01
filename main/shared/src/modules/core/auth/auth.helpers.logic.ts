// main/shared/src/modules/core/auth/auth.helpers.logic.ts
/**
 * @file Auth Configuration Helpers
 * @description Pure utility functions that operate on AuthConfig.
 *   Single source of truth -- consumed by backend/core/auth and apps/server.
 * @module Core/Auth
 */

import { SECONDS_PER_DAY } from '../../../constants/time';

// ============================================================================
// Types
// ============================================================================

/** Minimal auth strategy type needed for helpers. */
export type AuthStrategy =
  | 'local'
  | 'magic'
  | 'webauthn'
  | 'google'
  | 'github'
  | 'kakao'
  | 'facebook'
  | 'microsoft'
  | 'apple';

export interface AuthCookieConfig {
  name: string;
  secret: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'strict' | 'lax' | 'none';
  path: string;
}

export interface AuthRefreshTokenConfig {
  expiryDays: number;
  gracePeriodSeconds: number;
}

/** Minimal auth config shape needed for helpers. */
export interface AuthConfig {
  strategies: readonly AuthStrategy[];
  cookie: AuthCookieConfig;
  refreshToken: AuthRefreshTokenConfig;
}

// ============================================================================
// Functions
// ============================================================================

/**
 * Gets refresh token cookie options based on auth config.
 *
 * @param config - Auth configuration
 * @returns Cookie options for the refresh token
 * @complexity O(1)
 */
export function getRefreshCookieOptions(
  config: AuthConfig,
  spanDays?: number,
): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'strict' | 'lax' | 'none';
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: config.cookie.httpOnly,
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite,
    path: config.cookie.path,
    // The cookie's life is the session's SPAN. When a login supplies one
    // (remember-me), it must win over the config default — otherwise the
    // browser holds a credential for a different duration than the server
    // honours, and the two disagree about the same session.
    maxAge: Math.round((spanDays ?? config.refreshToken.expiryDays) * SECONDS_PER_DAY),
  };
}

/**
 * Checks if a specific auth strategy is enabled.
 *
 * @param config - Auth configuration
 * @param strategy - The strategy to check
 * @returns True if the strategy is enabled
 * @complexity O(n) where n is the number of configured strategies (typically < 10)
 */
export function isStrategyEnabled(config: AuthConfig, strategy: AuthStrategy): boolean {
  return config.strategies.includes(strategy);
}
