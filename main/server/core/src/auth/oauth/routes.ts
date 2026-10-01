// main/server/core/src/auth/oauth/routes.ts
/**
 * OAuth Routes
 *
 * Route definitions for OAuth authentication endpoints.
 *
 * @module oauth/routes
 */

import { createRouteMap } from '@bslt/server-system/http';
import { oauthCallbackQuerySchema, type OAuthCallbackQuery } from '@bslt/shared/core/auth';
import { emptyBodySchema } from '@bslt/shared/system';

import {
  authProtectedRoute,
  authPublicRoute,
  defineAuthRouteEntries,
  type AuthRouteEntry,
  type AuthRouteRequest,
} from '../routes/helpers';

import {
  handleGetConnections,
  handleGetEnabledProviders,
  handleOAuthCallbackRequest,
  handleOAuthInitiate,
  handleOAuthLink,
  handleOAuthUnlink,
} from './handlers';

import type { OAuthProvider } from './types';

// ============================================================================
// Route Entries (for merging with parent routes)
// ============================================================================

const OAUTH_ROUTE_TAGS = ['Auth', 'OAuth'];

const OAUTH_ROUTE_PROVIDERS = [
  { provider: 'google', label: 'Google' },
  { provider: 'github', label: 'GitHub' },
  { provider: 'apple', label: 'Apple' },
  { provider: 'kakao', label: 'Kakao' },
] satisfies Array<{ provider: OAuthProvider; label: string }>;

function parseCallbackQuery(request: AuthRouteRequest): OAuthCallbackQuery {
  return oauthCallbackQuerySchema.parse(request.query);
}

function createProviderRouteEntries(provider: OAuthProvider, label: string): AuthRouteEntry[] {
  return defineAuthRouteEntries([
    [
      `auth/oauth/${provider}`,
      authPublicRoute(
        'GET',
        (ctx, _body, request, reply) => handleOAuthInitiate(ctx, { provider }, request, reply),
        undefined,
        { summary: `Initiate ${label} OAuth`, tags: OAUTH_ROUTE_TAGS },
      ),
    ],
    [
      `auth/oauth/${provider}/callback`,
      authPublicRoute(
        'GET',
        (ctx, _body, request, reply) => {
          const query = parseCallbackQuery(request);
          return handleOAuthCallbackRequest(
            ctx,
            { provider },
            {
              code: query['code'],
              state: query['state'],
              error: query['error'],
              error_description: query['error_description'],
            },
            request,
            reply,
          );
        },
        undefined,
        { summary: `${label} OAuth callback`, tags: OAUTH_ROUTE_TAGS },
      ),
    ],
    [
      `auth/oauth/${provider}/link`,
      authProtectedRoute(
        'POST',
        (ctx, _body, request, reply) => handleOAuthLink(ctx, { provider }, request, reply),
        [],
        emptyBodySchema,
        { summary: `Link ${label} account`, tags: OAUTH_ROUTE_TAGS },
      ),
    ],
    [
      `auth/oauth/${provider}/unlink`,
      authProtectedRoute(
        'DELETE',
        (ctx, _body, request, reply) => handleOAuthUnlink(ctx, { provider }, request, reply),
        [],
        emptyBodySchema,
        { summary: `Unlink ${label} account`, tags: OAUTH_ROUTE_TAGS },
      ),
    ],
  ]);
}

/**
 * OAuth Routes
 *
 * GET  /api/auth/oauth/:provider          - Initiate OAuth flow (redirect to provider)
 * GET  /api/auth/oauth/:provider/callback - Handle OAuth callback
 * POST /api/auth/oauth/:provider/link     - Initiate OAuth linking (authenticated)
 * DELETE /api/auth/oauth/:provider        - Unlink OAuth provider (authenticated)
 * GET  /api/auth/oauth/connections        - Get connected providers (authenticated)
 */
export const oauthRouteEntries = defineAuthRouteEntries([
  // List enabled OAuth providers (public)
  [
    'auth/oauth/providers',
    authPublicRoute('GET', (ctx) => handleGetEnabledProviders(ctx), undefined, {
      summary: 'Get enabled OAuth providers',
      tags: OAUTH_ROUTE_TAGS,
    }),
  ],
  ...OAUTH_ROUTE_PROVIDERS.flatMap(({ provider, label }) =>
    createProviderRouteEntries(provider, label),
  ),

  // Get connected providers (authenticated)
  [
    'auth/oauth/connections',
    authProtectedRoute(
      'GET',
      (ctx, _body, request, reply) => handleGetConnections(ctx, request, reply),
      [],
      undefined,
      { summary: 'List OAuth connections', tags: OAUTH_ROUTE_TAGS },
    ),
  ],
]);

// ============================================================================
// Route Map (for standalone use)
// ============================================================================

/**
 * OAuth route map for standalone registration.
 */
export const oauthRoutes = createRouteMap(oauthRouteEntries);
