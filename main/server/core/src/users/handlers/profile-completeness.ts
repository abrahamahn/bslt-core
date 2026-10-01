// main/server/core/src/users/handlers/profile-completeness.ts
/**
 * Profile Completeness Handler
 *
 * Computes profile completeness percentage and identifies missing fields.
 *
 * @module handlers/profile-completeness
 */

import { createHttpErrorResponse } from '@bslt/server-system/errors';
import {
  PROFILE_COMPLETENESS_FIELDS,
  type ProfileCompletenessResponse,
} from '@bslt/shared/core/users';

import { getUserById } from '../service';
import { ERROR_MESSAGES, type UsersModuleDeps, type UsersRequest } from '../types';

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

// ============================================================================
// Pure Function
// ============================================================================

/**
 * Compute profile completeness from a user object.
 *
 * Checks a fixed set of profile fields (firstName, lastName, avatarUrl,
 * bio, city, state, country, language, website, phone) and returns the
 * percentage of filled fields and the list of missing field names.
 *
 * @param user - User object with profile fields (values may be string or null)
 * @returns Object with percentage (0-100) and missingFields array
 * @complexity O(n) where n = number of checked fields (constant ~10)
 */
export function computeProfileCompleteness(user: object): ProfileCompletenessResponse {
  const missingFields: string[] = [];
  const record = user as Record<string, unknown>;

  for (const field of PROFILE_COMPLETENESS_FIELDS) {
    const value = record[field];
    if (value === null || value === undefined || value === '') {
      missingFields.push(field);
    }
  }

  const totalFields = PROFILE_COMPLETENESS_FIELDS.length;
  const filledFields = totalFields - missingFields.length;
  const percentage = Math.round((filledFields / totalFields) * 100);

  return { percentage, missingFields };
}

// ============================================================================
// Handler
// ============================================================================

/**
 * Get profile completeness for the authenticated user.
 *
 * @param ctx - Handler context (narrowed to UsersModuleDeps)
 * @param request - Authenticated request with user info
 * @returns 200 with completeness data, or 401/404/500 error
 * @complexity O(1) - single database lookup + field counting
 */
export async function handleGetProfileCompleteness(
  ctx: UsersModuleDeps,
  request: UsersRequest,
): Promise<object> {
  if (request.user === undefined) {
    return createHttpErrorResponse(401, ERROR_MESSAGES.UNAUTHORIZED);
  }

  try {
    const user = await getUserById(ctx.repos.users, request.user.userId);

    if (user === null) {
      return createHttpErrorResponse(404, ERROR_MESSAGES.USER_NOT_FOUND);
    }

    const completeness = computeProfileCompleteness(user);

    return completeness;
  } catch (error) {
    ctx.log.error(toError(error), 'Failed to compute profile completeness');
    return createHttpErrorResponse(500, ERROR_MESSAGES.INTERNAL_ERROR);
  }
}
