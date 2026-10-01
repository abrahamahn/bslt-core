// main/server/core/src/auth/utils/index.ts
export {
  AccountLockedError,
  EmailAlreadyExistsError,
  EmailNotVerifiedError,
  EmailSendError,
  InvalidCredentialsError,
  InvalidTokenError,
  OAuthError,
  OAuthStateMismatchError,
  TotpInvalidError,
  TotpRequiredError,
  WeakPasswordError,
} from '../errors';
export { UserNotFoundError } from '../../users/errors';
export {
  hashToken,
  generateSecureToken,
  generateBase64UrlToken,
  generateNumericCode,
} from './crypto';

export { setRefreshTokenCookie, clearRefreshTokenCookie } from './cookies';
export type { TokenPayload } from './jwt';
export { JwtError } from '@bslt/server-system/security';
export { createAccessToken, verifyToken, createRefreshToken, getRefreshTokenExpiry } from './jwt';
export {
  hashPassword,
  verifyPassword,
  needsRehash,
  initDummyHashPool,
  isDummyHashPoolInitialized,
  resetDummyHashPool,
  verifyPasswordSafe,
} from './password';
export {
  createRefreshTokenFamily,
  rotateRefreshToken,
  revokeTokenFamily,
  revokeAllUserTokens,
  cleanupExpiredTokens,
} from './refresh-token';
export type { AuthUser, AuthResponseData, AuthUserInput } from './response';
export { createAuthResponse, toAuthUser } from './response';
export { generateUniqueUsername, splitFullName } from './username';
