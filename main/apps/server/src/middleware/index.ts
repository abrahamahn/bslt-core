// main/apps/server/src/middleware/index.ts
/**
 * HTTP Middleware
 *
 * Security middleware and HTTP utilities for Fastify applications.
 */

export { registerCompression } from './compression';
export { registerCookies, signCookie, unsignCookie } from './cookie';
export {
  generateCorrelationId,
  getValidatedClientIp,
  hasDangerousKeys,
  ipMatchesCidr,
  isFromTrustedProxy,
  isValidIp,
  isValidIpv4,
  isValidIpv6,
  parseCidr,
  parseCookies,
  parseMultipartFile,
  parseXForwardedFor,
  sanitizePrototype,
  serializeCookie,
  validateCidrList,
  type CookieOptions,
  type ParsedMultipartFile,
} from '@bslt/server-system/http';
export {
  registerCorrelationIdHook,
  registerMultipartFormParser,
  registerPrototypePollutionProtection,
  registerRequestInfoHook,
  type CorrelationIdOptions,
} from '../plugin';
export { registerCsrf } from './csrf';
export {
  createGeoBlockMiddleware,
  createGeoProvider,
  HeaderGeoAdapter,
  NullGeoAdapter,
} from './geo';
export {
  DEFAULT_LOCALE,
  parseAcceptLanguage,
  registerLocaleHook,
  resolveLocale,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from './locale';
export { applyApiCacheHeaders, applyCors, applySecurityHeaders, handlePreflight } from './security';
export {
  detectNoSQLInjection,
  detectSQLInjection,
  getInjectionErrors,
  getProductionSecurityDefaults,
  sanitizeObject,
  sanitizeString,
  type SanitizationResult,
  type SecurityHeaderOptions,
  type ValidationOptions,
} from '@bslt/server-system/security';
export { registerStaticServe } from './static';
export { registerInputValidation } from './validation';
export { createPaginationMiddleware, type PaginationRequest } from './pagination';
export { createPaginationHelpers, type PaginationHelpers } from '@bslt/db';
