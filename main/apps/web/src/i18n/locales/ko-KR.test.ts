// main/apps/web/src/i18n/locales/ko-KR.test.ts
import { describe, expect, it } from 'vitest';

import { enUS } from './en-US';
import { koKR } from './ko-KR';

function extractPlaceholders(template: string): string[] {
  return [...template.matchAll(/\{([a-zA-Z0-9_]+)\}/gu)].map((m) => m[1] ?? '').sort();
}

describe('ko-KR app locale bundle', () => {
  it('matches every en-US key with a non-empty Korean translation and identical placeholders', () => {
    const enKeys = Object.keys(enUS).sort();
    const koKeys = Object.keys(koKR).sort();

    expect(koKeys).toEqual(enKeys);
    for (const key of enKeys) {
      const value = koKR[key];
      expect(typeof value).toBe('string');
      expect(value?.trim().length).toBeGreaterThan(0);
      expect(extractPlaceholders(value ?? '')).toEqual(extractPlaceholders(enUS[key] ?? ''));
    }
  });
});
