// main/apps/web/src/app/workspace/WorkspaceLayout.test.tsx
import { CapabilityProvider, EMPTY_CAPABILITY_CONTEXT } from '@bslt/web-platform';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hasBillingModule, installedModules } from '../../generated/modules';
import { I18nProvider } from '../../i18n';

import { WorkspaceLayout } from './WorkspaceLayout';

import type { ReactElement } from 'react';

const { mockNavigate, mockLocation } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockLocation: { pathname: '/organization', search: '', hash: '' },
}));

vi.mock('@bslt/react/router', () => ({
  Outlet: (): ReactElement => <div data-testid="workspace-route-outlet" />,
  useLocation: () => mockLocation,
  useNavigate: () => mockNavigate,
}));

vi.mock('../../generated/modules', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../generated/modules')>();
  return {
    ...actual,
    OptionalOrgSwitcher: (): ReactElement => <div data-testid="workspace-org-switcher" />,
  };
});

beforeEach(() => {
  mockNavigate.mockClear();
  mockLocation.pathname = '/organization';
});

describe('WorkspaceLayout', () => {
  it('hides billing navigation when flags.billing is false', () => {
    render(
      <CapabilityProvider initialContext={EMPTY_CAPABILITY_CONTEXT}>
        <WorkspaceLayout />
      </CapabilityProvider>,
    );

    expect(screen.queryByRole('button', { name: 'Billing & Invoices' })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Team & Settings' }).getAttribute('aria-current'),
    ).toBe('page');
    expect(screen.getByTestId('workspace-org-switcher')).toBeInTheDocument();
  });

  it('highlights active workspace section and navigates between Team, Billing, and Webhooks', () => {
    const hasWebhooks = installedModules.some((m) => m.id === 'webhooks');
    mockLocation.pathname = '/workspace/webhooks';

    render(
      <CapabilityProvider
        initialContext={{
          ...EMPTY_CAPABILITY_CONTEXT,
          flags: { 'flags.billing': true, 'orgs.teams': true },
        }}
      >
        <WorkspaceLayout />
      </CapabilityProvider>,
    );

    expect(screen.getByTestId('workspace-route-outlet')).toBeInTheDocument();
    if (hasWebhooks) {
      expect(screen.getByRole('button', { name: 'Webhooks' }).getAttribute('aria-current')).toBe(
        'page',
      );
    }
    if (hasBillingModule) {
      fireEvent.click(screen.getByRole('button', { name: 'Billing & Invoices' }));
      expect(mockNavigate).toHaveBeenCalledWith('/workspace/billing');
    }
    fireEvent.click(screen.getByRole('button', { name: 'Audit & Activity' }));
    expect(mockNavigate).toHaveBeenCalledWith('/workspace/audit');
    fireEvent.click(screen.getByRole('button', { name: 'Team & Settings' }));
    expect(mockNavigate).toHaveBeenCalledWith('/organization');
  });

  it('renders Korean workspace console chrome under ko-KR', () => {
    render(
      <CapabilityProvider
        initialContext={{
          ...EMPTY_CAPABILITY_CONTEXT,
          flags: { 'flags.billing': true, 'orgs.teams': true },
        }}
      >
        <I18nProvider initialLocale="ko-KR">
          <WorkspaceLayout />
        </I18nProvider>
      </CapabilityProvider>,
    );

    expect(screen.getByRole('heading', { name: '워크스페이스' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '팀 및 설정' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '감사 및 활동' })).toBeInTheDocument();
    if (hasBillingModule) {
      expect(screen.getByRole('button', { name: '결제 및 청구서' })).toBeInTheDocument();
    }
  });
});
