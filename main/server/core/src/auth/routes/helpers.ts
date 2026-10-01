// main/server/core/src/auth/routes/helpers.ts
/**
 * Auth Route Helpers
 *
 * Canonical route bridge for auth modules. It narrows the generic
 * route layer to auth's request/reply/context contracts once so
 * auth route files do not repeat casts at every handler boundary.
 */

import {
  createScopedRouteHelpers,
  type HttpMethod,
  type HttpReply,
  type HttpRequest,
  type RouteDefinition,
  type RouteOpenApiMeta,
  type RouteResult,
  type RouteSchema,
} from '@bslt/server-system/http';
import { BadRequestError } from '@bslt/shared/system';

import type { AppContext, ReplyWithCookies, RequestWithCookies } from '../types';

export type AuthRouteRequest = RequestWithCookies & HttpRequest;
export type AuthRouteReply = ReplyWithCookies & HttpReply;
export type AuthRouteEntry = [string, RouteDefinition];

export type AuthRouteHandler<Body = unknown, Response = unknown> = (
  ctx: AppContext,
  body: Body,
  request: AuthRouteRequest,
  reply: AuthRouteReply,
) => Promise<RouteResult<Response>> | RouteResult<Response>;

const authScopedRouteHelpers = createScopedRouteHelpers<AppContext, AuthRouteRequest>(
  (ctx) => ctx as AppContext,
  (request) => request as AuthRouteRequest,
);

export function authPublicRoute<Body = unknown, Response = unknown>(
  method: HttpMethod,
  handler: AuthRouteHandler<Body, Response>,
  schema?: RouteSchema,
  openapi?: RouteOpenApiMeta,
): RouteDefinition {
  return authScopedRouteHelpers.publicRoute(
    method,
    (ctx, body, request, reply) => handler(ctx, body as Body, request, reply as AuthRouteReply),
    schema,
    openapi,
  );
}

export function authProtectedRoute<Body = unknown, Response = unknown>(
  method: HttpMethod,
  handler: AuthRouteHandler<Body, Response>,
  roles: string | string[] = [],
  schema?: RouteSchema,
  openapi?: RouteOpenApiMeta,
): RouteDefinition {
  return authScopedRouteHelpers.protectedRoute(
    method,
    (ctx, body, request, reply) => handler(ctx, body as Body, request, reply as AuthRouteReply),
    roles,
    schema,
    openapi,
  );
}

export function defineAuthRouteEntries(entries: AuthRouteEntry[]): AuthRouteEntry[] {
  return entries;
}

export function requireRouteParam(request: Pick<HttpRequest, 'params'>, name: string): string {
  const value = request.params[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new BadRequestError(`Route parameter "${name}" is required`);
  }
  return value;
}
