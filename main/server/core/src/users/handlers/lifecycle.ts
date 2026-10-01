// main/server/core/src/users/handlers/lifecycle.ts
/**
 * Account Lifecycle Handlers
 *
 * Handles account deactivation, deletion request (with grace period),
 * and reactivation.
 *
 * @module handlers/lifecycle
 */

import { createHttpErrorResponse, type HttpErrorResponse } from '@bslt/server-system/errors';
import { HTTP_STATUS, SUDO_TOKEN_HEADER } from '@bslt/shared/constants';
import {
  calculateDeletionGracePeriodEnd,
  canDeactivate,
  canReactivate,
  canRequestDeletion,
  getAccountStatus,
  type AccountLifecycleFields,
  type AccountLifecycleResponse,
  type AccountStatus,
  type DeactivateAccountRequest,
  type DeleteAccountRequest,
} from '@bslt/shared/core/users';
import { BadRequestError } from '@bslt/shared/system';

import { record } from '../../audit/service';
import { verifySudoToken } from '../../auth';
import { notifyAdmins } from '../../notifications/admin-alerts';
import { ERROR_MESSAGES, type UsersModuleDeps, type UsersRequest } from '../types';

import type { RouteResult } from '@bslt/server-system/http';

// ============================================================================
// Helpers
// ============================================================================

function toLifecycleFields(user: {
  deactivatedAt: Date | null;
  deletedAt: Date | null;
  deletionGracePeriodEnds: Date | null;
}): AccountLifecycleFields {
  return {
    deactivatedAt: user.deactivatedAt,
    deletedAt: user.deletedAt,
    deletionGracePeriodEnds: user.deletionGracePeriodEnds,
  };
}

function buildResponse(
  status: AccountStatus,
  message: string,
  gracePeriodEnds?: Date | null,
): AccountLifecycleResponse {
  const response: AccountLifecycleResponse = { message, status };
  if (gracePeriodEnds !== undefined && gracePeriodEnds !== null) {
    response.deletionGracePeriodEnds = gracePeriodEnds.toISOString();
  }
  return response;
}

/**
 * Resolve the JWT secret from the runtime context.
 *
 * The composition root provides the full app config at runtime; the users
 * module contract only declares the argon2 subset, so narrow locally to
 * reach the JWT secret needed for sudo-token verification.
 */
function resolveJwtSecret(ctx: UsersModuleDeps): string | undefined {
  const auth = ctx.config.auth as UsersModuleDeps['config']['auth'] & {
    readonly jwt?: { readonly secret?: string };
  };
  return auth.jwt?.secret;
}

/**
 * Require a valid sudo token for a destructive lifecycle action.
 *
 * Mirrors the admin hard-ban/delete inline verification (admin/userHandlers.ts)
 * so both surfaces return the same SUDO_REQUIRED / SUDO_EXPIRED / SUDO_MISMATCH
 * error shapes. Returns null when the request is sudo-authorized.
 */
function requireSudo(ctx: UsersModuleDeps, request: UsersRequest): HttpErrorResponse | null {
  const sudoToken = request.headers?.[SUDO_TOKEN_HEADER];
  if (typeof sudoToken !== 'string' || sudoToken.length === 0) {
    return createHttpErrorResponse(
      HTTP_STATUS.FORBIDDEN,
      'Sudo re-authentication required for this action. Please re-verify your identity.',
      { code: 'SUDO_REQUIRED' },
    );
  }

  const jwtSecret = resolveJwtSecret(ctx);
  if (jwtSecret === undefined || jwtSecret === '') {
    ctx.log.error(
      new Error('JWT secret unavailable; cannot verify sudo token'),
      'Sudo verification misconfigured',
    );
    return createHttpErrorResponse(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      ERROR_MESSAGES.INTERNAL_ERROR,
    );
  }

  const sudo = verifySudoToken(sudoToken, jwtSecret);
  if (sudo === null) {
    return createHttpErrorResponse(
      HTTP_STATUS.FORBIDDEN,
      'Sudo token is invalid or expired. Please re-verify your identity.',
      { code: 'SUDO_EXPIRED' },
    );
  }

  if (request.user !== undefined && sudo.userId !== request.user.userId) {
    return createHttpErrorResponse(
      HTTP_STATUS.FORBIDDEN,
      'Sudo token does not match authenticated user.',
      { code: 'SUDO_MISMATCH' },
    );
  }

  return null;
}

// ============================================================================
// Handlers
// ============================================================================

/**
 * Handle account deactivation.
 * Deactivated accounts cannot log in but data is preserved.
 * Destructive — requires sudo re-auth via the X-Sudo-Token header.
 */
export async function handleDeactivateAccount(
  ctx: UsersModuleDeps,
  _body: DeactivateAccountRequest,
  request: UsersRequest,
): Promise<HttpErrorResponse | RouteResult<{ status: number; body: AccountLifecycleResponse }>> {
  if (request.user === undefined) {
    return createHttpErrorResponse(401, ERROR_MESSAGES.UNAUTHORIZED);
  }

  const sudoError = requireSudo(ctx, request);
  if (sudoError !== null) {
    return sudoError;
  }

  try {
    const user = await ctx.repos.users.findById(request.user.userId);
    if (user === null) {
      return createHttpErrorResponse(404, ERROR_MESSAGES.USER_NOT_FOUND);
    }

    const fields = toLifecycleFields(user);
    if (!canDeactivate(fields)) {
      const currentStatus = getAccountStatus(fields);
      return createHttpErrorResponse(
        400,
        `Account cannot be deactivated (current status: ${currentStatus})`,
      );
    }

    const now = new Date();
    const updated = await ctx.repos.users.update(request.user.userId, {
      deactivatedAt: now,
    });

    if (updated === null) {
      return createHttpErrorResponse(500, ERROR_MESSAGES.INTERNAL_ERROR);
    }

    ctx.log.info({ userId: request.user.userId }, 'Account deactivated');

    // Fire-and-forget audit logging
    record(
      { auditEvents: ctx.repos.auditEvents },
      {
        actorId: request.user.userId,
        action: 'user.account_deactivated',
        resource: 'user',
        resourceId: request.user.userId,
        severity: 'warn',
        category: 'security',
      },
    ).catch(() => {});

    void notifyAdmins(
      { repos: ctx.repos, log: ctx.log },
      {
        type: 'account_deactivated',
        subject: { userId: user.id, email: user.email, username: user.username },
      },
    );

    return {
      status: 200,
      body: buildResponse('deactivated', 'Account has been deactivated'),
    };
  } catch (error) {
    if (error instanceof BadRequestError) {
      return createHttpErrorResponse(400, error.message);
    }
    ctx.log.error(
      error instanceof Error ? error : new Error(String(error)),
      'Failed to deactivate account',
    );
    return createHttpErrorResponse(500, ERROR_MESSAGES.INTERNAL_ERROR);
  }
}

/**
 * Handle account deletion request.
 * Initiates a 30-day grace period. After the grace period,
 * the account data is eligible for permanent removal.
 * Destructive — requires sudo re-auth via the X-Sudo-Token header.
 */
export async function handleRequestDeletion(
  ctx: UsersModuleDeps,
  _body: DeleteAccountRequest,
  request: UsersRequest,
): Promise<HttpErrorResponse | RouteResult<{ status: number; body: AccountLifecycleResponse }>> {
  if (request.user === undefined) {
    return createHttpErrorResponse(401, ERROR_MESSAGES.UNAUTHORIZED);
  }

  const sudoError = requireSudo(ctx, request);
  if (sudoError !== null) {
    return sudoError;
  }

  try {
    const user = await ctx.repos.users.findById(request.user.userId);
    if (user === null) {
      return createHttpErrorResponse(404, ERROR_MESSAGES.USER_NOT_FOUND);
    }

    const fields = toLifecycleFields(user);
    if (!canRequestDeletion(fields)) {
      return createHttpErrorResponse(400, 'Account deletion has already been requested');
    }

    const now = new Date();
    const gracePeriodEnds = calculateDeletionGracePeriodEnd(now);

    const updated = await ctx.repos.users.update(request.user.userId, {
      deletedAt: now,
      deletionGracePeriodEnds: gracePeriodEnds,
    });

    if (updated === null) {
      return createHttpErrorResponse(500, ERROR_MESSAGES.INTERNAL_ERROR);
    }

    ctx.log.info(
      { userId: request.user.userId, gracePeriodEnds: gracePeriodEnds.toISOString() },
      'Account deletion requested',
    );

    // Fire-and-forget audit logging
    record(
      { auditEvents: ctx.repos.auditEvents },
      {
        actorId: request.user.userId,
        action: 'user.deletion_requested',
        resource: 'user',
        resourceId: request.user.userId,
        severity: 'warn',
        category: 'security',
        metadata: { gracePeriodEnds: gracePeriodEnds.toISOString() },
      },
    ).catch(() => {});

    void notifyAdmins(
      { repos: ctx.repos, log: ctx.log },
      {
        type: 'deletion_requested',
        subject: { userId: user.id, email: user.email, username: user.username },
      },
    );

    return {
      status: 200,
      body: buildResponse(
        'pending_deletion',
        'Account deletion requested. You have 30 days to reactivate.',
        gracePeriodEnds,
      ),
    };
  } catch (error) {
    if (error instanceof BadRequestError) {
      return createHttpErrorResponse(400, error.message);
    }
    ctx.log.error(
      error instanceof Error ? error : new Error(String(error)),
      'Failed to request account deletion',
    );
    return createHttpErrorResponse(500, ERROR_MESSAGES.INTERNAL_ERROR);
  }
}

/**
 * Handle account reactivation.
 * Can reactivate deactivated accounts or cancel pending deletion
 * (within grace period).
 */
export async function handleReactivateAccount(
  ctx: UsersModuleDeps,
  _body: undefined,
  request: UsersRequest,
): Promise<HttpErrorResponse | RouteResult<{ status: number; body: AccountLifecycleResponse }>> {
  if (request.user === undefined) {
    return createHttpErrorResponse(401, ERROR_MESSAGES.UNAUTHORIZED);
  }

  try {
    const user = await ctx.repos.users.findById(request.user.userId);
    if (user === null) {
      return createHttpErrorResponse(404, ERROR_MESSAGES.USER_NOT_FOUND);
    }

    const fields = toLifecycleFields(user);
    if (!canReactivate(fields)) {
      const currentStatus = getAccountStatus(fields);
      if (currentStatus === 'active') {
        return createHttpErrorResponse(400, 'Account is already active');
      }
      return createHttpErrorResponse(
        400,
        'Account cannot be reactivated (grace period has expired)',
      );
    }

    const updated = await ctx.repos.users.update(request.user.userId, {
      deactivatedAt: null,
      deletedAt: null,
      deletionGracePeriodEnds: null,
    });

    if (updated === null) {
      return createHttpErrorResponse(500, ERROR_MESSAGES.INTERNAL_ERROR);
    }

    ctx.log.info({ userId: request.user.userId }, 'Account reactivated');

    // Fire-and-forget audit logging
    record(
      { auditEvents: ctx.repos.auditEvents },
      {
        actorId: request.user.userId,
        action: 'user.account_reactivated',
        resource: 'user',
        resourceId: request.user.userId,
        category: 'security',
      },
    ).catch(() => {});

    void notifyAdmins(
      { repos: ctx.repos, log: ctx.log },
      {
        type: 'account_reactivated',
        subject: { userId: user.id, email: user.email, username: user.username },
      },
    );

    return {
      status: 200,
      body: buildResponse('active', 'Account has been reactivated'),
    };
  } catch (error) {
    if (error instanceof BadRequestError) {
      return createHttpErrorResponse(400, error.message);
    }
    ctx.log.error(
      error instanceof Error ? error : new Error(String(error)),
      'Failed to reactivate account',
    );
    return createHttpErrorResponse(500, ERROR_MESSAGES.INTERNAL_ERROR);
  }
}
