// main/apps/server/src/middleware/index.ts
/**
 * HTTP Middleware
 *
 * Security middleware and HTTP utilities for Fastify applications.
 */

export { registerCookies, signCookie, unsignCookie, type CookiePluginOptions } from './cookie';
export {
  parseCookies,
  serializeCookie,
  type CookieOptions,
  type CookieSerializeOptions,
} from '@bslt/shared/system';
export { generateCorrelationId } from '@bslt/server-system/http';
export {
  registerCorrelationIdHook,
  registerMultipartFormParser,
  registerPrototypePollutionProtection,
  registerRequestInfoHook,
  type CorrelationIdOptions,
  type RequestInfo,
} from '../plugin';
export { registerCsrf, type CsrfOptions } from './csrf';
export {
  createGeoBlockMiddleware,
  createGeoProvider,
  HeaderGeoAdapter,
  NullGeoAdapter,
  type GeoBlockOptions,
  type HeaderGeoAdapterOptions,
} from './geo';
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
  type ForwardedInfo,
  type ProxyValidationConfig,
} from '@bslt/shared/system';
export {
  DEFAULT_LOCALE,
  parseAcceptLanguage,
  registerLocaleHook,
  resolveLocale,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from './locale';
export {
  applyApiCacheHeaders,
  applyCors,
  applySecurityHeaders,
  handlePreflight,
  type CorsOptions,
} from './security';
export { hasDangerousKeys, sanitizePrototype } from '@bslt/shared/helpers/object';
export { getProductionSecurityDefaults, type SecurityHeaderOptions } from '@bslt/shared/system';
export { registerStaticServe, type StaticServeOptions } from './static';
export { parseMultipartFile, type ParsedMultipartFile } from '@bslt/shared/system';
export { registerInputValidation } from './validation';
export {
  detectNoSQLInjection,
  detectSQLInjection,
  getInjectionErrors,
  sanitizeObject,
  sanitizeString,
  type SQLInjectionDetectionOptions,
  type SanitizationResult,
  type ValidationOptions,
} from '@bslt/shared/system';
export {
  createPaginationMiddleware,
  type PaginationContext,
  type PaginationMiddlewareOptions,
  type PaginationRequest,
} from './pagination';
export { createPaginationHelpers, type PaginationHelpers } from '@bslt/db';
export {
  createPermissionMiddleware,
  createStandalonePermissionGuard,
  getPermissionDenialReason,
  getRecordIdFromParams,
  hasPermission,
  type PermissionGuardOptions,
  type PermissionMiddlewareOptions,
  type PreHandlerHook,
} from './permissions';
