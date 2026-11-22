// main/modules/compliance/web/consent/store.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CONSENT_STORAGE_KEY,
  honourGlobalPrivacyControl,
  hydrateConsent,
  readConsent,
  readGlobalPrivacyControl,
  resetConsentCache,
  startConsentSync,
  subscribeConsent,
  writeConsent,
} from './store';

function setGpc(value: unknown): void {
  if (value === undefined) {
    delete (navigator as { globalPrivacyControl?: unknown }).globalPrivacyControl;
    return;
  }
  Object.defineProperty(navigator, 'globalPrivacyControl', {
    value,
    configurable: true,
  });
}

beforeEach(() => {
  window.localStorage.clear();
  resetConsentCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  setGpc(undefined);
  window.localStorage.clear();
  resetConsentCache();
});

describe('consent store', () => {
  it('fails closed on missing, tampered, malformed, or throwing storage', () => {
    expect(readConsent()).toBeNull();

    window.localStorage.setItem(
      CONSENT_STORAGE_KEY,
      JSON.stringify({ ads: 'granted-please', analytics: 'granted', updatedAt: 'now' }),
    );
    resetConsentCache();
    expect(readConsent()).toBeNull();

    window.localStorage.setItem(CONSENT_STORAGE_KEY, '{not json');
    resetConsentCache();
    expect(readConsent()).toBeNull();

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    resetConsentCache();
    expect(readConsent()).toBeNull();
  });

  it('persists, hydrates without erasing unset answers, syncs across tabs, and honours GPC', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('QuotaExceededError');
    });
    expect(writeConsent({ ads: 'denied' }).ads).toBe('denied');
    expect(readConsent()?.ads).toBe('denied');

    writeConsent({ analytics: 'granted', ads: 'denied' });
    expect(hydrateConsent({ analytics: 'unset', ads: 'unset' })?.analytics).toBe('granted');

    setGpc('true');
    expect(readGlobalPrivacyControl()).toBe(false);
    setGpc(true);
    expect(readGlobalPrivacyControl()).toBe(true);
    writeConsent({ ads: 'granted' });
    expect(honourGlobalPrivacyControl()?.ads).toBe('denied');

    const stop = startConsentSync();
    const listener = vi.fn();
    const unsub = subscribeConsent(listener);
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated-key' }));
    expect(listener).not.toHaveBeenCalled();
    window.localStorage.setItem(
      CONSENT_STORAGE_KEY,
      JSON.stringify({ ads: 'denied', analytics: 'denied', updatedAt: '2026-07-15T00:00:00.000Z' }),
    );
    window.dispatchEvent(new StorageEvent('storage', { key: CONSENT_STORAGE_KEY }));
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
    stop();
  });
});
