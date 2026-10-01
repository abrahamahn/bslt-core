// main/server/core/src/auth/handlers/webauthn.ts
/**
 * WebAuthn Handlers
 *
 * HTTP layer for WebAuthn registration, authentication, and passkey management.
 *
 * @module handlers/webauthn
 */

import { withTransaction } from '@bslt/db/utils';
import {
  createHttpErrorResponse,
  mapErrorToHttpResponse,
  type HttpErrorResponse,
} from '@bslt/server-system/errors';
import {
  isStrategyEnabled,
  type AuthResponse,
  type PasskeyListItem,
  type RenamePasskeyRequest,
} from '@bslt/shared/core/auth';

import { assertUserActive } from '../middleware';
import {
  createErrorMapperLogger,
  type AppContext,
  type ReplyWithCookies,
  type RequestWithCookies,
} from '../types';
import {
  createAccessToken,
  createAuthResponse,
  createRefreshTokenFamily,
  setRefreshTokenCookie,
} from '../utils';
import {
  getAuthenticationOptions,
  getRegistrationOptions,
  verifyAuthentication,
  verifyRegistration,
} from '../webauthn/service';

function strategyDisabledResponse(): HttpErrorResponse {
  return createHttpErrorResponse(404, 'WebAuthn authentication is not enabled');
}

// ============================================================================
// Registration Handlers
// ============================================================================

/**
 * Generate WebAuthn registration options (protected).
 */
export async function handleWebauthnRegisterOptions(
  ctx: AppContext,
  _body: unknown,
  request: RequestWithCookies,
): Promise<{ options: Record<string, unknown> } | HttpErrorResponse> {
  if (
    Array.isArray(ctx.config.auth.strategies) &&
    !isStrategyEnabled(ctx.config.auth, 'webauthn')
  ) {
    return strategyDisabledResponse();
  }

  try {
    const userId = request.user?.userId;
    if (userId === undefined) {
      return createHttpErrorResponse(401, 'Authentication required');
    }

    await assertUserActive((id) => ctx.repos.users.findById(id), userId);

    const email = request.user?.email ?? '';
    const options = await getRegistrationOptions(ctx.repos, userId, email, ctx.config.auth);

    return { options };
  } catch (error) {
    return mapErrorToHttpResponse(error, createErrorMapperLogger(ctx.log));
  }
}

/**
 * Verify WebAuthn registration response (protected).
 */
export async function handleWebauthnRegisterVerify(
  ctx: AppContext,
  body: { credential: Record<string, unknown>; name?: string },
  request: RequestWithCookies,
): Promise<{ credentialId: string; message: string } | HttpErrorResponse> {
  if (
    Array.isArray(ctx.config.auth.strategies) &&
    !isStrategyEnabled(ctx.config.auth, 'webauthn')
  ) {
    return strategyDisabledResponse();
  }

  try {
    const userId = request.user?.userId;
    if (userId === undefined) {
      return createHttpErrorResponse(401, 'Authentication required');
    }

    await assertUserActive((id) => ctx.repos.users.findById(id), userId);

    const result = await verifyRegistration(
      ctx.repos,
      userId,
      body.credential,
      ctx.config.auth,
      body.name,
    );

    return result;
  } catch (error) {
    return mapErrorToHttpResponse(error, createErrorMapperLogger(ctx.log));
  }
}

// ============================================================================
// Authentication Handlers
// ============================================================================

/**
 * Generate WebAuthn authentication options (public).
 */
export async function handleWebauthnLoginOptions(
  ctx: AppContext,
  body: { email?: string },
): Promise<{ options: Record<string, unknown> } | HttpErrorResponse> {
  if (
    Array.isArray(ctx.config.auth.strategies) &&
    !isStrategyEnabled(ctx.config.auth, 'webauthn')
  ) {
    return strategyDisabledResponse();
  }

  try {
    const { options } = await getAuthenticationOptions(ctx.repos, ctx.config.auth, body.email);
    return { options };
  } catch (error) {
    return mapErrorToHttpResponse(error, createErrorMapperLogger(ctx.log));
  }
}

/**
 * Verify WebAuthn authentication response (public).
 * Issues auth tokens on success.
 */
export async function handleWebauthnLoginVerify(
  ctx: AppContext,
  body: { credential: Record<string, unknown>; sessionKey: string },
  request: RequestWithCookies,
  reply: ReplyWithCookies,
): Promise<AuthResponse | HttpErrorResponse> {
  if (
    Array.isArray(ctx.config.auth.strategies) &&
    !isStrategyEnabled(ctx.config.auth, 'webauthn')
  ) {
    return strategyDisabledResponse();
  }

  try {
    const { userId } = await verifyAuthentication(
      ctx.repos,
      body.credential,
      body.sessionKey,
      ctx.config.auth,
    );

    const user = await ctx.repos.users.findById(userId);
    if (user === null) {
      return createHttpErrorResponse(401, 'User not found');
    }

    // Check user is active
    await assertUserActive((id) => ctx.repos.users.findById(id), userId);

    const { ipAddress, userAgent } = request.requestInfo;

    // Create tokens
    const { token: refreshToken } = await withTransaction(ctx.db, async (tx) => {
      const sessionMeta: { ipAddress?: string; userAgent?: string } = {};
      if (ipAddress !== undefined) {
        sessionMeta.ipAddress = ipAddress;
      }
      if (userAgent !== undefined) {
        sessionMeta.userAgent = userAgent;
      }
      return createRefreshTokenFamily(
        tx,
        user.id,
        ctx.config.auth.refreshToken.expiryDays,
        sessionMeta,
      );
    });

    const accessToken = createAccessToken(
      user.id,
      user.email,
      user.role,
      ctx.config.auth.jwt.secret,
      ctx.config.auth.jwt.accessTokenExpiry,
      user.tokenVersion,
    );

    setRefreshTokenCookie(reply, refreshToken, ctx.config.auth);

    const authResponse = createAuthResponse(accessToken, refreshToken, user);

    return {
      token: authResponse.accessToken,
      user: authResponse.user,
    };
  } catch (error) {
    return mapErrorToHttpResponse(error, createErrorMapperLogger(ctx.log));
  }
}

// ============================================================================
// Passkey Management Handlers
// ============================================================================

/**
 * List user's registered passkeys (protected).
 */
export async function handleListPasskeys(
  ctx: AppContext,
  _body: unknown,
  request: RequestWithCookies,
): Promise<PasskeyListItem[] | HttpErrorResponse> {
  if (
    Array.isArray(ctx.config.auth.strategies) &&
    !isStrategyEnabled(ctx.config.auth, 'webauthn')
  ) {
    return strategyDisabledResponse();
  }

  try {
    const userId = request.user?.userId;
    if (userId === undefined) {
      return createHttpErrorResponse(401, 'Authentication required');
    }

    const credentials = await ctx.repos.webauthnCredentials.findByUserId(userId);
    const passkeys: PasskeyListItem[] = credentials.map((c) => ({
      id: c.id,
      name: c.name,
      deviceType: c.deviceType,
      backedUp: c.backedUp,
      createdAt: c.createdAt.toISOString(),
      lastUsedAt: c.lastUsedAt !== null ? c.lastUsedAt.toISOString() : null,
    }));

    return passkeys;
  } catch (error) {
    return mapErrorToHttpResponse(error, createErrorMapperLogger(ctx.log));
  }
}

/**
 * Rename a passkey (protected).
 */
export async function handleRenamePasskey(
  ctx: AppContext,
  body: RenamePasskeyRequest,
  params: { id: string },
  request: RequestWithCookies,
): Promise<{ message: string } | HttpErrorResponse> {
  if (
    Array.isArray(ctx.config.auth.strategies) &&
    !isStrategyEnabled(ctx.config.auth, 'webauthn')
  ) {
    return strategyDisabledResponse();
  }

  try {
    const userId = request.user?.userId;
    if (userId === undefined) {
      return createHttpErrorResponse(401, 'Authentication required');
    }

    const credentials = await ctx.repos.webauthnCredentials.findByUserId(userId);
    const credential = credentials.find((c) => c.id === params.id);
    if (credential === undefined) {
      return createHttpErrorResponse(404, 'Passkey not found');
    }

    await ctx.repos.webauthnCredentials.updateName(params.id, body.name);

    return { message: 'Passkey renamed successfully' };
  } catch (error) {
    return mapErrorToHttpResponse(error, createErrorMapperLogger(ctx.log));
  }
}

/**
 * Delete a passkey (protected, requires sudo).
 */
export async function handleDeletePasskey(
  ctx: AppContext,
  params: { id: string },
  request: RequestWithCookies,
): Promise<{ message: string } | HttpErrorResponse> {
  if (
    Array.isArray(ctx.config.auth.strategies) &&
    !isStrategyEnabled(ctx.config.auth, 'webauthn')
  ) {
    return strategyDisabledResponse();
  }

  try {
    const userId = request.user?.userId;
    if (userId === undefined) {
      return createHttpErrorResponse(401, 'Authentication required');
    }

    const credentials = await ctx.repos.webauthnCredentials.findByUserId(userId);
    const credential = credentials.find((c) => c.id === params.id);
    if (credential === undefined) {
      return createHttpErrorResponse(404, 'Passkey not found');
    }

    await ctx.repos.webauthnCredentials.delete(params.id);

    return { message: 'Passkey deleted successfully' };
  } catch (error) {
    return mapErrorToHttpResponse(error, createErrorMapperLogger(ctx.log));
  }
}
