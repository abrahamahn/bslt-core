// main/server/core/src/users/handlers/username.ts
/**
 * Username Update Handler
 *
 * Handles username change requests with cooldown enforcement,
 * reserved username checks, and uniqueness validation.
 *
 * @module handlers/username
 */

import { createHttpErrorResponse } from '@bslt/server-system/errors';
import {
  getNextUsernameChangeDate,
  isUsernameChangeCooldownActive,
  RESERVED_USERNAMES,
  type UpdateUsernameRequest,
  type UpdateUsernameResponse,
} from '@bslt/shared/core/users';
import { ConflictError, BadRequestError, NotFoundError } from '@bslt/shared/system';

import { record } from '../../audit/service';
import { CacheKeys } from '../cache';
import { ERROR_MESSAGES, type UsersModuleDeps, type UsersRequest } from '../types';

import type { HttpErrorResponse } from '@bslt/server-system/errors';
import type { RouteResult } from '@bslt/server-system/http';

// ============================================================================
// Handler
// ============================================================================

/**
 * Handle username update request.
 *
 * Validates the new username, checks cooldown period (30 days),
 * verifies uniqueness, and updates the user record.
 *
 * @param ctx - Handler context (narrowed to UsersModuleDeps)
 * @param body - Validated UpdateUsernameRequest
 * @param request - Authenticated request with user info
 * @returns 200 with new username and next change date, or error
 * @complexity O(1) - database lookups and single update
 */
export async function handleUpdateUsername(
  ctx: UsersModuleDeps,
  body: UpdateUsernameRequest,
  request: UsersRequest,
): Promise<HttpErrorResponse | RouteResult<UpdateUsernameResponse>> {
  if (request.user === undefined) {
    return createHttpErrorResponse(401, ERROR_MESSAGES.UNAUTHORIZED);
  }

  try {
    const userId = request.user.userId;
    const user = await ctx.repos.users.findById(userId);

    if (user === null) {
      return createHttpErrorResponse(404, ERROR_MESSAGES.USER_NOT_FOUND);
    }

    // Check cooldown period
    const lastChange = user.lastUsernameChange ?? null;
    if (isUsernameChangeCooldownActive(lastChange)) {
      const nextAllowed = getNextUsernameChangeDate(lastChange);
      return createHttpErrorResponse(
        429,
        `Username can only be changed once every 30 days. Next change allowed at ${nextAllowed.toISOString()}`,
      );
    }

    const newUsername = body.username;

    // Guard against runtime/module-boundary issues where constants may be undefined.
    const reservedUsernames = Array.isArray(RESERVED_USERNAMES)
      ? (RESERVED_USERNAMES as readonly string[])
      : (['admin', 'root', 'system'] as const);

    // Check reserved usernames
    if (reservedUsernames.includes(newUsername)) {
      return createHttpErrorResponse(400, 'This username is reserved');
    }

    // Check if same as current
    if (newUsername === user.username) {
      return createHttpErrorResponse(400, 'New username is the same as current username');
    }

    // Check uniqueness
    const existing = await ctx.repos.users.findByUsername(newUsername);
    if (existing !== null && existing.id !== userId) {
      return createHttpErrorResponse(409, 'Username is already taken');
    }

    // Update user with new username and track the change time
    const now = new Date();
    const updated = await ctx.repos.users.update(userId, {
      username: newUsername,
      lastUsernameChange: now,
    });

    if (updated === null || updated.username === null) {
      return createHttpErrorResponse(500, ERROR_MESSAGES.INTERNAL_ERROR);
    }

    if (ctx.cache !== undefined && typeof ctx.cache.delete === 'function') {
      await ctx.cache.delete(CacheKeys.user(userId)).catch((cacheError: unknown) => {
        const err = cacheError instanceof Error ? cacheError : new Error(String(cacheError));
        ctx.log.warn({ err }, 'Failed to invalidate user profile cache');
      });
    }

    const nextChangeDate = getNextUsernameChangeDate(now);
    const response: UpdateUsernameResponse = {
      username: updated.username,
      nextChangeAllowedAt: nextChangeDate.toISOString(),
    };

    // Fire-and-forget audit logging
    record(
      { auditEvents: ctx.repos.auditEvents },
      {
        actorId: userId,
        action: 'user.username_changed',
        resource: 'user',
        resourceId: userId,
        metadata: { oldUsername: user.username, newUsername: updated.username },
      },
    ).catch(() => {});


    return response;
  } catch (error) {
    if (error instanceof BadRequestError) {
      return createHttpErrorResponse(400, error.message);
    }
    if (error instanceof NotFoundError) {
      return createHttpErrorResponse(404, error.message);
    }
    if (error instanceof ConflictError) {
      return createHttpErrorResponse(409, error.message);
    }
    ctx.log.error(
      error instanceof Error ? error : new Error(String(error)),
      'Failed to update username',
    );
    return createHttpErrorResponse(500, ERROR_MESSAGES.INTERNAL_ERROR);
  }
}
