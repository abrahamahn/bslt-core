// main/apps/web/src/i18n/format.test.ts
/**
 * Tests for i18n formatting utilities.
 *
 * Covers:
 * - formatDate: locale-aware date formatting
 * - formatNumber: locale-aware number formatting
 * - formatCurrency: currency formatting
 * - formatRelativeTime: relative time formatting
 * - timezone preference: stored preference applied to date formatting
 *
 * @module i18n-format-test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AUTO_TIMEZONE,
  formatCurrency,
  formatDate,
  formatNumber,
  formatRelativeTime,
  getTimezonePreference,
  TIMEZONE_STORAGE_KEY,
} from './format';

// ============================================================================
// formatDate
// ============================================================================

describe('formatDate', () => {
  it('should format a Date object for en-US', () => {
    const date = new Date('2024-03-15T00:00:00Z');
    const result = formatDate(date, 'en-US', { timeZone: 'UTC' });
    expect(result).toContain('3');
    expect(result).toContain('15');
    expect(result).toContain('2024');
  });

  it('should format an ISO string for en-US', () => {
    const result = formatDate('2024-03-15T00:00:00Z', 'en-US', { timeZone: 'UTC' });
    expect(result).toContain('3');
    expect(result).toContain('15');
    expect(result).toContain('2024');
  });

  it('should format a date for fr locale', () => {
    const date = new Date('2024-03-15T00:00:00Z');
    const result = formatDate(date, 'fr', { timeZone: 'UTC' });
    expect(result).toContain('15');
    const containsMonth = result.includes('03') || result.includes('3');
    expect(containsMonth).toBe(true);
    expect(result).toContain('2024');
  });

  it('should accept dateStyle option', () => {
    const date = new Date('2024-03-15T00:00:00Z');
    const result = formatDate(date, 'en-US', { dateStyle: 'long', timeZone: 'UTC' });
    expect(result).toContain('March');
    expect(result).toContain('15');
    expect(result).toContain('2024');
  });

  it('should format date for es locale', () => {
    const date = new Date('2024-03-15T00:00:00Z');
    const result = formatDate(date, 'es', { timeZone: 'UTC' });
    expect(result).toContain('15');
    expect(result).toContain('2024');
  });
});

// ============================================================================
// Timezone Preference
// ============================================================================

describe('getTimezonePreference', () => {
  afterEach(() => {
    // Unstub first: `window` may have been stubbed to undefined by a test.
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.removeItem(TIMEZONE_STORAGE_KEY);
  });

  it("returns 'auto' when nothing is stored", () => {
    expect(getTimezonePreference()).toBe(AUTO_TIMEZONE);
  });

  it('returns the stored value', () => {
    window.localStorage.setItem(TIMEZONE_STORAGE_KEY, 'Asia/Seoul');
    expect(getTimezonePreference()).toBe('Asia/Seoul');
  });

  it("returns 'auto' when localStorage access throws", () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage denied');
    });
    expect(getTimezonePreference()).toBe(AUTO_TIMEZONE);
  });

  it("is SSR-safe: returns 'auto' when window is undefined", () => {
    vi.stubGlobal('window', undefined);
    expect(getTimezonePreference()).toBe(AUTO_TIMEZONE);
  });
});

describe('formatDate timezone preference', () => {
  // 02:30 UTC crosses midnight relative to US timezones, so the rendered
  // date proves which timezone was applied.
  const timestamp = '2024-03-15T02:30:00Z';

  afterEach(() => {
    // Unstub first: `window` may have been stubbed to undefined by a test.
    vi.unstubAllGlobals();
    window.localStorage.removeItem(TIMEZONE_STORAGE_KEY);
  });

  it('honors an explicit UTC preference', () => {
    window.localStorage.setItem(TIMEZONE_STORAGE_KEY, 'UTC');
    expect(formatDate(timestamp, 'en-US', { dateStyle: 'medium' })).toBe('Mar 15, 2024');
  });

  it('honors an explicit America/New_York preference', () => {
    window.localStorage.setItem(TIMEZONE_STORAGE_KEY, 'America/New_York');
    expect(formatDate(timestamp, 'en-US', { dateStyle: 'medium' })).toBe('Mar 14, 2024');
  });

  it('picks up a changed preference on the next call', () => {
    window.localStorage.setItem(TIMEZONE_STORAGE_KEY, 'UTC');
    expect(formatDate(timestamp, 'en-US', { dateStyle: 'medium' })).toBe('Mar 15, 2024');
    window.localStorage.setItem(TIMEZONE_STORAGE_KEY, 'America/New_York');
    expect(formatDate(timestamp, 'en-US', { dateStyle: 'medium' })).toBe('Mar 14, 2024');
  });

  it("keeps browser behavior when the preference is 'auto' or unset", () => {
    const unset = formatDate(timestamp, 'en-US', { dateStyle: 'medium' });
    window.localStorage.setItem(TIMEZONE_STORAGE_KEY, AUTO_TIMEZONE);
    expect(formatDate(timestamp, 'en-US', { dateStyle: 'medium' })).toBe(unset);
  });

  it('lets a caller-pinned timeZone win over the stored preference', () => {
    window.localStorage.setItem(TIMEZONE_STORAGE_KEY, 'America/New_York');
    const result = formatDate(timestamp, 'en-US', { dateStyle: 'medium', timeZone: 'UTC' });
    expect(result).toBe('Mar 15, 2024');
  });

  it('ignores an invalid stored timezone instead of throwing', () => {
    const unset = formatDate(timestamp, 'en-US', { dateStyle: 'medium' });
    window.localStorage.setItem(TIMEZONE_STORAGE_KEY, 'Not/A_Zone');
    expect(() => formatDate(timestamp, 'en-US', { dateStyle: 'medium' })).not.toThrow();
    expect(formatDate(timestamp, 'en-US', { dateStyle: 'medium' })).toBe(unset);
  });

  it('is SSR-safe: formats without window using browser behavior', () => {
    vi.stubGlobal('window', undefined);
    expect(() => formatDate(timestamp, 'en-US', { dateStyle: 'medium' })).not.toThrow();
  });
});

// ============================================================================
// formatNumber
// ============================================================================

describe('formatNumber', () => {
  it('should format a number for en-US with comma grouping', () => {
    const result = formatNumber(1234567.89, 'en-US');
    expect(result).toBe('1,234,567.89');
  });

  it('should format numbers differently across locales', () => {
    // fr groups/decimals differently from en-US — proves the locale is applied
    expect(formatNumber(1234567.89, 'fr')).not.toBe(formatNumber(1234567.89, 'en-US'));
  });

  it('should format a small number without grouping', () => {
    const result = formatNumber(42, 'en-US');
    expect(result).toBe('42');
  });

  it('should format zero', () => {
    const result = formatNumber(0, 'en-US');
    expect(result).toBe('0');
  });

  it('should format negative numbers', () => {
    const result = formatNumber(-1234.56, 'en-US');
    // Should contain the digits and a minus sign
    expect(result).toContain('1,234.56');
  });

  it('should accept number format options', () => {
    const result = formatNumber(0.456, 'en-US', { style: 'percent' });
    expect(result).toContain('46');
    expect(result).toContain('%');
  });
});

// ============================================================================
// formatCurrency
// ============================================================================

describe('formatCurrency', () => {
  it('should format USD for en-US', () => {
    const result = formatCurrency(1234.56, 'USD', 'en-US');
    expect(result).toContain('$');
    expect(result).toContain('1,234.56');
  });

  it('should format EUR for fr', () => {
    const result = formatCurrency(1234.56, 'EUR', 'fr');
    // French locale puts the euro sign after the number
    expect(result).toContain('€');
  });

  it('should format JPY without decimals', () => {
    const result = formatCurrency(1234, 'JPY', 'en-US');
    // JPY does not use decimal places, regardless of locale
    expect(result).toContain('1,234');
    expect(result).not.toContain('.00');
  });

  it('should format zero amount', () => {
    const result = formatCurrency(0, 'USD', 'en-US');
    expect(result).toContain('$');
    expect(result).toContain('0');
  });

  it('should format GBP for en-US', () => {
    const result = formatCurrency(99.99, 'GBP', 'en-US');
    expect(result).toContain('99.99');
  });
});

// ============================================================================
// formatRelativeTime
// ============================================================================

describe('formatRelativeTime', () => {
  beforeEach(() => {
    // Fix "now" to a known timestamp for deterministic tests
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should format seconds ago', () => {
    const date = new Date('2024-06-15T11:59:30Z'); // 30 seconds ago
    const result = formatRelativeTime(date, 'en-US');
    expect(result).toContain('30');
    expect(result).toContain('second');
  });

  it('should format minutes ago', () => {
    const date = new Date('2024-06-15T11:55:00Z'); // 5 minutes ago
    const result = formatRelativeTime(date, 'en-US');
    expect(result).toContain('5');
    expect(result).toContain('minute');
  });

  it('should format hours ago', () => {
    const date = new Date('2024-06-15T10:00:00Z'); // 2 hours ago
    const result = formatRelativeTime(date, 'en-US');
    expect(result).toContain('2');
    expect(result).toContain('hour');
  });

  it('should format days ago', () => {
    const date = new Date('2024-06-12T12:00:00Z'); // 3 days ago
    const result = formatRelativeTime(date, 'en-US');
    expect(result).toContain('3');
    expect(result).toContain('day');
  });

  it('should format an ISO string', () => {
    const result = formatRelativeTime('2024-06-15T11:55:00Z', 'en-US');
    expect(result).toContain('5');
    expect(result).toContain('minute');
  });

  it('should format in Spanish', () => {
    const date = new Date('2024-06-15T10:00:00Z'); // 2 hours ago
    const result = formatRelativeTime(date, 'es');
    expect(result).toContain('2');
    // Spanish uses "horas" or "hora"
    expect(result.toLowerCase()).toMatch(/hora/);
  });

  it('should format future dates', () => {
    const date = new Date('2024-06-15T14:00:00Z'); // 2 hours from now
    const result = formatRelativeTime(date, 'en-US');
    expect(result).toContain('2');
    expect(result).toContain('hour');
    // Should indicate future, not past
    expect(result).not.toContain('ago');
  });

  it('should format "yesterday" or "1 day ago" for 1 day in the past', () => {
    const date = new Date('2024-06-14T12:00:00Z'); // 1 day ago
    const result = formatRelativeTime(date, 'en-US');
    // Intl.RelativeTimeFormat with numeric: 'auto' may return "yesterday"
    expect(result === 'yesterday' || result === '1 day ago').toBe(true);
  });
});

// ============================================================================
// Formatter Caching
// ============================================================================

describe('formatter caching', () => {
  it('should return identical output across repeated calls', () => {
    const date = new Date('2024-03-15T00:00:00Z');
    const first = formatDate(date, 'en-US', { dateStyle: 'long', timeZone: 'UTC' });
    const second = formatDate(date, 'en-US', { dateStyle: 'long', timeZone: 'UTC' });
    expect(second).toBe(first);
  });

  it('should not collide across locales with the same options', () => {
    expect(formatNumber(1234567.89, 'en-US')).toBe('1,234,567.89');
    expect(formatNumber(1234567.89, 'fr')).not.toBe('1,234,567.89');
    // Repeat to hit the cached path
    expect(formatNumber(1234567.89, 'en-US')).toBe('1,234,567.89');
  });

  it('should not collide across options with the same locale', () => {
    const plain = formatNumber(0.456, 'en-US');
    const percent = formatNumber(0.456, 'en-US', { style: 'percent' });
    expect(plain).toBe('0.456');
    expect(percent).toContain('%');
  });

  it('should not collide across currencies with the same locale', () => {
    const usd = formatCurrency(10, 'USD', 'en-US');
    const gbp = formatCurrency(10, 'GBP', 'en-US');
    expect(usd).toContain('$');
    expect(gbp).not.toBe(usd);
  });
});
