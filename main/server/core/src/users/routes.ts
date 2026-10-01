// main/server/core/src/users/routes.ts
/**
 * User Routes
 *
 * Route definitions for users module.
 * All routes require authentication.
 *
 * Uses the generic router pattern from @bslt/server-system.
 * Route handlers accept HandlerContext (Record<string, unknown>) from the
 * generic router and narrow it to UsersModuleDeps at the call boundary.
 *
 * @module routes
 */

import { createHttpErrorResponse } from '@bslt/server-system/errors';
import {
  createRouteMap,
  createScopedRouteHelpers,
  withRouteOptions,
  type HttpRequest,
  type RouteMap,
} from '@bslt/server-system/http';
import { MAX_IMAGE_SIZE } from '@bslt/shared/constants/media';
import {
  avatarUploadRequestSchema,
  changePasswordRequestSchema,
  deactivateAccountRequestSchema,
  deleteAccountRequestSchema,
  updateProfileRequestSchema,
  updateUsernameRequestSchema,
  type ChangePasswordRequest,
  type DeactivateAccountRequest,
  type DeleteAccountRequest,
  type UpdateUsernameRequest,
} from '@bslt/shared/core/users';
import { NotFoundError, emptyBodySchema } from '@bslt/shared/system';

import { REFRESH_COOKIE_NAME } from '../auth';

import {
  handleChangePassword,
  handleDeactivateAccount,
  handleDeleteAvatar,
  handleGetProfileCompleteness,
  handleMe,
  handleReactivateAccount,
  handleRequestDeletion,
  handleUpdateProfile,
  handleUpdateUsername,
  handleUploadAvatar,
  listUserSessions,
  revokeAllSessions,
  revokeSession,
  type UpdateProfileData,
} from './handlers';
import { ERROR_MESSAGES, type UsersModuleDeps, type UsersRequest } from './types';

import type { Repositories } from '@bslt/db/factory';

type UsersRouteRequest = UsersRequest & HttpRequest;

// ============================================================================
// Context Bridge
// ============================================================================

/**
 * Narrow HandlerContext to UsersModuleDeps.
 * The server composition root ensures the context implements UsersModuleDeps.
 *
 * @param ctx - Generic handler context from router
 * @returns Narrowed UsersModuleDeps
 * @complexity O(1)
 */
const usersRouteHelpers = createScopedRouteHelpers<UsersModuleDeps, UsersRouteRequest>(
  (ctx) => ctx as UsersModuleDeps,
  (request) => request as UsersRouteRequest,
);

const userProtectedRoute = usersRouteHelpers.protectedRoute;
const AVATAR_MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const AVATAR_UPLOAD_BODY_LIMIT_BYTES = MAX_IMAGE_SIZE + AVATAR_MULTIPART_OVERHEAD_BYTES;

// ============================================================================
// Session Helper
// ============================================================================

/**
 * Resolve the current session's token family ID from the refresh token cookie.
 *
 * Reads the `refreshToken` cookie from the request, looks up the token
 * in the database, and returns the associated family ID. Returns undefined
 * if no cookie is present or the token is not found.
 *
 * @param repos - Repository container
 * @param req - Fastify request (with cookies parsed by middleware)
 * @returns The family ID of the current session, or undefined
 * @complexity O(1) — single database lookup
 */
async function resolveCurrentFamilyId(
  repos: Repositories,
  req: UsersRouteRequest,
): Promise<string | undefined> {
  const cookies = req.cookies;
  if (cookies === undefined) {
    return undefined;
  }
  const refreshToken = cookies[REFRESH_COOKIE_NAME];

  if (refreshToken === undefined || refreshToken === '') {
    return undefined;
  }

  const tokenRecord = await repos.refreshTokens.findByToken(refreshToken);
  return tokenRecord?.familyId ?? undefined;
}

// ============================================================================
// Route Definitions
// ============================================================================

/**
 * User route map with all user management endpoints.
 *
 * Routes:
 * - `users/me` (GET, user) — Get current user's profile
 * - `users/me/profile-completeness` (GET, user) — Get profile completeness percentage
 * - `users/me/username` (PATCH, user) — Update current user's username (30-day cooldown)
 * - `users/me/update` (PATCH, user) — Update profile fields (name, bio, location, etc.)
 * - `users/me/password` (POST, user) — Change password (requires current password)
 * - `users/me/avatar` (PUT, user) — Upload avatar (multipart)
 * - `users/me/avatar/delete` (POST, user) — Delete avatar
 * - `users/me/sessions` (GET, user) — List current user's active sessions
 * - `users/me/sessions/:id` (DELETE, user) — Revoke a specific session
 * - `users/me/sessions/revoke-all` (POST, user) — Revoke all sessions except current
 *
 * @complexity O(n) where n = number of routes
 */
export const userRoutes: RouteMap = createRouteMap([
  [
    'users/me',
    userProtectedRoute('GET', async (ctx, _body, req) => handleMe(ctx, req), 'user', undefined, {
      summary: 'Get current user profile',
      tags: ['Users'],
    }),
  ],

  // Profile completeness — returns percentage and missing fields
  [
    'users/me/profile-completeness',
    userProtectedRoute(
      'GET',
      async (ctx, _body, req) => handleGetProfileCompleteness(ctx, req),
      'user',
      undefined,
      { summary: 'Get profile completeness', tags: ['Users'] },
    ),
  ],

  // Username update — PATCH with 30-day cooldown
  [
    'users/me/username',
    userProtectedRoute<UpdateUsernameRequest>(
      'PATCH',
      async (ctx, body, req) => handleUpdateUsername(ctx, body, req),
      'user',
      updateUsernameRequestSchema,
      { summary: 'Update username', tags: ['Users'] },
    ),
  ],

  // ============================================================================
  // Profile & Password Routes
  // ============================================================================

  // Profile update — PATCH with partial fields
  [
    'users/me/update',
    userProtectedRoute<UpdateProfileData>(
      'PATCH',
      async (ctx, body, req) => handleUpdateProfile(ctx, body, req),
      'user',
      updateProfileRequestSchema,
      { summary: 'Update profile', tags: ['Users'] },
    ),
  ],

  // Password change — POST with current + new password
  [
    'users/me/password',
    userProtectedRoute<ChangePasswordRequest>(
      'POST',
      async (ctx, body, req) => handleChangePassword(ctx, body, req),
      'user',
      changePasswordRequestSchema,
      { summary: 'Change password', tags: ['Users'] },
    ),
  ],

  // ============================================================================
  // Avatar Routes
  // ============================================================================

  // Avatar upload — PUT with multipart file body
  [
    'users/me/avatar',
    withRouteOptions(
      userProtectedRoute(
        'PUT',
        async (ctx, body, req) => handleUploadAvatar(ctx, body, req),
        'user',
        avatarUploadRequestSchema,
        { summary: 'Upload avatar', tags: ['Users'] },
      ),
      { bodyLimit: AVATAR_UPLOAD_BODY_LIMIT_BYTES },
    ),
  ],

  // Avatar delete — DELETE
  [
    'users/me/avatar/delete',
    userProtectedRoute(
      'POST',
      async (ctx, _body, req) => handleDeleteAvatar(ctx, undefined, req),
      'user',
      emptyBodySchema,
      { summary: 'Delete avatar', tags: ['Users'] },
    ),
  ],

  // ============================================================================
  // Session Management Routes
  // ============================================================================

  // List all active sessions for the authenticated user
  [
    'users/me/sessions',
    userProtectedRoute(
      'GET',
      async (deps, _body, request) => {
        if (request.user === undefined) {
          return createHttpErrorResponse(401, ERROR_MESSAGES.UNAUTHORIZED);
        }

        try {
          const currentFamilyId = await resolveCurrentFamilyId(deps.repos, request);
          const sessions = await listUserSessions(deps.repos, request.user.userId, currentFamilyId);

          return { sessions };
        } catch (error) {
          deps.log.error(
            error instanceof Error ? error : new Error(String(error)),
            'Failed to list sessions',
          );
          return createHttpErrorResponse(500, ERROR_MESSAGES.INTERNAL_ERROR);
        }
      },
      'user',
      undefined,
      { summary: 'List active sessions', tags: ['Users', 'Sessions'] },
    ),
  ],

  // Revoke a specific session by ID
  [
    'users/me/sessions/:id',
    userProtectedRoute(
      'DELETE',
      async (deps, _body, request) => {
        if (request.user === undefined) {
          return createHttpErrorResponse(401, ERROR_MESSAGES.UNAUTHORIZED);
        }

        const params = request.params as { id: string };

        try {
          const currentFamilyId = await resolveCurrentFamilyId(deps.repos, request);
          await revokeSession(deps.db, deps.repos, request.user.userId, params.id, currentFamilyId);

          return { success: true };
        } catch (error) {
          if (error instanceof NotFoundError) {
            return createHttpErrorResponse(404, error.message);
          }
          deps.log.error(
            error instanceof Error ? error : new Error(String(error)),
            'Failed to revoke session',
          );
          return createHttpErrorResponse(500, ERROR_MESSAGES.INTERNAL_ERROR);
        }
      },
      'user',
      emptyBodySchema,
      { summary: 'Revoke session', tags: ['Users', 'Sessions'] },
    ),
  ],

  // Revoke all sessions except the current one
  [
    'users/me/sessions/revoke-all',
    userProtectedRoute(
      'POST',
      async (deps, _body, request) => {
        if (request.user === undefined) {
          return createHttpErrorResponse(401, ERROR_MESSAGES.UNAUTHORIZED);
        }

        try {
          const currentFamilyId = await resolveCurrentFamilyId(deps.repos, request);
          const revokedCount = await revokeAllSessions(
            deps.db,
            deps.repos,
            request.user.userId,
            currentFamilyId,
          );

          return { success: true, revokedCount };
        } catch (error) {
          deps.log.error(
            error instanceof Error ? error : new Error(String(error)),
            'Failed to revoke all sessions',
          );
          return createHttpErrorResponse(500, ERROR_MESSAGES.INTERNAL_ERROR);
        }
      },
      'user',
      emptyBodySchema,
      { summary: 'Revoke all sessions', tags: ['Users', 'Sessions'] },
    ),
  ],

  // ============================================================================
  // Account Lifecycle Routes
  // ============================================================================

  // Deactivate account — preserves data but prevents login
  [
    'users/me/deactivate',
    userProtectedRoute<DeactivateAccountRequest>(
      'POST',
      async (ctx, body, req) => handleDeactivateAccount(ctx, body, req),
      'user',
      deactivateAccountRequestSchema,
      { summary: 'Deactivate account', tags: ['Users', 'Account Lifecycle'] },
    ),
  ],

  // Request account deletion — initiates 30-day grace period
  [
    'users/me/delete',
    userProtectedRoute<DeleteAccountRequest>(
      'POST',
      async (ctx, body, req) => handleRequestDeletion(ctx, body, req),
      'user',
      deleteAccountRequestSchema,
      { summary: 'Request account deletion', tags: ['Users', 'Account Lifecycle'] },
    ),
  ],

  // Reactivate account — cancel deactivation or pending deletion
  [
    'users/me/reactivate',
    userProtectedRoute(
      'POST',
      async (ctx, _body, req) => handleReactivateAccount(ctx, undefined, req),
      'user',
      emptyBodySchema,
      { summary: 'Reactivate account', tags: ['Users', 'Account Lifecycle'] },
    ),
  ],
]);
