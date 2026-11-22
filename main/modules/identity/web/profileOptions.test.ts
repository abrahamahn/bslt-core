// main/modules/identity/web/profileOptions.test.ts
import { describe, expect, it } from 'vitest';

import { PROFILE_COUNTRIES, PROFILE_LANGUAGES, PROFILE_US_STATES } from './profileOptions';

describe('profileOptions', () => {
  it('EXCLUDES non-state territories (DC, PR, GU, VI, AS, MP) from PROFILE_US_STATES', () => {
    const codes = new Set(PROFILE_US_STATES.map((s) => s.code));
    expect(codes.has('DC')).toBe(false);
    expect(codes.has('PR')).toBe(false);
    expect(codes.has('GU')).toBe(false);
    expect(codes.has('VI')).toBe(false);
    expect(codes.has('AS')).toBe(false);
    expect(codes.has('MP')).toBe(false);
    expect(PROFILE_US_STATES).toHaveLength(50);
  });

  it('REJECTS empty or unsorted language and country entries', () => {
    expect(PROFILE_COUNTRIES.length).toBeGreaterThan(190);
    expect(PROFILE_COUNTRIES.every((c) => /^[A-Z]{2}$/.test(c.code) && c.name.length > 0)).toBe(
      true,
    );
    expect(PROFILE_LANGUAGES.length).toBeGreaterThan(180);
    const sorted = [...PROFILE_LANGUAGES].sort((a, b) => a.localeCompare(b));
    expect(PROFILE_LANGUAGES).toEqual(sorted);
  });
});
