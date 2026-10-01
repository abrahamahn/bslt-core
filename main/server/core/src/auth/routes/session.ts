// main/server/core/src/auth/routes/session.ts
/**
 * Session Route Entries
 *
 * Session lifecycle and elevation flows for auth.
 */

import {
  loginRequestSchema,
  sudoRequestSchema,
  type LoginRequest,
  type SudoRequest,
} from '@bslt/shared/core/auth';
import { emptyBodySchema } from '@bslt/shared/system';

import {
  handleGetAuthStrategies,
  handleInvalidateSessions,
  handleLogin,
  handleLogout,
  handleLogoutAll,
  handleRefresh,
  handleSudoElevate,
} from '../handlers';

import { authProtectedRoute, authPublicRoute, defineAuthRouteEntries } from './helpers';

export const sessionRouteEntries = defineAuthRouteEntries([
  [
    'auth/strategies',
    authPublicRoute('GET', (ctx) => handleGetAuthStrategies(ctx), undefined, {
      summary: 'Get enabled/disabled auth strategies',
      tags: ['Auth'],
    }),
  ],

  [
    'auth/login',
    authPublicRoute<LoginRequest>('POST', handleLogin, loginRequestSchema, {
      summary: 'Authenticate user',
      tags: ['Auth'],
    }),
  ],

  [
    'auth/refresh',
    authPublicRoute(
      'POST',
      (ctx, _body, request, reply) => handleRefresh(ctx, request, reply),
      emptyBodySchema,
      { summary: 'Refresh access token', tags: ['Auth'] },
    ),
  ],

  [
    'auth/logout',
    authPublicRoute(
      'POST',
      (ctx, _body, request, reply) => handleLogout(ctx, request, reply),
      emptyBodySchema,
      { summary: 'Logout current session', tags: ['Auth'] },
    ),
  ],

  [
    'auth/logout-all',
    authProtectedRoute(
      'POST',
      (ctx, _body, request, reply) => handleLogoutAll(ctx, request, reply),
      [],
      emptyBodySchema,
      { summary: 'Logout all sessions', tags: ['Auth'] },
    ),
  ],

  [
    'auth/sudo',
    authProtectedRoute<SudoRequest>('POST', handleSudoElevate, [], sudoRequestSchema, {
      summary: 'Elevate to sudo mode',
      tags: ['Auth'],
    }),
  ],

  [
    'auth/invalidate-sessions',
    authProtectedRoute(
      'POST',
      (ctx, _body, request, reply) => handleInvalidateSessions(ctx, request, reply),
      [],
      emptyBodySchema,
      { summary: 'Invalidate all sessions', tags: ['Auth', 'Sessions'] },
    ),
  ],
]);
