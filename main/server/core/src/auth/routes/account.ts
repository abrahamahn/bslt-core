// main/server/core/src/auth/routes/account.ts
/**
 * Account Route Entries
 *
 * Registration and authenticated account-management routes.
 */

import {
  acceptTosRequestSchema,
  registerRequestSchema,
  setPhoneRequestSchema,
  verifyPhoneRequestSchema,
  type AcceptTosRequest,
  type RegisterRequest,
  type SetPhoneRequest,
  type VerifyPhoneRequest,
} from '@bslt/shared/core/auth';
import { emptyBodySchema } from '@bslt/shared/system';

import {
  handleAcceptTos,
  handleListDevices,
  handleRegister,
  handleRemovePhone,
  handleRevokeDevice,
  handleSetPhone,
  handleTosStatus,
  handleTrustDevice,
  handleVerifyPhone,
} from '../handlers';

import {
  authProtectedRoute,
  authPublicRoute,
  defineAuthRouteEntries,
  requireRouteParam,
  type AuthRouteRequest,
} from './helpers';

function deviceParams(request: AuthRouteRequest): { id: string } {
  return { id: requireRouteParam(request, 'id') };
}

export const accountRouteEntries = defineAuthRouteEntries([
  [
    'auth/register',
    authPublicRoute<RegisterRequest>('POST', handleRegister, registerRequestSchema, {
      summary: 'Register new user',
      tags: ['Auth'],
    }),
  ],

  [
    'auth/tos/status',
    authProtectedRoute(
      'GET',
      (ctx, _body, request) => handleTosStatus(ctx, undefined, request),
      [],
      undefined,
      { summary: 'Get ToS acceptance status', tags: ['Auth', 'Terms of Service'] },
    ),
  ],

  [
    'auth/tos/accept',
    authProtectedRoute<AcceptTosRequest>('POST', handleAcceptTos, 'user', acceptTosRequestSchema, {
      summary: 'Accept Terms of Service',
      tags: ['Auth', 'Terms of Service'],
    }),
  ],

  [
    'users/me/devices',
    authProtectedRoute(
      'GET',
      (ctx, _body, request) => handleListDevices(ctx, request),
      [],
      undefined,
      { summary: 'List trusted devices', tags: ['Auth', 'Devices'] },
    ),
  ],

  [
    'users/me/devices/:id/trust',
    authProtectedRoute(
      'POST',
      (ctx, _body, request) => handleTrustDevice(ctx, deviceParams(request), request),
      [],
      emptyBodySchema,
      { summary: 'Trust device', tags: ['Auth', 'Devices'] },
    ),
  ],

  [
    'users/me/devices/:id',
    authProtectedRoute(
      'DELETE',
      (ctx, _body, request) => handleRevokeDevice(ctx, deviceParams(request), request),
      [],
      emptyBodySchema,
      { summary: 'Revoke device', tags: ['Auth', 'Devices'] },
    ),
  ],

  [
    'users/me/phone',
    authProtectedRoute<SetPhoneRequest>('POST', handleSetPhone, 'user', setPhoneRequestSchema, {
      summary: 'Set phone number',
      tags: ['Auth', 'Phone'],
    }),
  ],

  [
    'users/me/phone/verify',
    authProtectedRoute<VerifyPhoneRequest>(
      'POST',
      handleVerifyPhone,
      'user',
      verifyPhoneRequestSchema,
      { summary: 'Verify phone number', tags: ['Auth', 'Phone'] },
    ),
  ],

  [
    'users/me/phone/delete',
    authProtectedRoute(
      'DELETE',
      (ctx, _body, request) => handleRemovePhone(ctx, request),
      'user',
      emptyBodySchema,
      { summary: 'Remove phone number', tags: ['Auth', 'Phone'] },
    ),
  ],
]);
