// main/kernel/server/src/http/index.ts
export {
  clearRegistry,
  getRegisteredRoutes,
  registerRoute,
  type RouteRegistryEntry,
} from './route.registry';
export {
  createScopedRouteHelpers,
  createRouteMap,
  getRouteDefinition,
  protectedRoute,
  publicRoute,
  registerRouteMap,
  withRouteOptions,
  withRoutePreHandlers,
  type AuthGuardFactory,
  type HandlerContext,
  type JsonSchemaObject,
  type RouteDefinition,
  type RouteHandler,
  type RouteMap,
  type RouteOpenApiMeta,
  type RouteSchema,
  type RouterOptions,
  type ValidationSchema,
} from './routing';
export {
  createHttpServer,
  httpErrorCodes,
  type HookDoneFunction,
  type HttpPlugin,
  type HttpRequestPayload,
  type HttpServer,
  type HttpServerReply,
  type HttpServerRequest,
  type InjectOptions,
  type InjectResponse,
  type PreParsingHookHandler,
} from './server';
export type { HttpMethod } from './types';
export {
  createLogRequestContext,
  generateCorrelationId,
  getAuthenticatedUser,
  getOrCreateCorrelationId,
  isValidCorrelationId,
  requireAuthenticatedUser,
} from './request-context';
export { parseCookies, serializeCookie, type CookieOptions } from './cookies';
export { extractCsrfToken } from './csrf';
export { type HttpReply, type HttpRequest } from './http';
export { getMimeType } from './mime';
export { parseMultipartFile, type ParsedMultipartFile } from './multipart';
export { hasDangerousKeys, sanitizePrototype } from './object';
export {
  getValidatedClientIp,
  ipMatchesCidr,
  isFromTrustedProxy,
  isValidIp,
  isValidIpv4,
  isValidIpv6,
  parseCidr,
  parseXForwardedFor,
  validateCidrList,
} from './proxy';
export { extractIpAddress, extractUserAgent, getRequesterId } from './request';
