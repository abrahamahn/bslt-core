// main/apps/web/src/app/account/accountModalStore.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ACCOUNT_MODAL_SECTIONS,
  closeAccountModal,
  getAccountModalState,
  isAccountModalSection,
  openAccountModal,
  setAccountModalSection,
  subscribeAccountModal,
} from './accountModalStore';

afterEach(() => {
  closeAccountModal();
  setAccountModalSection('profile');
});

describe('accountModalStore', () => {
  it('opens at the requested section and closes', () => {
    openAccountModal('security');
    expect(getAccountModalState()).toEqual({ open: true, section: 'security' });

    closeAccountModal();
    expect(getAccountModalState().open).toBe(false);
    // Section is retained for reopening.
    expect(getAccountModalState().section).toBe('security');
  });

  it('defaults to the profile section', () => {
    openAccountModal();
    expect(getAccountModalState()).toEqual({ open: true, section: 'profile' });
  });

  it('switches section while open', () => {
    openAccountModal('profile');
    setAccountModalSection('data-controls');
    expect(getAccountModalState()).toEqual({ open: true, section: 'data-controls' });
  });

  it('notifies subscribers and stops after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAccountModal(listener);

    openAccountModal('legal');
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    closeAccountModal();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('validates section names and freezes ACCOUNT_MODAL_SECTIONS', () => {
    expect(Object.isFrozen(ACCOUNT_MODAL_SECTIONS)).toBe(true);
    expect(ACCOUNT_MODAL_SECTIONS).not.toContain('billing');
    expect(isAccountModalSection('security')).toBe(true);
    expect(isAccountModalSection('billing')).toBe(false);
    expect(isAccountModalSection('')).toBe(false);
  });
});
