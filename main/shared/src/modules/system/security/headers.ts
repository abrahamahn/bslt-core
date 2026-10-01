// main/shared/src/modules/system/security/headers.ts
/**
 * Framework-agnostic security header generation helpers.
 */

import { API_CSP } from './csp';

/** Options for security header generation. */
export interface SecurityHeaderOptions {
  /** Content Security Policy (CSP) directive string */
  csp?: string;
  /** HSTS duration in seconds (default: 31,536,000 / 1 year) */
  hstsMaxAge?: number;
  /** Whether to include HSTS includeSubDomains directive */
  hstsIncludeSubDomains?: boolean;
  /** Whether to include HSTS preload directive */
  hstsPreload?: boolean;
  /** X-Frame-Options value (default: DENY) */
  frameOptions?: 'DENY' | 'SAMEORIGIN';
  /** X-Content-Type-Options value (default: nosniff) */
  contentTypeOptions?: 'nosniff';
  /** Referrer-Policy value (default: strict-origin-when-cross-origin) */
  referrerPolicy?: string;
  /** Permissions-Policy directive string */
  permissionsPolicy?: string;
}

/** Record of security header keys and values. */
export type SecurityHeaders = Record<string, string>;

/**
 * Generate a record of security headers based on the provided options.
 *
 * @param options - Configuration options for the security headers
 * @returns A record of security header names and their values
 */
export function generateSecurityHeaders(options: SecurityHeaderOptions = {}): SecurityHeaders {
  const headers: SecurityHeaders = {};

  if (options.csp != null) {
    headers['Content-Security-Policy'] = options.csp;
  }

  const hstsMaxAge = options.hstsMaxAge ?? 31536000;
  let hstsValue = `max-age=${String(hstsMaxAge)}`;
  if (options.hstsIncludeSubDomains !== false) hstsValue += '; includeSubDomains';
  if (options.hstsPreload === true) hstsValue += '; preload';
  headers['Strict-Transport-Security'] = hstsValue;

  headers['X-Frame-Options'] = options.frameOptions ?? 'DENY';
  headers['X-Content-Type-Options'] = options.contentTypeOptions ?? 'nosniff';
  headers['Referrer-Policy'] = options.referrerPolicy ?? 'strict-origin-when-cross-origin';
  headers['X-XSS-Protection'] = '0';

  if (options.permissionsPolicy != null) {
    headers['Permissions-Policy'] = options.permissionsPolicy;
  }

  return headers;
}

/**
 * Get recommended security header defaults for production environments.
 *
 * @returns A set of secure default options
 */
export function getProductionSecurityDefaults(): SecurityHeaderOptions {
  return {
    // Built from the shared policy in `./csp`, never hand-written here: the same
    // script-src also ships in the Caddyfile, and a second copy would drift.
    csp: API_CSP,
    hstsMaxAge: 31536000,
    hstsIncludeSubDomains: true,
    hstsPreload: true,
    frameOptions: 'DENY',
    contentTypeOptions: 'nosniff',
    referrerPolicy: 'strict-origin-when-cross-origin',
  };
}
