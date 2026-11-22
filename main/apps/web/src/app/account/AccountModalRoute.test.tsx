// main/apps/web/src/app/account/AccountModalRoute.test.tsx
import { serializeCapabilityContext } from '@bslt/contract';
import { CapabilityProvider, EMPTY_CAPABILITY_CONTEXT } from '@bslt/web-platform';
import { render, waitFor } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hasBillingModule } from '../../generated/modules';

import { ProfileModalRoute, SettingsModalRoute } from './AccountModalRoute';
import { closeAccountModal, getAccountModalState } from './accountModalStore';

const { mockNavigate, mockLocation } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockLocation: { pathname: '/settings', search: '', hash: '' },
}));

vi.mock('@bslt/react/router', () => ({
  useLocation: () => mockLocation,
  useNavigate: () => mockNavigate,
}));

beforeEach(() => {
  mockNavigate.mockClear();
  mockLocation.pathname = '/settings';
  mockLocation.search = '';
  mockLocation.hash = '';
});

afterEach(() => {
  act(() => {
    closeAccountModal();
  });
});

describe('SettingsModalRoute', () => {
  it('opens the modal at the section resolved from ?tab=', () => {
    mockLocation.search = '?tab=security';
    render(<SettingsModalRoute />);
    expect(getAccountModalState()).toMatchObject({ open: true, section: 'security' });
  });

  it('resolves hash and path-segment forms with aliases', () => {
    mockLocation.pathname = '/settings/privacy';
    render(<SettingsModalRoute />);
    expect(getAccountModalState()).toMatchObject({ open: true, section: 'data-controls' });
  });

  it('defaults to profile', () => {
    render(<SettingsModalRoute />);
    expect(getAccountModalState()).toMatchObject({ open: true, section: 'profile' });
  });

  it.runIf(hasBillingModule)('redirects tab=billing to the billing page when enabled', () => {
    mockLocation.search = '?tab=billing';
    render(
      <CapabilityProvider
        initialContext={{
          ...EMPTY_CAPABILITY_CONTEXT,
          flags: { 'flags.billing': true },
        }}
      >
        <SettingsModalRoute />
      </CapabilityProvider>,
    );
    expect(mockNavigate).toHaveBeenCalledWith('/settings/billing', { replace: true });
    expect(getAccountModalState().open).toBe(false);
  });

  it.runIf(hasBillingModule)(
    'redirects tab=billing back to /settings when billing is disabled',
    () => {
      mockLocation.search = '?tab=billing';
      render(<SettingsModalRoute />);
      expect(mockNavigate).toHaveBeenCalledWith('/settings', { replace: true });
    },
  );

  it.runIf(hasBillingModule)(
    "does not resolve tab=billing while the viewer's context is loading",
    async () => {
      mockLocation.search = '?tab=billing';
      let answer!: (value: unknown) => void;
      const request = vi.fn(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      );
      render(
        <CapabilityProvider transport={{ request }} viewerKey={null}>
          <SettingsModalRoute />
        </CapabilityProvider>,
      );

      // Billing off is not known yet: redirecting now would replace the URL for good.
      expect(mockNavigate).not.toHaveBeenCalled();

      await act(async () => {
        answer(
          serializeCapabilityContext({
            ...EMPTY_CAPABILITY_CONTEXT,
            flags: { 'flags.billing': true },
          }),
        );
      });
      expect(mockNavigate).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith('/settings/billing', { replace: true });
    },
  );

  it.runIf(hasBillingModule)(
    'sends tab=billing to /settings once the context request has failed',
    async () => {
      mockLocation.search = '?tab=billing';
      const request = vi.fn(() => Promise.reject(new Error('Context unavailable')));
      render(
        <CapabilityProvider transport={{ request }} viewerKey={null}>
          <SettingsModalRoute />
        </CapabilityProvider>,
      );

      // 'error' is settled and denies: waiting on it would hold the URL for good.
      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/settings', { replace: true });
      });
      expect(mockNavigate).toHaveBeenCalledTimes(1);
      expect(request).toHaveBeenCalledTimes(2);
    },
  );

  it('closes the modal when the route unmounts', () => {
    const { unmount } = render(<SettingsModalRoute />);
    expect(getAccountModalState().open).toBe(true);
    unmount();
    expect(getAccountModalState().open).toBe(false);
  });
});

describe('ProfileModalRoute', () => {
  it('opens the modal at the profile section and closes on unmount', () => {
    mockLocation.pathname = '/profile';
    const { unmount } = render(<ProfileModalRoute />);
    expect(getAccountModalState()).toMatchObject({ open: true, section: 'profile' });
    unmount();
    expect(getAccountModalState().open).toBe(false);
  });
});
