// main/server/core/src/users/handlers/profile.ts
/**
 * User Profile Handlers
 *
 * Thin HTTP layer for user profile operations.
 * Calls services and formats responses.
 *
 * @module handlers/profile
 */

import { createHttpErrorResponse } from '@bslt/server-system/errors';
import { HTTP_STATUS } from '@bslt/shared/constants';
import { userSchema, type User } from '@bslt/shared/core/users';

import { CacheKeys, CacheTags, CacheTTL } from '../cache';
import { getUserById } from '../service';
import { ERROR_MESSAGES, type UsersModuleDeps, type UsersRequest } from '../types';

import { resolveAvatarUrl } from './avatar';

import type { UserId } from '@bslt/shared/schema';
import type { CacheProvider } from '@bslt/shared/system';

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

function hasUserCache(cache: UsersModuleDeps['cache']): cache is CacheProvider {
  return (
    cache !== undefined &&
    typeof (cache as { get?: unknown }).get === 'function' &&
    typeof (cache as { set?: unknown }).set === 'function'
  );
}

// ============================================================================
// Handlers
// ============================================================================

/**
 * Get current authenticated user's profile.
 *
 * @param ctx - Handler context (narrowed to UsersModuleDeps)
 * @param request - Authenticated request with user info
 * @returns 200 with user data, or 401/404/500 error
 * @complexity O(1) - single database lookup
 */
export async function handleMe(ctx: UsersModuleDeps, request: UsersRequest): Promise<object> {
  // User is already verified by middleware
  if (request.user === undefined) {
    return createHttpErrorResponse(HTTP_STATUS.UNAUTHORIZED, ERROR_MESSAGES.UNAUTHORIZED);
  }

  try {
    const userId = request.user.userId;

    // Cache-aside: check cache first, fall back to DB
    const cacheKey = CacheKeys.user(userId);
    const cache = hasUserCache(ctx.cache) ? ctx.cache : undefined;
    const cached = cache !== undefined ? await cache.get<User>(cacheKey) : undefined;
    if (cached !== undefined) {
      const cachedUser = userSchema.safeParse(cached);
      if (cachedUser.success) {
        return cachedUser.data;
      }
    }

    const user = await getUserById(ctx.repos.users, userId);

    if (user === null) {
      return createHttpErrorResponse(HTTP_STATUS.NOT_FOUND, ERROR_MESSAGES.USER_NOT_FOUND);
    }

    const body: User = {
      id: user.id as UserId,
      email: user.email,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      avatarUrl: await resolveAvatarUrl(ctx.storage, user.avatarUrl),
      role: user.role,
      emailVerified: user.emailVerified,
      phone: user.phone ?? null,
      phoneVerified: user.phoneVerified,
      dateOfBirth: user.dateOfBirth ?? null,
      gender: user.gender ?? null,
      bio: user.bio ?? null,
      city: user.city ?? null,
      state: user.state ?? null,
      country: user.country ?? null,
      language: user.language ?? null,
      website: user.website ?? null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      deactivatedAt: user.deactivatedAt != null ? user.deactivatedAt.toISOString() : null,
      deletedAt: user.deletedAt != null ? user.deletedAt.toISOString() : null,
      deletionGracePeriodEnds:
        user.deletionGracePeriodEnds != null ? user.deletionGracePeriodEnds.toISOString() : null,
    };

    // Populate cache for subsequent requests
    if (cache !== undefined) {
      await cache.set(cacheKey, body, {
        ttl: CacheTTL.user,
        tags: [CacheTags.user(userId)],
      });
    }

    return body;
  } catch (error) {
    ctx.log.error(toError(error), 'Users operation failed');
    return createHttpErrorResponse(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      ERROR_MESSAGES.INTERNAL_ERROR,
    );
  }
}
