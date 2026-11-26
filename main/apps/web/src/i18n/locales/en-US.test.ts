// main/apps/web/src/i18n/locales/en-US.test.ts
import { describe, expect, it } from 'vitest';

import { enUS } from './en-US';

describe('en-US app locale bundle', () => {
  it('defines non-empty dot-namespaced keys with balanced interpolation braces', () => {
    const entries = Object.entries(enUS);
    expect(entries.length).toBeGreaterThan(0);

    for (const [key, value] of entries) {
      expect(key).toMatch(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/u);
      expect(value.trim().length).toBeGreaterThan(0);
      const opens = (value.match(/\{/gu) ?? []).length;
      const closes = (value.match(/\}/gu) ?? []).length;
      expect(opens).toBe(closes);
    }
  });
});
