// main/server/system/src/http/routing.ts
/**
 * Route Definitions & Registration
 *
 * Framework-agnostic route map helpers. Defines the handler contract
 * using abstract HttpRequest/HttpReply interfaces.
 *
 * Also provides `registerRouteMap` which bridges RouteMap definitions
 * into a Fastify instance.
 *
 * @module routing
 */
import { RequestSchemaError } from '@bslt/shared/system';

import { registerRoute } from './route.registry';

import type { HttpMethod } from './types';
import type { HttpReply, HttpRequest } from '@bslt/shared/system';
import type { FastifySchema } from 'fastify';

interface RouteOptionsLike {
  method: string;
  url: string;
  bodyLimit?: number;
  schema?: FastifySchema;
  preHandler?: (req: unknown, reply: unknown) => Promise<void>;
  handler: (req: unknown, reply: unknown) => Promise<unknown>;
}

interface RouteServerLike {
  route(opts: RouteOptionsLike): void;
  addHook(name: string, hook: (req: unknown, reply: unknown, ...args: unknown[]) => unknown): void;
}

export type RoutePreHandler = (request: HttpRequest, reply: HttpReply) => void | Promise<void>;

/**
 * Handler context passed through the route registry.
 *
 * The route layer stays agnostic to the concrete app context type.
 * Feature packages narrow this to their local dependency contract once,
 * through the route bridge helpers below.
 */
export type HandlerContext = object;

export type RouteResult<T = unknown> = T;

export type RouteHandler<Body = unknown, Response = unknown> = (
  ctx: HandlerContext,
  body: Body,
  req: HttpRequest,
  reply: HttpReply,
) => Promise<RouteResult<Response>> | RouteResult<Response>;

export type ScopedRouteHandler<
  Context extends object,
  Body = unknown,
  Response = unknown,
  Request extends HttpRequest = HttpRequest,
> = (
  ctx: Context,
  body: Body,
  req: Request,
  reply: HttpReply,
) => Promise<RouteResult<Response>> | RouteResult<Response>;

/**
 * Validation schema interface compatible with `@bslt/shared` Schema<T>.
 * Accepts objects with `parse` and `safeParse` methods (e.g.,
 * custom Schema<T> from shared contracts).
 *
 * @complexity O(1)
 */
export interface ValidationSchema {
  parse: (data: unknown) => unknown;
  safeParse: (data: unknown) => {
    success: boolean;
    data?: unknown;
    error?: unknown;
  };
}

/**
 * Union type for all accepted schema formats.
 * ValidationSchema: validated via safeParse in the handler wrapper.
 * Record<string, unknown>: a raw JSON Schema object for framework-native validation.
 */
export type RouteSchema = ValidationSchema | Record<string, unknown>;

/** JSON Schema object for OpenAPI route metadata */
export interface JsonSchemaObject {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  description?: string;
  [key: string]: unknown;
}

/** OpenAPI metadata that can be attached to a route */
export interface RouteOpenApiMeta {
  summary?: string;
  description?: string;
  tags?: string[];
  body?: JsonSchemaObject;
  params?: JsonSchemaObject;
  querystring?: JsonSchemaObject;
  response?: Record<number, JsonSchemaObject>;
  hide?: boolean;
  /** OpenAPI security requirements. Set to `[]` for explicitly unsecured routes. */
  security?: Array<Record<string, string[]>>;
}

/** Deprecation metadata for sunset routes */
export interface RouteDeprecation {
  /** ISO 8601 date when the route will be removed */
  sunset?: string;
  /** Human-readable deprecation message */
  message?: string;
}

export interface RouteDefinition {
  method: HttpMethod;
  handler: RouteHandler;
  isPublic: boolean;
  /** Compatibility alias for legacy route tests and shared-era metadata. */
  auth?: string;
  roles?: string[];
  schema?: RouteSchema;
  /** Optional OpenAPI metadata for swagger docs */
  openapi?: RouteOpenApiMeta;
  /** Additional preHandler hooks, executed after auth guards for protected routes. */
  preHandlers?: RoutePreHandler[];
  /** Fastify route registration options for transport-level behavior. */
  routeOptions?: {
    bodyLimit?: number;
  };
  /** Mark route as deprecated — adds Sunset and Deprecation response headers */
  deprecated?: RouteDeprecation;
}

export type RouteMap = Map<string, RouteDefinition>;

/**
 * Create a RouteMap from an array of [path, definition] tuples.
 * @param routes - Array of [path, RouteDefinition] entries
 * @returns Map of path to RouteDefinition
 * @complexity O(n) where n is number of routes
 */
export function createRouteMap(routes: [string, RouteDefinition][]): RouteMap {
  return new Map(routes);
}

/**
 * Attach one or more route-local preHandlers to a route definition.
 * Protected routes run authentication first, then these guards in order.
 */
export function withRoutePreHandlers(
  route: RouteDefinition,
  ...preHandlers: RoutePreHandler[]
): RouteDefinition {
  return {
    ...route,
    preHandlers: [...(route.preHandlers ?? []), ...preHandlers],
  };
}

/**
 * Attach transport-level registration options to a route definition.
 */
export function withRouteOptions(
  route: RouteDefinition,
  options: NonNullable<RouteDefinition['routeOptions']>,
): RouteDefinition {
  return {
    ...route,
    routeOptions: {
      ...(route.routeOptions ?? {}),
      ...options,
    },
  };
}

/**
 * Create a public (unauthenticated) route definition.
 * @param method - HTTP method (GET, POST, PUT, DELETE, PATCH)
 * @param handler - Route handler function
 * @param schema - Optional validation schema
 * @returns RouteDefinition marked as public
 * @complexity O(1)
 */
export function publicRoute<Body = unknown, Response = unknown>(
  method: HttpMethod,
  handler: RouteHandler<Body, Response>,
  schema?: RouteSchema,
  openapi?: RouteOpenApiMeta,
): RouteDefinition {
  return {
    method,
    handler: handler as RouteHandler,
    isPublic: true,
    ...(schema !== undefined ? { schema } : {}),
    ...(openapi !== undefined ? { openapi } : {}),
  };
}

/**
 * Create a protected (authenticated) route definition.
 * @param method - HTTP method (GET, POST, PUT, DELETE, PATCH)
 * @param handler - Route handler function
 * @param roles - Required roles (string or array)
 * @param schema - Optional validation schema
 * @returns RouteDefinition marked as protected with roles
 * @complexity O(1)
 */
export function protectedRoute<Body = unknown, Response = unknown>(
  method: HttpMethod,
  handler: RouteHandler<Body, Response>,
  roles: string | string[] = [],
  schema?: RouteSchema,
  openapi?: RouteOpenApiMeta,
): RouteDefinition {
  return {
    method,
    handler: handler as RouteHandler,
    isPublic: false,
    roles: Array.isArray(roles) ? roles : roles !== '' ? [roles] : [],
    ...(Array.isArray(roles)
      ? roles.length === 1
        ? { auth: roles[0] }
        : {}
      : roles !== ''
        ? { auth: roles }
        : {}),
    ...(schema !== undefined ? { schema } : {}),
    ...(openapi !== undefined ? { openapi } : {}),
  };
}

/**
 * Create route helpers that narrow the generic route contract to a feature-local
 * context/request pair in one place.
 */
export function createScopedRouteHelpers<
  Context extends object,
  Request extends HttpRequest = HttpRequest,
>(
  adaptContext: (ctx: HandlerContext) => Context,
  adaptRequest?: (req: HttpRequest) => Request,
): {
  publicRoute: <Body = unknown, Response = unknown>(
    method: HttpMethod,
    handler: ScopedRouteHandler<Context, Body, Response, Request>,
    schema?: RouteSchema,
    openapi?: RouteOpenApiMeta,
  ) => RouteDefinition;
  protectedRoute: <Body = unknown, Response = unknown>(
    method: HttpMethod,
    handler: ScopedRouteHandler<Context, Body, Response, Request>,
    roles?: string | string[],
    schema?: RouteSchema,
    openapi?: RouteOpenApiMeta,
  ) => RouteDefinition;
} {
  const toRequest = adaptRequest ?? ((req: HttpRequest) => req as Request);

  function scopedPublicRoute<Body = unknown, Response = unknown>(
    method: HttpMethod,
    handler: ScopedRouteHandler<Context, Body, Response, Request>,
    schema?: RouteSchema,
    openapi?: RouteOpenApiMeta,
  ): RouteDefinition {
    return publicRoute(
      method,
      (ctx, body, req, reply) => handler(adaptContext(ctx), body as Body, toRequest(req), reply),
      schema,
      openapi,
    );
  }

  function scopedProtectedRoute<Body = unknown, Response = unknown>(
    method: HttpMethod,
    handler: ScopedRouteHandler<Context, Body, Response, Request>,
    roles: string | string[] = [],
    schema?: RouteSchema,
    openapi?: RouteOpenApiMeta,
  ): RouteDefinition {
    return protectedRoute(
      method,
      (ctx, body, req, reply) => handler(adaptContext(ctx), body as Body, toRequest(req), reply),
      roles,
      schema,
      openapi,
    );
  }

  return {
    publicRoute: scopedPublicRoute,
    protectedRoute: scopedProtectedRoute,
  };
}

// ============================================================================
// Route Registration (Fastify adapter)
// ============================================================================

export type AuthGuardFactory = (secret: string, ...allowedRoles: string[]) => RoutePreHandler;

export interface RouterOptions {
  prefix: string;
  jwtSecret: string;
  authGuardFactory: AuthGuardFactory;
  /** Logical module name for route registry, e.g. "auth", "users". Auto-derived from path if omitted. */
  module?: string;
}

/**
 * Detect whether a schema supports `safeParse` (ValidationSchema).
 * @complexity O(1)
 */
function hasSafeParse(s: unknown): s is ValidationSchema {
  if (typeof s !== 'object' || s === null || !('safeParse' in s)) return false;
  return typeof (s as Record<string, unknown>)['safeParse'] === 'function';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Derive the logical module name from a route path.
 * Example: "/api/auth/login" with prefix "/api" -> "auth"
 */
function deriveModule(fullPath: string, prefix: string): string {
  const relative = fullPath.replace(prefix, '').replace(/^\/+/, '');
  return relative.split('/')[0] ?? 'unknown';
}

function adaptRequest(req: unknown): HttpRequest {
  return req as HttpRequest;
}

function adaptReply(reply: unknown): HttpReply {
  return reply as HttpReply;
}

function resolveHandlerContext(req: unknown, fallbackContext: HandlerContext): HandlerContext {
  if (typeof req !== 'object' || req === null || !('context' in req)) {
    return fallbackContext;
  }

  const requestContext = (req as { context?: unknown }).context;
  if (typeof requestContext !== 'object' || requestContext === null) {
    return fallbackContext;
  }

  return requestContext;
}

function isOnSendDone(value: unknown): value is (error: Error | null, payload?: unknown) => void {
  return typeof value === 'function';
}

function adaptPreHandler(preHandler: RoutePreHandler) {
  return async (req: unknown, reply: unknown): Promise<void> => {
    await preHandler(adaptRequest(req), adaptReply(reply));
  };
}

function isReplySent(reply: unknown): boolean {
  if (typeof reply !== 'object' || reply === null) return false;
  const sent = (reply as { sent?: unknown }).sent;
  if (typeof sent === 'boolean') return sent;
  return (reply as { sentBody?: unknown }).sentBody !== undefined;
}

function adaptPreHandlers(preHandlers: RoutePreHandler[]) {
  if (preHandlers.length === 1) {
    return adaptPreHandler(preHandlers[0] as RoutePreHandler);
  }

  return async (req: unknown, reply: unknown): Promise<void> => {
    for (const preHandler of preHandlers) {
      await preHandler(adaptRequest(req), adaptReply(reply));
      if (isReplySent(reply)) return;
    }
  };
}

/**
 * Register all routes from a RouteMap into a Fastify instance.
 *
 * @param app - Fastify instance to register routes with
 * @param ctx - Handler context providing db, repos, log, etc.
 * @param routes - RouteMap of path -> RouteDefinition entries
 * @param options - Router options with prefix, jwtSecret, authGuardFactory
 * @complexity O(n) where n is the number of routes in the map
 */
export function registerRouteMap(
  app: RouteServerLike,
  ctx: HandlerContext,
  routes: RouteMap,
  options: RouterOptions,
): void {
  for (const [path, route] of routes) {
    const fullPath = `${options.prefix}/${path}`.replace(/\/+/g, '/');

    const baseOptions: RouteOptionsLike = {
      method: route.method,
      url: fullPath,
      ...(route.routeOptions?.bodyLimit !== undefined
        ? { bodyLimit: route.routeOptions.bodyLimit }
        : {}),
      handler: async (req: unknown, reply: unknown) => {
        let body: unknown = adaptRequest(req).body;

        // Validate body with ValidationSchema if present
        if (route.schema !== undefined && hasSafeParse(route.schema)) {
          const parseResult = route.schema.safeParse(body);
          if (!parseResult.success) {
            const errorMessage =
              parseResult.error instanceof Error ? parseResult.error.message : 'Validation failed';
            throw new RequestSchemaError([{ message: errorMessage }]);
          }
          body = parseResult.data;
        }

        const result = await route.handler(
          resolveHandlerContext(req, ctx),
          body,
          adaptRequest(req),
          adaptReply(reply),
        );

        // Handle `{ status, body }` and `{ status, wire }` response patterns used by handlers.
        if (
          result !== null &&
          result !== undefined &&
          typeof result === 'object' &&
          'status' in result &&
          typeof (result as Record<string, unknown>)['status'] === 'number' &&
          ('body' in result || 'wire' in result)
        ) {
          const typed = result as {
            status: number;
            body?: unknown;
            wire?: unknown;
          };
          const payload = 'body' in typed ? typed.body : typed.wire;
          void adaptReply(reply).status(typed.status).send(payload);
          return;
        }

        return result;
      },
    };

    // Determine auth requirements
    const sharedAuth = route.auth;
    const isPublic = route.isPublic;
    const roles = route.roles ?? (sharedAuth !== undefined ? [sharedAuth] : []);

    const preHandlers: RoutePreHandler[] = [];
    if (!isPublic) {
      preHandlers.push(options.authGuardFactory(options.jwtSecret, ...roles));
    }
    preHandlers.push(...(route.preHandlers ?? []));

    if (preHandlers.length > 0) {
      baseOptions.preHandler = adaptPreHandlers(preHandlers);
    }

    if (
      route.schema !== undefined &&
      typeof route.schema === 'object' &&
      !hasSafeParse(route.schema) &&
      'properties' in route.schema
    ) {
      baseOptions.schema = route.schema;
    }

    // Merge OpenAPI metadata into Fastify schema for @fastify/swagger
    if (route.openapi !== undefined) {
      const openapi = route.openapi;
      const schema = isRecord(baseOptions.schema) ? { ...baseOptions.schema } : {};

      if (openapi.summary !== undefined) schema['summary'] = openapi.summary;
      if (openapi.description !== undefined) schema['description'] = openapi.description;
      if (openapi.tags !== undefined) schema['tags'] = openapi.tags;
      if (openapi.body !== undefined) schema['body'] = openapi.body;
      if (openapi.params !== undefined) schema['params'] = openapi.params;
      if (openapi.querystring !== undefined) schema['querystring'] = openapi.querystring;
      if (openapi.response !== undefined) schema['response'] = openapi.response;
      if (openapi.hide !== undefined) schema['hide'] = openapi.hide;

      baseOptions.schema = schema;
    }

    // Auto-inject security metadata for Swagger
    {
      const schema = isRecord(baseOptions.schema) ? { ...baseOptions.schema } : {};
      if (route.openapi?.security !== undefined) {
        schema['security'] = route.openapi.security;
      } else if (!isPublic) {
        schema['security'] = [{ bearerAuth: [] }];
      }
      if (Object.keys(schema).length > 0) {
        baseOptions.schema = schema;
      }
    }

    // Add deprecation headers via onSend hook if route is deprecated
    if (route.deprecated !== undefined) {
      const deprecation = route.deprecated;
      app.addHook('onSend', (request: unknown, reply: unknown, ...args: unknown[]) => {
        const payload = args[0];
        const done = args[1];
        const req = request as Record<string, unknown>;
        const res = adaptReply(reply);
        if (
          req['url'] === fullPath ||
          (req['routeOptions'] as { url?: string } | undefined)?.url === path
        ) {
          res.header('Deprecation', 'true');
          if (deprecation.sunset !== undefined) {
            res.header('Sunset', deprecation.sunset);
          }
          if (deprecation.message !== undefined) {
            res.header('X-Deprecation-Notice', deprecation.message);
          }
        }
        if (isOnSendDone(done)) {
          done(null, payload);
        }
      });
    }

    app.route(baseOptions);

    // Feed the route registry
    registerRoute({
      path: fullPath,
      method: route.method,
      isPublic,
      roles,
      hasSchema: route.schema !== undefined,
      module: options.module ?? deriveModule(fullPath, options.prefix),
      deprecated: route.deprecated !== undefined,
      ...(route.openapi?.summary !== undefined ? { summary: route.openapi.summary } : {}),
      ...(route.openapi?.tags !== undefined ? { tags: route.openapi.tags } : {}),
    });
  }
}
