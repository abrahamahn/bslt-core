// main/server/core/src/auth/webauthn/routes.ts
/**
 * WebAuthn Routes
 *
 * Route definitions for WebAuthn/Passkey endpoints.
 *
 * @module webauthn/routes
 */

import { createRouteMap } from '@bslt/server-system/http';
import {
  renamePasskeyRequestSchema,
  webauthnLoginOptionsRequestSchema,
  webauthnLoginVerifyRequestSchema,
  webauthnRegisterVerifyRequestSchema,
  type RenamePasskeyRequest,
  type WebauthnLoginOptionsRequest,
  type WebauthnLoginVerifyRequest,
  type WebauthnRegisterVerifyRequest,
} from '@bslt/shared/core/auth';
import { emptyBodySchema } from '@bslt/shared/system';

import {
  handleDeletePasskey,
  handleListPasskeys,
  handleRenamePasskey,
  handleWebauthnLoginOptions,
  handleWebauthnLoginVerify,
  handleWebauthnRegisterOptions,
  handleWebauthnRegisterVerify,
} from '../handlers/webauthn';
import {
  authProtectedRoute,
  authPublicRoute,
  defineAuthRouteEntries,
  requireRouteParam,
} from '../routes/helpers';

/**
 * WebAuthn route entries for inclusion in the auth route map.
 */
export const webauthnRouteEntries = defineAuthRouteEntries([
  // Registration
  [
    'auth/webauthn/register/options',
    authProtectedRoute(
      'POST',
      (ctx, _body, request) => handleWebauthnRegisterOptions(ctx, undefined, request),
      [],
      emptyBodySchema,
      { summary: 'Generate WebAuthn registration options', tags: ['Auth', 'WebAuthn'] },
    ),
  ],

  [
    'auth/webauthn/register/verify',
    authProtectedRoute<WebauthnRegisterVerifyRequest>(
      'POST',
      handleWebauthnRegisterVerify,
      [],
      webauthnRegisterVerifyRequestSchema,
      { summary: 'Verify WebAuthn registration', tags: ['Auth', 'WebAuthn'] },
    ),
  ],

  // Authentication
  [
    'auth/webauthn/login/options',
    authPublicRoute<WebauthnLoginOptionsRequest>(
      'POST',
      (ctx, body) => handleWebauthnLoginOptions(ctx, body),
      webauthnLoginOptionsRequestSchema,
      { summary: 'Generate WebAuthn authentication options', tags: ['Auth', 'WebAuthn'] },
    ),
  ],

  [
    'auth/webauthn/login/verify',
    authPublicRoute<WebauthnLoginVerifyRequest>(
      'POST',
      handleWebauthnLoginVerify,
      webauthnLoginVerifyRequestSchema,
      { summary: 'Verify WebAuthn authentication', tags: ['Auth', 'WebAuthn'] },
    ),
  ],

  // Passkey Management
  [
    'users/me/passkeys',
    authProtectedRoute(
      'GET',
      (ctx, _body, request) => handleListPasskeys(ctx, undefined, request),
      [],
      undefined,
      { summary: 'List registered passkeys', tags: ['Auth', 'WebAuthn'] },
    ),
  ],

  [
    'users/me/passkeys/:id',
    authProtectedRoute<RenamePasskeyRequest>(
      'PATCH',
      (ctx, body, request) =>
        handleRenamePasskey(ctx, body, { id: requireRouteParam(request, 'id') }, request),
      'user',
      renamePasskeyRequestSchema,
      { summary: 'Rename a passkey', tags: ['Auth', 'WebAuthn'] },
    ),
  ],

  [
    'users/me/passkeys/:id/delete',
    authProtectedRoute(
      'DELETE',
      (ctx, _body, request) =>
        handleDeletePasskey(ctx, { id: requireRouteParam(request, 'id') }, request),
      [],
      emptyBodySchema,
      { summary: 'Delete a passkey', tags: ['Auth', 'WebAuthn'] },
    ),
  ],
]);

export const webauthnRoutes = createRouteMap(webauthnRouteEntries);
