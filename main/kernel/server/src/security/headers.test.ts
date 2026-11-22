// main/kernel/server/src/security/headers.test.ts
import { describe, expect, it } from 'vitest';

import { API_CSP } from './csp';
import { generateSecurityHeaders, getProductionSecurityDefaults } from './headers';

describe('security headers', () => {
  it('generates production security defaults with strict CSP and HSTS', () => {
    const defaults = getProductionSecurityDefaults();
    expect(defaults.csp).toBe(API_CSP);
    const headers = generateSecurityHeaders(defaults);
    expect(headers['Content-Security-Policy']).toBe(API_CSP);
    expect(headers['Strict-Transport-Security']).toBe(
      'max-age=31536000; includeSubDomains; preload',
    );
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['X-XSS-Protection']).toBe('0');
  });

  it('omits optional headers when unset and respects hstsIncludeSubDomains=false', () => {
    const headers = generateSecurityHeaders({ hstsIncludeSubDomains: false });
    expect(headers['Content-Security-Policy']).toBeUndefined();
    expect(headers['Permissions-Policy']).toBeUndefined();
    expect(headers['Strict-Transport-Security']).toBe('max-age=31536000');
  });
});
