// main/apps/web/src/app/account/SettingsLayout.test.tsx
import { CapabilityProvider, EMPTY_CAPABILITY_CONTEXT } from '@bslt/web-platform';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hasBillingModule, hasOrgsModule } from '../../generated/modules';

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
      <SettingsLayout activeSection="security" description="Manage authentication methods.">
        <div data-testid="custom-settings-child" />
      </SettingsLayout>,
    );

    expect(screen.getByTestId('custom-settings-child')).toBeInTheDocument();
    expect(screen.queryByTestId('settings-route-outlet')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Security' })).toBeInTheDocument();
    expect(screen.getByText('Manage authentication methods.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Settings' })).toBeInTheDocument();
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
    // Outlet pages render their own h1; SettingsLayout keeps the sidebar heading at h2.
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Settings' })).toBeInTheDocument();
    if (hasBillingModule) {
      expect(screen.getByRole('button', { name: 'Billing' }).getAttribute('aria-current')).toBe(
        'page',
      );
    }

    fireEvent.click(screen.getByRole('button', { name: 'Sessions' }));
    expect(mockNavigate).toHaveBeenCalledWith('/settings/sessions');
  });

  it('shows the Workspace Console shortcut only when orgs.teams flag is enabled', () => {
    render(<SettingsLayout activeSection="profile" />);
    expect(screen.getByText('Personal Account')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Workspace Console' })).toBeNull();

    render(
      <CapabilityProvider
        initialContext={{
          ...EMPTY_CAPABILITY_CONTEXT,
          flags: { 'orgs.teams': true },
        }}
      >
        <SettingsLayout activeSection="profile" />
      </CapabilityProvider>,
    );
    if (hasOrgsModule) {
      fireEvent.click(screen.getByRole('button', { name: 'Workspace Console' }));
      expect(mockNavigate).toHaveBeenCalledWith('/organization');
    }
  });
});
