import { registerFeatureWebhooks } from '../extensions';
// main/apps/server/src/http/router.ts
/**
 * App Route Composition
 *
 * App-owned route composition concerns:
 * - auth-strategy filtering
 * - selected OpenAPI annotations
 * - module/prefix orchestration
 * - billing webhook raw Fastify endpoints
 * - the ToS re-acceptance gate on protected routes (with its exempt paths)
 *
 * Canonical Fastify route registration lives in `@bslt/server-system/http`.
 *
 * @module router
 */

import { createAuthGuard, createRequireTosAcceptance } from '@bslt/core/auth';
import { registerRouteMap } from '@bslt/server-system/http';

import { contextualizeRequest } from '../bootstrap/context';

import { createAppRouteModuleRegistrations } from './route-modules';

import type { AppContext } from '../bootstrap/context';
import type { AuthGuardFactory, RouterOptions } from '@bslt/server-system/http';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

// ============================================================================

/**
 * Protected endpoints that stay reachable while a user is gated on ToS
 * re-acceptance. Everything the client's acceptance-modal loop touches must be
 * here, or publishing a new ToS version would lock users out of the very
 * endpoints they need to clear the gate:
 * - `auth/tos/status` + `auth/tos/accept` — see and clear the gate (the
 *   modal's own calls, retried by the api client's 403 interceptor)
 * - `users/me` — session hydration runs at startup, before the modal handler
 *   has mounted; gating it would strand returning users as logged-out
 * - `auth/logout-all` — signing out everywhere must never be gated
 *
 * `auth/logout` and `auth/refresh` are public routes — the gate never runs there.
 */
const TOS_EXEMPT_PATHS = [
  '/api/auth/tos/status',
  '/api/auth/tos/accept',
  '/api/auth/logout-all',
  '/api/users/me',
];

/**
 * The guard every protected route runs: token authentication, RLS
 * contextualization, then the ToS re-acceptance gate.
 */
export function createAppAuthGuardFactory(ctx: Pick<AppContext, 'repos'>): AuthGuardFactory {
  const requireTosAcceptance = createRequireTosAcceptance(ctx.repos, {
    exemptPaths: TOS_EXEMPT_PATHS,
  });

  return (secret: string, ...roles: string[]) => {
    const authGuard = createAuthGuard(secret, ctx.repos, ...roles);
    return async (request, reply) => {
      await authGuard(request, reply);
      await contextualizeRequest(request as FastifyRequest, reply as FastifyReply);
      await requireTosAcceptance(request, reply);
    };
  };
}

export async function registerRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  registerFeatureWebhooks(app, ctx);
  const routerOptions: Pick<RouterOptions, 'prefix' | 'jwtSecret' | 'authGuardFactory'> = {
    prefix: '/api',
    jwtSecret: ctx.config.auth.jwt.secret,
    authGuardFactory: createAppAuthGuardFactory(ctx),
  };

  const routeModules = await createAppRouteModuleRegistrations(ctx.config.auth.strategies);
  const routeServer = app as Parameters<typeof registerRouteMap>[0];

  for (const { module, routes, prefix } of routeModules) {
    registerRouteMap(routeServer, ctx, routes, {
      ...routerOptions,
      ...(prefix !== undefined ? { prefix } : {}),
      module,
    });
  }

}
