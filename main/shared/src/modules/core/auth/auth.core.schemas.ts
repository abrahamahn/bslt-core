// main/shared/src/modules/core/auth/auth.core.schemas.ts
/**
 * @file Auth Core Schemas
 * @description Core authentication request/response schemas for login, register,
 *   password reset, sudo mode, and related flows.
 * @module Core/Auth
 */

import {
  createEnumSchema,
  createLiteralSchema,
  createSchema,
  parseBoolean,
  parseString,
} from '../../../schema';
import { emailSchema, passwordSchema } from '../schemas';
import { userSchema } from '../users/users.schemas';

import type { Schema } from '../../../schema';
import type { User } from '../users/users.schemas';

// ============================================================================
// Types
// ============================================================================

export interface LoginRequest {
  identifier: string;
  password: string;
  captchaToken?: string;
  /**
   * "Keep me signed in". Decides the session SPAN — the refresh cookie's
   * lifetime and the token family's expiry — and, through it, how long the
   * session may sit idle. Absent is the safe default (a half-day session).
   */
  rememberMe?: boolean;
}

export interface RegisterRequest {
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  password: string;
  tosAccepted: boolean;
  /**
   * Explicit confirmation of SIGNUP_ATTESTATION_STATEMENT (old enough to consent,
   * meets jurisdiction requirements, accepts the Terms). Required: the server
   * refuses to create an account without it.
   */
  eligibilityAttested: boolean;
  captchaToken?: string;
}

export interface ForgotPasswordRequest {
  email: string;
  captchaToken?: string;
}

export interface ResetPasswordRequest {
  token: string;
  password: string;
}

export interface SetPasswordRequest {
  password: string;
}

export interface ResetPasswordResponse {
  message: string;
}

export interface SetPasswordResponse {
  message: string;
}

export interface SudoRequest {
  password?: string;
  totpCode?: string;
}

export interface SudoResponse {
  sudoToken: string;
  expiresAt: string;
}

export interface AuthResponse {
  token: string;
  user: User;
  isNewDevice?: boolean;
}

export interface RegisterResponse {
  /**
   * `pending_verification` (default): user must click the emailed link.
   * `verified`: demo auto-verify is on — the account is already verified and the
   * client should auto-log-in. Optional so older/consumers tolerate its absence.
   */
  status?: 'pending_verification' | 'verified';
  message: string;
  email: string;
}

export interface RefreshResponse {
  token: string;
}

export interface LogoutResponse {
  message: string;
}

export interface ForgotPasswordResponse {
  message: string;
}

export interface BffLoginResponse {
  user: User;
  isNewDevice?: boolean;
}

export type LoginSuccessResponse = BffLoginResponse;

// ============================================================================
// Constants
// ============================================================================

export const pendingVerificationLiteral = createLiteralSchema('pending_verification' as const);

export const registerStatusSchema = createEnumSchema(
  ['pending_verification', 'verified'] as const,
  'register status',
);

// ============================================================================
// Request Schemas
// ============================================================================

export const loginRequestSchema: Schema<LoginRequest> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  return {
    identifier: parseString(obj['identifier'], 'identifier', { min: 1, trim: true }),
    password: passwordSchema.parse(obj['password']),
    ...(typeof obj['captchaToken'] === 'string' ? { captchaToken: obj['captchaToken'] } : {}),
    ...(typeof obj['rememberMe'] === 'boolean' ? { rememberMe: obj['rememberMe'] } : {}),
  };
});

export const registerRequestSchema: Schema<RegisterRequest> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  return {
    email: emailSchema.parse(obj['email']),
    username: parseString(obj['username'], 'username', { min: 2, trim: true }),
    firstName: parseString(obj['firstName'], 'first name', { min: 1, trim: true }),
    lastName: parseString(obj['lastName'], 'last name', { min: 1, trim: true }),
    password: passwordSchema.parse(obj['password']),
    tosAccepted: parseBoolean(obj['tosAccepted'], 'tosAccepted'),
    eligibilityAttested: parseBoolean(obj['eligibilityAttested'], 'eligibilityAttested'),
    ...(typeof obj['captchaToken'] === 'string' ? { captchaToken: obj['captchaToken'] } : {}),
  };
});

export const forgotPasswordRequestSchema: Schema<ForgotPasswordRequest> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
      email: emailSchema.parse(obj['email']),
      ...(typeof obj['captchaToken'] === 'string' ? { captchaToken: obj['captchaToken'] } : {}),
    };
  },
);

export const resetPasswordRequestSchema: Schema<ResetPasswordRequest> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
      token: parseString(obj['token'], 'token', { min: 1 }),
      password: passwordSchema.parse(obj['password']),
    };
  },
);

export const setPasswordRequestSchema: Schema<SetPasswordRequest> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return { password: passwordSchema.parse(obj['password']) };
  },
);

export const sudoRequestSchema: Schema<SudoRequest> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const password = typeof obj['password'] === 'string' ? obj['password'] : undefined;
  const totpCode = typeof obj['totpCode'] === 'string' ? obj['totpCode'] : undefined;
  if (password === undefined && totpCode === undefined) {
    throw new Error('Either password or totpCode is required');
  }
  return {
    ...(password !== undefined ? { password } : {}),
    ...(totpCode !== undefined ? { totpCode } : {}),
  };
});

export const sudoResponseSchema: Schema<SudoResponse> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  return {
    sudoToken: parseString(obj['sudoToken'], 'sudoToken'),
    expiresAt: parseString(obj['expiresAt'], 'expiresAt'),
  };
});

// ============================================================================
// Response Schemas
// ============================================================================

export const authResponseSchema: Schema<AuthResponse> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  return {
    token: parseString(obj['token'], 'token'),
    user: userSchema.parse(obj['user']),
    ...(typeof obj['isNewDevice'] === 'boolean' ? { isNewDevice: obj['isNewDevice'] } : {}),
  };
});

export const bffLoginResponseSchema: Schema<BffLoginResponse> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  if (obj['token'] !== undefined || obj['accessToken'] !== undefined) {
    throw new Error('BFF login response must not include token fields');
  }
  return {
    user: userSchema.parse(obj['user']),
    ...(typeof obj['isNewDevice'] === 'boolean'
      ? { isNewDevice: parseBoolean(obj['isNewDevice'], 'isNewDevice') }
      : {}),
  };
});

export const loginSuccessResponseSchema: Schema<LoginSuccessResponse> = createSchema(
  (data: unknown) => {
    const bff = bffLoginResponseSchema.safeParse(data);
    if (bff.success) {
      return bff.data;
    }

    throw new Error('Invalid login success response');
  },
);

export const registerResponseSchema: Schema<RegisterResponse> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const rawStatus = obj['status'];
  return {
    ...(rawStatus !== undefined ? { status: registerStatusSchema.parse(rawStatus) } : {}),
    message: parseString(obj['message'], 'message'),
    email: emailSchema.parse(obj['email']),
  };
});

export const logoutResponseSchema: Schema<LogoutResponse> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  return { message: parseString(obj['message'], 'message') };
});

export const forgotPasswordResponseSchema: Schema<ForgotPasswordResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return { message: parseString(obj['message'], 'message') };
  },
);

export const refreshResponseSchema: Schema<RefreshResponse> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  return { token: parseString(obj['token'], 'token') };
});

export const resetPasswordResponseSchema: Schema<ResetPasswordResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return { message: parseString(obj['message'], 'message') };
  },
);

export const setPasswordResponseSchema: Schema<SetPasswordResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return { message: parseString(obj['message'], 'message') };
  },
);

// ============================================================================
// Functions
// ============================================================================

/**
 * Type guard to check if a request context has an authenticated user.
 *
 * Validates that `req.user` is a non-null object with a non-empty `userId` string.
 * Narrows the type so callers can access `req.user.userId`, `req.user.email`, etc.
 */
export function isAuthenticatedRequest<T extends { readonly user?: unknown }>(
  req: T,
): req is T & {
  readonly user: { readonly userId: string; readonly email: string; readonly role: string };
} {
  if (req.user === undefined || typeof req.user !== 'object') {
    return false;
  }
  const user = req.user as unknown as Record<string, unknown>;
  return 'userId' in user && typeof user['userId'] === 'string' && user['userId'] !== '';
}
