// main/apps/web/src/features/auth/services/authHelpers.ts
/**
 * Authentication state types, challenge errors, and session/device helpers.
 */

import { MS_PER_MINUTE } from '@bslt/shared/constants/time';

import type {
  LoginSuccessResponse,
  SmsLoginChallengeResponse,
  TotpLoginChallengeResponse,
  User,
} from '@bslt/api';

export interface TokenStore {
  get: () => string | null;
  set: (token: string) => void;
  clear: () => void;
}

// ============================================================================
// Types
// ============================================================================

export type AuthState = {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isNewDevice: boolean;
  impersonation: ImpersonationSession | null;
};

export type ImpersonationSession = {
  targetUserId: string;
  targetEmail: string;
  expiresAt: string;
};

/**
 * Error thrown when login requires TOTP verification.
 * Contains the challenge token that must be sent back with the TOTP code.
 *
 * @complexity O(1)
 */
export class TotpChallengeError extends Error {
  /** Challenge JWT token to send back with the TOTP code */
  readonly challengeToken: string;

  constructor(challengeToken: string) {
    super('Two-factor authentication required');
    this.name = 'TotpChallengeError';
    this.challengeToken = challengeToken;
  }
}

/**
 * Error thrown when login requires SMS verification.
 * Contains the challenge token that must be sent with the SMS code.
 */
export class SmsChallengeError extends Error {
  /** Challenge JWT token to send back with the SMS code */
  readonly challengeToken: string;

  constructor(challengeToken: string) {
    super('SMS verification required');
    this.name = 'SmsChallengeError';
    this.challengeToken = challengeToken;
  }
}

export type LoginResponse =
  LoginSuccessResponse | TotpLoginChallengeResponse | SmsLoginChallengeResponse;

export function isTotpChallengeResponse(
  response: LoginResponse,
): response is TotpLoginChallengeResponse {
  return 'requiresTotp' in response && response.requiresTotp;
}

export function isSmsChallengeResponse(
  response: LoginResponse,
): response is SmsLoginChallengeResponse {
  return 'requiresSms' in response && response.requiresSms;
}

// ============================================================================
// Constants & Helpers
// ============================================================================

// Maximum backoff delay for token refresh (5 minutes)
export const MAX_REFRESH_BACKOFF_MS = 5 * MS_PER_MINUTE;
export const REQUEST_TIMEOUT_MS = 5000;
export const INITIAL_SESSION_RESTORE_TIMEOUT_MS = 5000;
export const INITIAL_USER_HYDRATION_TIMEOUT_MS = 5000;
export const BROWSER_DEVICE_ID_STORAGE_KEY = 'bslt:browser-device-id';

export type InitializeHydrationResult =
  { status: 'hydrated'; user: User } | { status: 'failed' | 'stale' | 'timed-out' };

// Type guard for User
export const isUser = (value: unknown): value is User => {
  return (
    value !== null &&
    value !== undefined &&
    typeof value === 'object' &&
    'id' in value &&
    'email' in value &&
    'role' in value
  );
};

export const withTimeout = async <T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${String(timeoutMs)}ms`));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
  });

export const isTimeoutError = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('timed out');

export const normalizeUser = (user: User): User => ({
  ...user,
  firstName: typeof user.firstName === 'string' ? user.firstName : '',
  lastName: typeof user.lastName === 'string' ? user.lastName : '',
});

export function createBrowserDeviceId(): string {
  const cryptoObject = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (cryptoObject?.randomUUID !== undefined) {
    return cryptoObject.randomUUID();
  }

  const random = Math.random().toString(36).slice(2, 14);
  return `device-${Date.now().toString(36)}-${random}`;
}

export function isValidBrowserDeviceId(value: string): boolean {
  return /^[a-zA-Z0-9._:-]{16,128}$/.test(value);
}

export function getOrCreateBrowserDeviceId(): string | null {
  try {
    const storage = globalThis.localStorage;
    const existing = storage.getItem(BROWSER_DEVICE_ID_STORAGE_KEY);
    if (existing !== null && isValidBrowserDeviceId(existing)) {
      return existing;
    }

    const next = createBrowserDeviceId();
    storage.setItem(BROWSER_DEVICE_ID_STORAGE_KEY, next);
    return next;
  } catch {
    return null;
  }
}
