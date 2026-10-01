// main/server/core/src/users/handlers/account.ts
/**
 * Account Handlers
 *
 * Business logic and HTTP handlers for user profile updates and
 * password changes.
 *
 * @module handlers/account
 */

import { createHttpErrorResponse } from '@bslt/server-system/errors';
import { requireAuthenticatedUser } from '@bslt/server-system/http';
import { validatePassword } from '@bslt/shared/core/auth';
import { type User } from '@bslt/shared/core/users';
import { BadRequestError, NotFoundError } from '@bslt/shared/system';

import { record } from '../../audit/service';
import { hashPassword, revokeAllUserTokens, verifyPassword } from '../../auth';
import { WeakPasswordError } from '../../auth/errors';
import { notifyAdmins } from '../../notifications/admin-alerts';
import { CacheKeys } from '../cache';
import { getUserById, type User as DomainUser } from '../service';
import { ERROR_MESSAGES } from '../types';

import { resolveAvatarUrl } from './avatar';

import type { UsersAuthConfig, UsersModuleDeps, UsersRequest } from '../types';
import type { DbClient } from '@bslt/db/client';
import type { Repositories } from '@bslt/db/factory';
import type { HttpRequest, RouteResult } from '@bslt/server-system/http';

type UsersHttpRequest = UsersRequest & HttpRequest;

/**
 * User profile domain object.
 * Contains publicly safe user fields.
 */
export type ProfileUser = User;

/**
 * Data for updating a user's profile.
 * Only includes fields that users can self-update.
 * All fields are optional — omitted fields remain unchanged.
 * Nullable fields can be set to null to clear them.
 */
export interface UpdateProfileData {
  /** New username — pass null to clear */
  username?: string | null;
  /** New first name */
  firstName?: string;
  /** New last name */
  lastName?: string;
  /** Phone number (nullable) */
  phone?: string | null;
  /** Date of birth as ISO date string (nullable) */
  dateOfBirth?: string | null;
  /** Gender (nullable) */
  gender?: string | null;
  /** Bio/about text (nullable) */
  bio?: string | null;
  /** City (nullable) */
  city?: string | null;
  /** State/province (nullable) */
  state?: string | null;
  /** Country (nullable) */
  country?: string | null;
  /** Preferred language (nullable) */
  language?: string | null;
  /** Website URL (nullable) */
  website?: string | null;
}

// ============================================================================

function toProfileUser(user: DomainUser): ProfileUser {
  return {
    id: user.id as User['id'],
    email: user.email,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    avatarUrl: user.avatarUrl,
    role: user.role,
    emailVerified: user.emailVerified,
    phone: user.phone,
    phoneVerified: user.phoneVerified,
    dateOfBirth: user.dateOfBirth,
    gender: user.gender,
    bio: user.bio,
    city: user.city,
    state: user.state,
    country: user.country,
    language: user.language,
    website: user.website,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    deactivatedAt: user.deactivatedAt != null ? user.deactivatedAt.toISOString() : null,
    deletedAt: user.deletedAt != null ? user.deletedAt.toISOString() : null,
    deletionGracePeriodEnds:
      user.deletionGracePeriodEnds != null ? user.deletionGracePeriodEnds.toISOString() : null,
  };
}

async function getUpdatedProfileUser(repos: Repositories, userId: string): Promise<ProfileUser> {
  const updatedUser = await getUserById(repos.users, userId);
  if (updatedUser === null) {
    throw new NotFoundError('User not found');
  }
  return toProfileUser(updatedUser);
}

// ============================================================================
// Profile Update
// ============================================================================

/**
 * Update user profile information.
 *
 * @param repos - Repository container
 * @param userId - ID of the user to update
 * @param data - Profile fields to update
 * @returns Updated profile user object
 * @throws NotFoundError if user not found
 * @throws Error if database update fails
 * @complexity O(1) - single database lookup and update
 */
export async function updateProfile(
  repos: Repositories,
  userId: string,
  data: UpdateProfileData,
): Promise<ProfileUser> {
  const user = await repos.users.findById(userId);

  if (user === null) {
    throw new NotFoundError('User not found');
  }

  // Build update payload from provided fields
  const updatePayload: Record<string, unknown> = {};
  if ('username' in data) {
    // Check username uniqueness if changing to a non-null value
    if (data.username !== null && data.username !== user.username) {
      const existing = await repos.users.findByUsername(data.username);
      if (existing !== null && existing.id !== userId) {
        throw new BadRequestError('Username is already taken', 'USERNAME_TAKEN');
      }
    }
    updatePayload['username'] = data.username;
  }
  if ('firstName' in data) updatePayload['firstName'] = data.firstName;
  if ('lastName' in data) updatePayload['lastName'] = data.lastName;
  if ('phone' in data) updatePayload['phone'] = data.phone;
  if ('dateOfBirth' in data) updatePayload['dateOfBirth'] = data.dateOfBirth;
  if ('gender' in data) updatePayload['gender'] = data.gender;
  if ('bio' in data) updatePayload['bio'] = data.bio;
  if ('city' in data) updatePayload['city'] = data.city;
  if ('state' in data) updatePayload['state'] = data.state;
  if ('country' in data) updatePayload['country'] = data.country;
  if ('language' in data) updatePayload['language'] = data.language;
  if ('website' in data) updatePayload['website'] = data.website;

  // Only update if there are changes
  if (Object.keys(updatePayload).length > 0) {
    const updated = await repos.users.update(userId, updatePayload);
    if (updated === null) {
      throw new Error('Failed to update user profile');
    }

    // Fire-and-forget audit logging
    record(
      { auditEvents: repos.auditEvents },
      {
        actorId: userId,
        action: 'user.profile_updated',
        resource: 'user',
        resourceId: userId,
        metadata: { fields: Object.keys(updatePayload) },
      },
    ).catch(() => {});


    return getUpdatedProfileUser(repos, userId);
  }

  return getUpdatedProfileUser(repos, userId);
}

// ============================================================================
// Password Change
// ============================================================================

/**
 * Change user password.
 * Verifies current password and updates to new password.
 *
 * @param repos - Repository container
 * @param authConfig - Auth configuration with argon2 settings
 * @param userId - ID of the user changing their password
 * @param currentPassword - User's current password for verification
 * @param newPassword - New password to set
 * @throws NotFoundError if user not found
 * @throws BadRequestError if current password is incorrect or account has no password
 * @throws WeakPasswordError if new password does not meet strength requirements
 * @complexity O(1) - single database lookup, password hash, and update
 */
export async function changePassword(
  db: DbClient,
  repos: Repositories,
  authConfig: UsersAuthConfig,
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await repos.users.findById(userId);

  if (user === null) {
    throw new NotFoundError('User not found');
  }

  // Check if user has a password (not OAuth/magic-link only)
  if (user.passwordHash.startsWith('oauth:') || user.passwordHash.startsWith('magiclink:')) {
    throw new BadRequestError(
      'Cannot change password for accounts without a password. Please use "Set Password" instead.',
    );
  }

  // Verify current password
  const isValid = await verifyPassword(currentPassword, user.passwordHash);
  if (!isValid) {
    throw new BadRequestError('Current password is incorrect', 'INVALID_PASSWORD');
  }

  // Validate new password strength against user's personal info
  const passwordValidation = validatePassword(
    newPassword,
    [user.email, user.username, user.firstName, user.lastName].filter(
      (s): s is string => s !== null,
    ),
  );
  if (!passwordValidation.isValid) {
    throw new WeakPasswordError({ errors: passwordValidation.errors });
  }

  // Hash and update
  const newHash = await hashPassword(newPassword, authConfig.argon2);
  await repos.users.update(userId, { passwordHash: newHash });
  await revokeAllUserTokens(db, userId);

  // Fire-and-forget audit logging
  record(
    { auditEvents: repos.auditEvents },
    {
      actorId: userId,
      action: 'user.password_changed',
      resource: 'user',
      resourceId: userId,
      severity: 'warn',
      category: 'security',
    },
  ).catch(() => {});

  // Fire-and-forget: alert admins/moderators of the password change
  void notifyAdmins(
    { repos },
    {
      type: 'password_changed',
      subject: { userId, email: user.email, username: user.username },
    },
  );
}

// ============================================================================
// Profile & Password HTTP Handlers
// ============================================================================

/** Body shape for password change HTTP handler. */
interface ChangePasswordBody {
  currentPassword: string;
  newPassword: string;
}

/**
 * Handle profile update.
 *
 * PATCH /api/users/me/update
 *
 * @param ctx - Handler context (narrowed to UsersModuleDeps)
 * @param body - Validated UpdateProfileRequest
 * @param req - Fastify request with authenticated user
 * @returns 200 with updated profile, or error response
 * @complexity O(1) - database lookup + update
 */
export async function handleUpdateProfile(
  ctx: UsersModuleDeps,
  body: UpdateProfileData,
  req: UsersHttpRequest,
): Promise<RouteResult> {
  const user = requireAuthenticatedUser(req);

  try {
    const result = await updateProfile(ctx.repos, user.userId, body);
    if (ctx.cache !== undefined && typeof ctx.cache.delete === 'function') {
      await ctx.cache.delete(CacheKeys.user(user.userId)).catch((cacheError: unknown) => {
        const err = cacheError instanceof Error ? cacheError : new Error(String(cacheError));
        ctx.log.warn({ err }, 'Failed to invalidate user profile cache');
      });
    }
    return {
      ...result,
      avatarUrl: await resolveAvatarUrl(ctx.storage, result.avatarUrl),
    };
  } catch (error) {
    if (error instanceof BadRequestError) {
      return createHttpErrorResponse(400, error.message);
    }
    if (error instanceof NotFoundError) {
      return createHttpErrorResponse(404, error.message);
    }
    ctx.log.error(
      error instanceof Error ? error : new Error(String(error)),
      'Failed to update profile',
    );
    return createHttpErrorResponse(500, ERROR_MESSAGES.INTERNAL_ERROR);
  }
}

/**
 * Handle password change.
 *
 * POST /api/users/me/password
 *
 * @param ctx - Handler context (narrowed to UsersModuleDeps)
 * @param body - Validated ChangePasswordRequest
 * @param req - Fastify request with authenticated user
 * @returns 200 on success, or error response
 * @complexity O(1) - password verification + hash + update
 */
export async function handleChangePassword(
  ctx: UsersModuleDeps,
  body: ChangePasswordBody,
  req: UsersHttpRequest,
): Promise<RouteResult> {
  const user = requireAuthenticatedUser(req);

  try {
    await changePassword(
      ctx.db,
      ctx.repos,
      ctx.config.auth,
      user.userId,
      body.currentPassword,
      body.newPassword,
    );
    return { success: true, message: 'Password changed successfully' };
  } catch (error) {
    if (error instanceof BadRequestError) {
      return createHttpErrorResponse(400, error.message);
    }
    if (error instanceof NotFoundError) {
      return createHttpErrorResponse(404, error.message);
    }
    if (error instanceof WeakPasswordError) {
      return createHttpErrorResponse(400, error.message);
    }
    ctx.log.error(
      error instanceof Error ? error : new Error(String(error)),
      'Failed to change password',
    );
    return createHttpErrorResponse(500, ERROR_MESSAGES.INTERNAL_ERROR);
  }
}
