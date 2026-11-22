// main/modules/compliance/web/consent/gate.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadConsentedScript, resetConsentedScripts } from './gate';
import { CONSENT_STORAGE_KEY, resetConsentCache, writeConsent } from './store';

const ANALYTICS_SRC = 'https://analytics.example.com/tag.js';
const ADS_SRC = 'https://ads.example.com/tag.js';

let appended: string[] = [];

beforeEach(() => {
  window.localStorage.clear();
  resetConsentCache();
  resetConsentedScripts();
  appended = [];
  const real = document.head.appendChild.bind(document.head);
  vi.spyOn(document.head, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
    if (node instanceof HTMLScriptElement) appended.push(node.src);
    return real(node);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.head.querySelectorAll('script').forEach((s) => {
    s.remove();
  });
  delete (navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl;
  window.localStorage.clear();
  resetConsentCache();
  resetConsentedScripts();
});

describe('loadConsentedScript', () => {
  it('appends nothing when absent, denied, unset, tampered, empty src, or blocked by GPC', () => {
    expect(loadConsentedScript({ category: 'analytics', src: ANALYTICS_SRC })).toBe(false);
    writeConsent({ analytics: 'denied', ads: 'unset' });
    expect(loadConsentedScript({ category: 'analytics', src: ANALYTICS_SRC })).toBe(false);
    expect(loadConsentedScript({ category: 'ads', src: ADS_SRC })).toBe(false);

    window.localStorage.setItem(CONSENT_STORAGE_KEY, '{"bad":true}');
    resetConsentCache();
    expect(loadConsentedScript({ category: 'analytics', src: ANALYTICS_SRC })).toBe(false);

    writeConsent({ analytics: 'granted', ads: 'granted' });
    expect(loadConsentedScript({ category: 'analytics', src: '' })).toBe(false);

    Object.defineProperty(navigator, 'globalPrivacyControl', { value: true, configurable: true });
    expect(loadConsentedScript({ category: 'ads', src: ADS_SRC })).toBe(false);
    expect(appended).toEqual([]);
  });

  it('appends once when granted and runs prepare before append', () => {
    writeConsent({ analytics: 'granted' });
    let countDuringPrepare = -1;
    expect(
      loadConsentedScript({
        category: 'analytics',
        src: ANALYTICS_SRC,
        prepare: () => {
          countDuringPrepare = appended.length;
        },
      }),
    ).toBe(true);
    expect(loadConsentedScript({ category: 'analytics', src: ANALYTICS_SRC })).toBe(true);
    expect(countDuringPrepare).toBe(0);
    expect(appended).toEqual([ANALYTICS_SRC]);
  });
});
