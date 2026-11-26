// main/apps/web/src/i18n/persistLocale.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockEnvironment, mockUser } from '../__tests__/utils';

import { applyLocalePreference, LOCALE_STORAGE_KEY, syncLocaleToProfile } from './persistLocale';

describe('persistLocale', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('lang');
    document.documentElement.removeAttribute('dir');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    document.documentElement.removeAttribute('lang');
    document.documentElement.removeAttribute('dir');
  });

  it('rejects unsupported locales without mutating state, storage, or DOM', () => {
    const setLocale = vi.fn();
    expect(applyLocalePreference('xx-XX', { setLocale })).toBe(false);
    expect(setLocale).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.getAttribute('lang')).toBeNull();
  });

  it('persists supported locales locally and skips server sync when signed out', () => {
    const setLocale = vi.fn();
    const request = vi.fn().mockResolvedValue(mockUser);
    const environment = createMockEnvironment({ isAuthenticated: false });
    environment.transport = { request } as unknown as NonNullable<typeof environment.transport>;

    expect(applyLocalePreference('ko-KR', { setLocale, environment })).toBe(true);
    expect(setLocale).toHaveBeenCalledWith('ko-KR');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('ko-KR');
    expect(document.documentElement.getAttribute('lang')).toBe('ko-KR');
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
    expect(request).not.toHaveBeenCalled();
  });

  it('syncs language to PATCH /api/users/me/update when authenticated and tolerates failures', async () => {
    const setLocale = vi.fn();
    const request = vi.fn().mockRejectedValueOnce(new Error('network offline'));
    const environment = createMockEnvironment({ user: mockUser, isAuthenticated: true });
    environment.transport = { request } as unknown as NonNullable<typeof environment.transport>;

    expect(applyLocalePreference('ko-KR', { setLocale, environment })).toBe(true);
    await Promise.resolve();
    expect(request).toHaveBeenCalledWith(
      '/api/users/me/update',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ language: 'ko-KR' }),
      }),
    );

    // Direct call with undefined environment is a clean no-op
    expect(() => {
      syncLocaleToProfile('en-US', undefined);
    }).not.toThrow();
  });
});
