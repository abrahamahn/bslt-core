// main/server/core/src/auth/errors.ts
import { AUTH_ERROR_NAMES, ERROR_CODES, ERROR_MESSAGES, HTTP_STATUS } from '@bslt/shared/constants';
import {
  AppError,
  BadRequestError,
  ConflictError,
  TooManyRequestsError,
  AuthenticationError,
  UnavailableError,
} from '@bslt/shared/system';

export class InvalidCredentialsError extends AuthenticationError {
  constructor() {
    super(ERROR_MESSAGES.INVALID_CREDENTIALS, ERROR_CODES.INVALID_CREDENTIALS);
    this.name = AUTH_ERROR_NAMES.InvalidCredentialsError;
  }
}

export class WeakPasswordError extends BadRequestError {
  constructor(details?: Record<string, unknown>) {
    super(ERROR_MESSAGES.WEAK_PASSWORD, ERROR_CODES.WEAK_PASSWORD, details);
    this.name = AUTH_ERROR_NAMES.WeakPasswordError;
  }
}

export class AccountLockedError extends TooManyRequestsError {
  public readonly lockReason?: string;
  public readonly lockedUntil?: string;

  constructor(options?: {
    retryAfterMs?: number;
    lockReason?: string;
    lockedUntil?: string;
    details?: Record<string, unknown>;
  }) {
    const retryAfterMs = options?.retryAfterMs;
    const superOpts: { retryAfterMs?: number; details?: Record<string, unknown> } = {};
    if (retryAfterMs !== undefined) superOpts.retryAfterMs = retryAfterMs;
    if (options?.details !== undefined) superOpts.details = options.details;
    super(ERROR_MESSAGES.ACCOUNT_LOCKED, ERROR_CODES.ACCOUNT_LOCKED, superOpts);

    this.name = AUTH_ERROR_NAMES.AccountLockedError;
    if (options?.lockReason !== undefined) this.lockReason = options.lockReason;
    if (options?.lockedUntil !== undefined) this.lockedUntil = options.lockedUntil;
  }
}

export class EmailAlreadyExistsError extends ConflictError {
  constructor(message: string = ERROR_MESSAGES.EMAIL_ALREADY_REGISTERED) {
    super(message, ERROR_CODES.EMAIL_ALREADY_EXISTS);
    this.name = AUTH_ERROR_NAMES.EmailAlreadyExistsError;
  }
}

export class EmailNotVerifiedError extends AuthenticationError {
  constructor(
    public readonly email: string,
    message = ERROR_MESSAGES.EMAIL_NOT_VERIFIED,
  ) {
    super(message, ERROR_CODES.EMAIL_NOT_VERIFIED);
    this.name = AUTH_ERROR_NAMES.EmailNotVerifiedError;
  }

  public override toWire(isProduction: boolean) {
    const wire = super.toWire(isProduction);
    const details = wire.error.details ?? {};
    wire.error.details = { ...details, email: this.email };
    return wire;
  }
}

export class EmailSendError extends UnavailableError {
  public readonly originalError: Error | undefined;
  public override name = AUTH_ERROR_NAMES.EmailSendError;

  constructor(message: string = ERROR_MESSAGES.EMAIL_SEND_FAILED, originalError?: Error) {
    super(message, ERROR_CODES.EMAIL_SEND_FAILED, { retryAfterMs: 30_000 });
    this.originalError = originalError;
  }
}

export class InvalidTokenError extends AuthenticationError {
  constructor(message: string = ERROR_MESSAGES.INVALID_TOKEN) {
    super(message, ERROR_CODES.INVALID_TOKEN);
    this.name = AUTH_ERROR_NAMES.InvalidTokenError;
  }
}

export class TokenReuseError extends AppError {
  constructor(
    public readonly userId?: string,
    public readonly email?: string,
    public readonly familyId?: string,
    public readonly ipAddress?: string,
    public readonly userAgent?: string,
  ) {
    super('Token has already been used', {
      statusCode: HTTP_STATUS.UNAUTHORIZED,
      code: ERROR_CODES.TOKEN_REUSED,
      details: {
        ...(userId !== undefined ? { userId } : {}),
        ...(email !== undefined ? { email } : {}),
        ...(familyId !== undefined ? { familyId } : {}),
        ...(ipAddress !== undefined ? { ipAddress } : {}),
        ...(userAgent !== undefined ? { userAgent } : {}),
      },
      expose: false,
    });
    this.name = AUTH_ERROR_NAMES.TokenReuseError;
  }
}

// ============================================================================
// OAuth Errors
// ============================================================================

export class OAuthError extends AppError {
  constructor(
    message: string,
    public readonly provider: string,
    code: string = ERROR_CODES.OAUTH_ERROR,
  ) {
    super(message, {
      statusCode: HTTP_STATUS.BAD_REQUEST,
      code,
      details: { provider },
      expose: true,
    });
  }
}

export class OAuthStateMismatchError extends OAuthError {
  constructor(provider: string) {
    super(
      'OAuth state mismatch - possible CSRF attack',
      provider,
      ERROR_CODES.OAUTH_STATE_MISMATCH,
    );
  }
}

// ============================================================================
// 2FA Errors
// ============================================================================

export class TotpRequiredError extends AppError {
  constructor() {
    super('Two-factor authentication required', {
      statusCode: HTTP_STATUS.UNAUTHORIZED,
      code: ERROR_CODES.TOTP_REQUIRED,
      expose: true,
    });
  }
}

export class TotpInvalidError extends BadRequestError {
  constructor() {
    super('Invalid verification code', ERROR_CODES.TOTP_INVALID);
  }
}
