// main/server/core/src/auth/middleware.ts
/**
 * Authentication Middleware
 *
 * These functions are designed to be used as HTTP preHandler hooks.
 * They require the JWT secret to be passed when creating the guards.
 *
 * Uses a locally-defined authenticated request shape to avoid relying on
 * global module augmentation, which can be fragile across package boundaries.
 *
 * @module middleware
 */

import { AuthenticationError, ForbiddenError, extractBearerToken } from '@bslt/shared/system';

import { authenticateApiKey } from '../api-keys/service';

import { getLiveness, invalidateLiveness, setLiveness } from './liveness-cache';
import { verifyToken, type TokenPayload } from './utils/jwt';

import type { Repositories } from '@bslt/db/factory';
import type { HttpReply, HttpRequest } from '@bslt/server-system/http';

// ============================================================================
// Internal Types
// ============================================================================

/**
 * Request with an attached user payload.
 * The auth middleware sets this after verifying the JWT token.
 * Uses an intersection type so it's compatible with FastifyRequest.
 */
type AuthenticatedRequest = HttpRequest & {
  user?: TokenPayload;
};

function isRoleAllowed(actualRole: string, allowedRoles: string[]): boolean {
  if (allowedRoles.includes(actualRole)) return true;
  if (actualRole === 'admin') return true;
  if (actualRole === 'moderator' && allowedRoles.includes('user')) return true;
  return false;
}

// ============================================================================
// Token Extraction
// ============================================================================

/**
 * Extract and verify token from Authorization header.
 *
 * @param request - HTTP request object
 * @param secret - JWT signing secret
 * @returns Decoded token payload or null if invalid
 * @complexity O(1)
 */
export function extractTokenPayload(
  request: HttpRequest,
  secret: string,
  options?: { clockToleranceSeconds?: number },
): TokenPayload | null {
  const token = extractBearerToken(
    typeof request.headers['authorization'] === 'string'
      ? request.headers['authorization']
      : undefined,
  );
  if (token == null) return null;

  try {
    return verifyToken(token, secret, options);
  } catch {
    return null;
  }
}

/**
 * Resolve a request to an auth payload: first a JWT access token, then — when
 * repositories are available — a `bslt_` API key. API keys authenticate as their
 * owning user with that user's role, so all downstream role checks still apply.
 *
 * @complexity O(1) for JWT; one indexed hash lookup + user fetch for API keys.
 */
async function resolveAuthPayload(
  request: HttpRequest,
  secret: string,
  repos: Repositories | undefined,
): Promise<TokenPayload | null> {
  const jwtPayload = extractTokenPayload(request, secret);
  if (jwtPayload !== null) return jwtPayload;
  if (repos === undefined) return null;

  const token = extractBearerToken(
    typeof request.headers['authorization'] === 'string'
      ? request.headers['authorization']
      : undefined,
  );
  if (token == null) return null;

  const identity = await authenticateApiKey(token, repos);
  if (identity === null) return null;

  // The API-key lookup already fetched a fresh user row; seed the liveness
  // cache with it so livenessCheck() below never repeats the fetch.
  setLiveness(identity.userId, {
    tokenVersion: identity.tokenVersion,
    lockedUntil: identity.lockedUntil,
    lockReason: identity.lockReason,
  });
  return { userId: identity.userId, email: identity.email, role: identity.role };
}

// ============================================================================
// Auth Guards
// ============================================================================

/**
 * Create an authentication guard that requires a valid access token.
 * Performs a "Live Check" to ensure the user is not suspended/locked.
 *
 * @param secret - JWT signing secret
 * @param repos - Repositories for user lookup
 * @returns preHandler hook function
 * @complexity O(1)
 */
export function createRequireAuth(secret: string, repos?: Repositories) {
  return async (request: HttpRequest, _reply: HttpReply): Promise<void> => {
    const payload = await resolveAuthPayload(request, secret, repos);

    if (payload == null) {
      throw new AuthenticationError('Unauthorized');
    }

    // Live Check: ensure user is active/not suspended when repositories are provided.
    // Some test harnesses pass only a secret/roles guard factory signature.
    if (repos !== undefined) {
      await livenessCheck(repos, payload);
    }

    (request as AuthenticatedRequest).user = payload;
  };
}

/**
 * Live Check: ensure the user is active/not suspended and the token version is
 * current. Non-Forbidden failures (user missing, stale token version) are
 * normalized to a generic AuthenticationError.
 *
 * Reads go through the liveness TTL cache (see liveness-cache.ts) so the
 * users table is hit at most once per user per LIVENESS_TTL_MS per process.
 */
async function livenessCheck(repos: Repositories, payload: TokenPayload): Promise<void> {
  try {
    await assertUserActive(
      async (id) => {
        const cached = getLiveness(id);
        if (cached !== null) return cached;
        const user = await repos.users.findById(id);
        if (user !== null) {
          setLiveness(id, {
            tokenVersion: user.tokenVersion,
            lockedUntil: user.lockedUntil,
            lockReason: user.lockReason,
          });
        }
        return user;
      },
      payload.userId,
      async (id) => {
        invalidateLiveness(id);
        await repos.users.unlockAccount(id);
      },
      tokenVersionClaim(payload),
    );
  } catch (error) {
    if (error instanceof ForbiddenError) {
      throw error;
    }
    throw new AuthenticationError('Unauthorized');
  }
}

/**
 * Read the token's version claim so the live check can refuse tokens issued
 * before a version bump (password change / "log out everywhere").
 */
function tokenVersionClaim(payload: TokenPayload): number | undefined {
  return typeof payload['tokenVersion'] === 'number' ? payload['tokenVersion'] : undefined;
}

/**
 * Create a role-based authorization guard.
 *
 * @param secret - JWT signing secret
 * @param repos - Repositories for user lookup
 * @param allowedRoles - Roles permitted to access the endpoint
 * @returns Async preHandler hook function
 * @complexity O(n) where n is the number of allowed roles
 */
export function createRequireRole(
  secret: string,
  repos: Repositories | undefined,
  ...allowedRoles: string[]
) {
  return async (request: HttpRequest, _reply: HttpReply): Promise<void> => {
    const payload = await resolveAuthPayload(request, secret, repos);

    if (payload == null) {
      throw new AuthenticationError('Unauthorized');
    }

    // Live Check: ensure user is active/not suspended when repositories are provided.
    if (repos !== undefined) {
      await livenessCheck(repos, payload);
    }

    if (!isRoleAllowed(payload.role, allowedRoles)) {
      throw new ForbiddenError('Forbidden: insufficient permissions', 'ROLE_FORBIDDEN');
    }

    (request as AuthenticatedRequest).user = payload;
  };
}

/**
 * Check if user has admin role.
 *
 * @param request - HTTP request object
 * @returns True if user is an admin
 * @complexity O(1)
 */
export function isAdmin(request: HttpRequest): boolean {
  return (request as AuthenticatedRequest).user?.role === 'admin';
}

/** PreHandler hook type */
type AuthHandler = (request: HttpRequest, reply: HttpReply) => void | Promise<void>;

function isRepositories(value: Repositories | string | undefined): value is Repositories {
  return typeof value === 'object' && 'users' in value;
}

/**
 * Create a preHandler hook that requires authentication and specific roles.
 *
 * @param secret - JWT signing secret
 * @param allowedRoles - Roles permitted to access (empty = any authenticated)
 * @returns Fastify preHandler hook function
 * @complexity O(1)
 */
export function createAuthGuard(
  secret: string,
  reposOrFirstRole?: Repositories | string,
  ...allowedRolesOrRest: string[]
): AuthHandler {
  const hasRepos = isRepositories(reposOrFirstRole);
  const repos = hasRepos ? reposOrFirstRole : undefined;
  const allowedRoles = hasRepos
    ? allowedRolesOrRest
    : reposOrFirstRole === undefined
      ? allowedRolesOrRest
      : [reposOrFirstRole, ...allowedRolesOrRest];

  if (allowedRoles.length === 0) {
    return createRequireAuth(secret, repos);
  }
  return createRequireRole(secret, repos, ...allowedRoles);
}

// ============================================================================
// Active User Assertion
// ============================================================================

/**
 * Assert that a user account is active (not suspended/banned).
 * Call this in sensitive handlers (password change, TOTP, sudo, admin actions)
 * to prevent zombie access tokens from being used after account suspension.
 *
 * If the lock has expired (lockedUntil is in the past), the account is
 * auto-unlocked by clearing the lock fields via the provided unlock callback.
 *
 * @param getUserById - Repository function to look up user by ID
 * @param userId - The user ID to check
 * @param onAutoUnlock - Optional callback to clear expired lock fields in the database
 * @param expectedTokenVersion - Token's version claim; when provided, a mismatch with
 *   the user's current version means the token was revoked (password change /
 *   "log out everywhere") and the request is refused
 * @throws {AuthenticationError} If user not found or the token version is stale
 * @throws {ForbiddenError} If user account is suspended (lockedUntil in the future)
 */
export async function assertUserActive(
  getUserById: (id: string) => Promise<{
    lockedUntil: Date | null;
    lockReason: string | null;
    tokenVersion: number;
  } | null>,
  userId: string,
  onAutoUnlock?: (userId: string) => Promise<void>,
  expectedTokenVersion?: number,
): Promise<void> {
  const user = await getUserById(userId);
  if (user === null) {
    throw new AuthenticationError('User not found');
  }
  if (expectedTokenVersion !== undefined && expectedTokenVersion !== user.tokenVersion) {
    throw new AuthenticationError('Token revoked');
  }
  if (user.lockedUntil !== null) {
    if (user.lockedUntil > new Date()) {
      // Account is still locked -- include lock reason in the error message
      const reason = user.lockReason ?? 'Account suspended';
      throw new ForbiddenError(`Account locked: ${reason}`, 'ACCOUNT_SUSPENDED');
    }
    // Lock has expired -- auto-unlock
    if (onAutoUnlock !== undefined) {
      await onAutoUnlock(userId);
    }
  }
}
