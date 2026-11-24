// main/apps/web/src/app/onboarding/onboardingState.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isChecklistDismissed,
  isOnboardingCompleted,
  setChecklistDismissed,
  setOnboardingCompleted,
} from './onboardingState';

describe('onboardingState', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('returns false for missing or blank user IDs and does not write storage', () => {
    setOnboardingCompleted(undefined, true);
    setOnboardingCompleted('   ', true);
    setChecklistDismissed(undefined, true);
    setChecklistDismissed('', true);

    expect(isOnboardingCompleted(undefined)).toBe(false);
    expect(isOnboardingCompleted('   ')).toBe(false);
    expect(isChecklistDismissed(undefined)).toBe(false);
    expect(window.localStorage.length).toBe(0);
  });

  it('persists and clears completion and checklist dismissal per user', () => {
    setOnboardingCompleted('user-a', true);
    setChecklistDismissed('user-a', true);

    expect(isOnboardingCompleted('user-a')).toBe(true);
    expect(isOnboardingCompleted('user-b')).toBe(false);
    expect(isChecklistDismissed('user-a')).toBe(true);
    expect(isChecklistDismissed('user-b')).toBe(false);

    setOnboardingCompleted('user-a', false);
    setChecklistDismissed('user-a', false);
    expect(isOnboardingCompleted('user-a')).toBe(false);
    expect(isChecklistDismissed('user-a')).toBe(false);
  });

  it('handles storage errors gracefully without throwing', () => {
    const getSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    expect(() => setOnboardingCompleted('user-a', true)).not.toThrow();
    expect(isOnboardingCompleted('user-a')).toBe(false);

    getSpy.mockRestore();
    setSpy.mockRestore();
  });
});
