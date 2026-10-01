// main/shared/src/modules/system/security/index.ts

export { addAuthHeader, createTokenStore, tokenStore, type TokenStore } from './crypto';

export {
  detectNoSQLInjection,
  detectSQLInjection,
  isValidInputKeyName,
  sanitizeString,
  type SQLInjectionDetectionOptions,
} from './input';

// The policy itself, and the check that a policy permits no inline script. The
// parser/serializer behind them stay module-internal: `headers.ts` and the
// `audit:csp` guard import them from './csp' directly, and nothing else has any
// business re-serializing a CSP.
export { API_CSP, EDGE_CSP, findUnsafeScriptSources } from './csp';

export {
  generateSecurityHeaders,
  getProductionSecurityDefaults,
  type SecurityHeaderOptions,
  type SecurityHeaders,
} from './headers';

export { ipv4ToInt, parseIpv4Cidr, isIpv4InCidrRange, type Ipv4CidrRange } from './ip';
export { createRateLimiter, type RateLimitInfo } from './rate.limit';

export {
  getInjectionErrors,
  sanitizeObject,
  type SanitizationResult,
  type ValidationOptions,
} from './sanitization';
