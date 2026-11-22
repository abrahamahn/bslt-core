// main/modules/identity/server/guard.ts
/**
 * HTTP PreHandler Authentication & Role Guards + WebSocket Liveness Verifier
 *
 * Evaluates JWT access tokens and `bslt_` API keys, caches liveness state per
 * user with a short TTL (`LIVENESS_TTL_MS`), auto-unlocks expired lockouts, and
 * authorizes against live `users.role` rather than stale JWT claims.
 */
import { AuthenticationError, ForbiddenError } from '@bslt/server-system/errors';

import {
  getLiveness,
  invalidateLiveness,
  setLiveness,
  verifyToken,
  type LivenessRecord,
  type TokenPayload,
} from './crypto';
import { identityRepository, type DbQueryClient, type User } from './repository';
import { authenticateApiKey } from './service';

import type { UserRole } from '../contract';
import type { HttpReply, HttpRequest } from '@bslt/server-system/http';

export interface AuthGuardRepositories {
  readonly users: {
    findById(id: string): Promise<{
      readonly id: string;
      readonly email: string;
      readonly role: UserRole;
      readonly tokenVersion: number;
      readonly lockedUntil: Date | null;
      readonly lockReason: string | null;
      readonly emailVerified?: boolean | undefined;
    } | null>;
    unlockAccount(id: string): Promise<void>;
  };
  readonly db?: DbQueryClient | undefined;
}

type AuthenticatedRequest = HttpRequest & {
  user?: TokenPayload;
};

type AuthPreHandler = (request: HttpRequest, reply: HttpReply) => void | Promise<void>;

function extractBearerHeaderToken(header: string | undefined): string | null {
  if (header === undefined) return null;
  const match = /^Bearer\s+(\S+)$/iu.exec(header.trim());
  return match?.[1] ?? null;
}

function isRoleAllowed(actualRole: string, allowedRoles: readonly string[]): boolean {
  if (allowedRoles.includes(actualRole)) return true;
  if (actualRole === 'admin') return true;
  if (actualRole === 'moderator' && allowedRoles.includes('user')) return true;
  return false;
}

function extractJwtPayload(
  request: HttpRequest,
  secret: string,
  options?: { readonly clockToleranceSeconds?: number },
): TokenPayload | null {
  const rawAuth = request.headers['authorization'];
  const token = extractBearerHeaderToken(typeof rawAuth === 'string' ? rawAuth : undefined);
  if (token === null) return null;

  try {
    return verifyToken(token, secret, options);
  } catch {
    return null;
  }
}

async function resolveAuthPayload(
  request: HttpRequest,
  secret: string,
  repos: AuthGuardRepositories | undefined,
): Promise<TokenPayload | null> {
  const jwtPayload = extractJwtPayload(request, secret);
  if (jwtPayload !== null) return jwtPayload;
  if (repos === undefined || repos.db === undefined) return null;

  const rawAuth = request.headers['authorization'];
  const token = extractBearerHeaderToken(typeof rawAuth === 'string' ? rawAuth : undefined);
  if (token === null) return null;

  const apiKeyRepo = identityRepository(repos.db);
  const identity = await authenticateApiKey(token, {
    findAuthRecordByTokenHash: (hash) => apiKeyRepo.findApiKeyAuthByTokenHash(hash),
    touchLastUsed: (id) => apiKeyRepo.touchApiKeyLastUsed(id),
    findUserById: (id) => repos.users.findById(id),
  });
  if (identity === null) return null;

  setLiveness(identity.userId, {
    tokenVersion: identity.tokenVersion,
    lockedUntil: identity.lockedUntil,
    lockReason: identity.lockReason,
    role: identity.role,
    ...(identity.emailVerified !== undefined ? { emailVerified: identity.emailVerified } : {}),
  });
  return { userId: identity.userId, email: identity.email, role: identity.role };
}

async function loadLiveness(
  repos: AuthGuardRepositories,
  id: string,
): Promise<LivenessRecord | null> {
  const user = await repos.users.findById(id);
  if (user === null) return null;
  const record: LivenessRecord = {
    tokenVersion: user.tokenVersion,
    lockedUntil: user.lockedUntil,
    lockReason: user.lockReason,
    role: user.role,
    ...(user.emailVerified !== undefined ? { emailVerified: user.emailVerified } : {}),
  };
  setLiveness(id, record);
  return record;
}

function tokenVersionClaim(payload: TokenPayload): number | undefined {
  return typeof payload['tokenVersion'] === 'number' ? payload['tokenVersion'] : undefined;
}

async function livenessCheck(repos: AuthGuardRepositories, payload: TokenPayload): Promise<string> {
  let role: string = payload.role;
  try {
    await assertUserActive(
      async (id) => {
        const cached = getLiveness(id) ?? (await loadLiveness(repos, id));
        if (cached !== null) role = cached.role;
        return cached;
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
  return role;
}

export function createRequireAuth(
  secret: string,
  repos?: AuthGuardRepositories,
): (request: HttpRequest, reply: HttpReply) => Promise<void> {
  return async (request: HttpRequest, _reply: HttpReply): Promise<void> => {
    const payload = await resolveAuthPayload(request, secret, repos);
    if (payload === null) {
      throw new AuthenticationError('Unauthorized');
    }

    if (repos !== undefined) {
      await livenessCheck(repos, payload);
    }

    (request as AuthenticatedRequest).user = payload;
  };
}

export function createRequireRole(
  secret: string,
  repos: AuthGuardRepositories | undefined,
  ...allowedRoles: string[]
): (request: HttpRequest, reply: HttpReply) => Promise<void> {
  return async (request: HttpRequest, _reply: HttpReply): Promise<void> => {
    const payload = await resolveAuthPayload(request, secret, repos);
    if (payload === null) {
      throw new AuthenticationError('Unauthorized');
    }

    const role = repos !== undefined ? await livenessCheck(repos, payload) : payload.role;
    if (!isRoleAllowed(role, allowedRoles)) {
      throw new ForbiddenError('Forbidden: insufficient permissions', 'ROLE_FORBIDDEN');
    }

    (request as AuthenticatedRequest).user = payload;
  };
}

export function authGuardReposFromDb(db: DbQueryClient): {
  readonly users: {
    findById(id: string): Promise<User | null>;
    unlockAccount(id: string): Promise<void>;
  };
  readonly db: DbQueryClient;
} {
  const repo = identityRepository(db);
  return {
    users: {
      findById: (id) => repo.findUserById(id),
      unlockAccount: (id) => repo.unlockUserAccount(id),
    },
    db,
  };
}

function normalizeGuardRepos(
  value: AuthGuardRepositories | DbQueryClient | string | undefined,
): AuthGuardRepositories | undefined {
  if (value === undefined || typeof value === 'string') return undefined;
  if ('users' in value) return value;
  if ('query' in value && 'queryOne' in value) return authGuardReposFromDb(value);
  return undefined;
}

export function createAuthGuard(
  secret: string,
  reposOrFirstRole?: AuthGuardRepositories | DbQueryClient | string,
  ...allowedRolesOrRest: string[]
): AuthPreHandler {
  const repos = normalizeGuardRepos(reposOrFirstRole);
  const allowedRoles =
    repos !== undefined
      ? allowedRolesOrRest
      : typeof reposOrFirstRole === 'string'
        ? [reposOrFirstRole, ...allowedRolesOrRest]
        : allowedRolesOrRest;

  if (allowedRoles.length === 0) {
    return createRequireAuth(secret, repos);
  }
  return createRequireRole(secret, repos, ...allowedRoles);
}

export async function assertUserActive(
  getUserById: (id: string) => Promise<{
    readonly lockedUntil: Date | null;
    readonly lockReason: string | null;
    readonly tokenVersion: number;
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
      const reason = user.lockReason ?? 'Account suspended';
      throw new ForbiddenError(`Account locked: ${reason}`, 'ACCOUNT_SUSPENDED');
    }
    if (onAutoUnlock !== undefined) {
      await onAutoUnlock(userId);
    }
  }
}
