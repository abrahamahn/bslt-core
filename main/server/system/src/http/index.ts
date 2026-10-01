// main/server/system/src/http/index.ts
export {
  clearRegistry,
  getRegisteredRoutes,
  registerRoute,
  type RouteRegistryEntry,
} from './route.registry';
export {
  createScopedRouteHelpers,
  createRouteMap,
  protectedRoute,
  publicRoute,
  registerRouteMap,
  withRouteOptions,
  withRoutePreHandlers,
  type AuthGuardFactory,
  type HandlerContext,
  type JsonSchemaObject,
  type RouteDefinition,
  type RouteDeprecation,
  type RouteHandler,
  type RouteMap,
  type RouteOpenApiMeta,
  type RoutePreHandler,
  type RouteResult,
  type RouteSchema,
  type RouterOptions,
  type ScopedRouteHandler,
  type ValidationSchema,
} from './routing';
export type { HttpMethod } from './types';
export {
  createLogRequestContext,
  extractTraceId,
  generateCorrelationId,
  getAuthenticatedUser,
  getOrCreateCorrelationId,
  isValidCorrelationId,
  requireAuthenticatedUser,
} from './request-context';
export { type HttpReply, type HttpRequest } from '@bslt/shared/system';
