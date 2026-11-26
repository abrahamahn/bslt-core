// main/kernel/contract/src/constants.test.ts
import { describe, expect, it } from 'vitest';

import {
  ACCESS_TOKEN_COOKIE_NAME,
  API_PREFIX,
  AUTH_CONSTANTS,
  AUTH_STRATEGIES,
  AUTH_VALIDATION,
  CSRF_COOKIE_NAME,
  CSRF_EXEMPT_PATHS,
  DEFAULT_LOCALE,
  DEFAULT_PAGE_LIMIT,
  LIMITS,
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  MS_PER_SECOND,
  REFRESH_TOKEN_COOKIE_NAME,
  SAFE_METHODS,
  SECONDS_PER_DAY,
  SECONDS_PER_MINUTE,
  SUPPORTED_LOCALES,
} from './constants';

describe('contract platform and time constants', () => {
  it('enforces security minimums on AUTH_VALIDATION thresholds', () => {
    expect(AUTH_VALIDATION.MIN_SECRET_LENGTH).toBeGreaterThanOrEqual(32);
    expect(AUTH_VALIDATION.PASSWORD_MIN_LENGTH).toBeGreaterThanOrEqual(8);
    expect(AUTH_VALIDATION.LOCKOUT_MIN_ATTEMPTS).toBeLessThan(AUTH_VALIDATION.LOCKOUT_MAX_ATTEMPTS);
  });

  it('keeps CSRF_EXEMPT_PATHS strictly scoped to pre-session auth endpoints and excludes mutating account paths', () => {
    expect(CSRF_EXEMPT_PATHS.has('/api/auth/login')).toBe(true);
    expect(CSRF_EXEMPT_PATHS.has('/api/auth/refresh')).toBe(true);
    expect(CSRF_EXEMPT_PATHS.has('/api/auth/sso/discover')).toBe(true);
    expect(CSRF_EXEMPT_PATHS.has('/api/growth/waitlist/join')).toBe(true);
    expect(CSRF_EXEMPT_PATHS.has('/api/users/me')).toBe(false);
    expect(CSRF_EXEMPT_PATHS.has('/api/auth/logout-all')).toBe(false);
  });

  it('restricts SAFE_METHODS to idempotent read verbs and excludes POST/PUT/PATCH/DELETE', () => {
    expect(SAFE_METHODS.has('GET')).toBe(true);
    expect(SAFE_METHODS.has('HEAD')).toBe(true);
    expect(SAFE_METHODS.has('OPTIONS')).toBe(true);
    expect(SAFE_METHODS.has('POST')).toBe(false);
    expect(SAFE_METHODS.has('DELETE')).toBe(false);
  });

  it('ships en-US and ko-KR in SUPPORTED_LOCALES with en-US as default', () => {
    expect(DEFAULT_LOCALE).toBe('en-US');
    expect(SUPPORTED_LOCALES).toEqual(['en-US', 'ko-KR']);
  });

  it('maintains consistent time, cookie, pagination, and strategy constants', () => {
    expect(MS_PER_MINUTE).toBe(60 * MS_PER_SECOND);
    expect(MS_PER_HOUR).toBe(60 * MS_PER_MINUTE);
    expect(MS_PER_DAY).toBe(24 * MS_PER_HOUR);
    expect(SECONDS_PER_DAY).toBe(24 * 60 * SECONDS_PER_MINUTE);
    expect(API_PREFIX).toBe(AUTH_CONSTANTS.API_PREFIX);
    expect(ACCESS_TOKEN_COOKIE_NAME).toBe(AUTH_CONSTANTS.ACCESS_TOKEN_COOKIE_NAME);
    expect(REFRESH_TOKEN_COOKIE_NAME).toBe(AUTH_CONSTANTS.REFRESH_TOKEN_COOKIE_NAME);
    expect(CSRF_COOKIE_NAME).toBe(AUTH_CONSTANTS.CSRF_COOKIE_NAME);
    expect(DEFAULT_PAGE_LIMIT).toBe(LIMITS.DEFAULT_PAGE_SIZE);
    expect(AUTH_STRATEGIES).toContain('local');
  });
});
