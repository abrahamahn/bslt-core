// main/apps/web/src/app/account/SettingsLayout.test.tsx
import { CapabilityProvider, EMPTY_CAPABILITY_CONTEXT } from '@bslt/web-platform';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hasBillingModule } from '../../generated/modules';

import { SettingsLayout } from './SettingsLayout';

import type { ReactElement } from 'react';

const { mockNavigate, mockLocation } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockLocation: { pathname: '/settings/profile', search: '', hash: '' },
}));

vi.mock('@bslt/react/router', () => ({
  Outlet: (): ReactElement => <div data-testid="settings-route-outlet" />,
  useLocation: () => mockLocation,
  useNavigate: () => mockNavigate,
}));

beforeEach(() => {
  mockNavigate.mockClear();
  mockLocation.pathname = '/settings/profile';
  mockLocation.search = '';
  mockLocation.hash = '';
});

describe('SettingsLayout', () => {
  it('renders child content inside the settings content panel and marks the active nav button', () => {
    render(
      <SettingsLayout activeSection="security">
        <div data-testid="custom-settings-child" />
      </SettingsLayout>,
    );

    expect(screen.getByTestId('custom-settings-child')).toBeInTheDocument();
    expect(screen.queryByTestId('settings-route-outlet')).toBeNull();
    expect(screen.getByRole('tabpanel').getAttribute('data-active-tab')).toBe('security');
    expect(screen.getByRole('button', { name: 'Security' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('omits billing when disabled and blocks navigation to disabled route sections', () => {
    render(<SettingsLayout activeSection="profile" />);
    expect(screen.queryByRole('button', { name: 'Billing' })).toBeNull();
  });

  it('renders Outlet when used as a layout route and navigates to canonical section paths', () => {
    mockLocation.pathname = '/settings/billing';
    render(
      <CapabilityProvider
        initialContext={{
          ...EMPTY_CAPABILITY_CONTEXT,
          flags: { 'flags.billing': true },
        }}
      >
        <SettingsLayout />
      </CapabilityProvider>,
    );

    expect(screen.getByTestId('settings-route-outlet')).toBeInTheDocument();
    if (hasBillingModule) {
      expect(screen.getByRole('button', { name: 'Billing' }).getAttribute('aria-current')).toBe(
        'page',
      );
    }

    fireEvent.click(screen.getByRole('button', { name: 'Sessions' }));
    expect(mockNavigate).toHaveBeenCalledWith('/settings/sessions');
  });
});
