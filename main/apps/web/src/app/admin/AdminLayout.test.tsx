// main/apps/web/src/app/admin/AdminLayout.test.tsx
import { AppLayoutContext, EMPTY_CAPABILITY_CONTEXT } from '@bslt/web-platform';
import { screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { createMockEnvironment, mockAdminUser, renderWithProviders } from '../../__tests__/utils';
import { hasAdminModule, hasNotificationsModule, installedModules } from '../../generated/modules';

import { AdminLayout } from './AdminLayout';

import type { ReactElement, ReactNode } from 'react';

const INSTALLED_IDS: ReadonlySet<string> = new Set(installedModules.map((m) => m.id));
const hasMod = (id: string): boolean => INSTALLED_IDS.has(id);

const AdminLayoutHarness = ({ children }: { children: ReactNode }): ReactElement => {
  const [rightSidebar, setRightSidebar] = useState<ReactNode | null>(null);

  return (
    <AppLayoutContext.Provider value={{ setRightSidebar }}>
      <main>{children}</main>
      <aside data-testid="right-sidebar">{rightSidebar}</aside>
    </AppLayoutContext.Provider>
  );
};

describe('AdminLayout', () => {
  it('should render children', () => {
    const environment = createMockEnvironment({
      user: mockAdminUser,
      isAuthenticated: true,
    });

    renderWithProviders(
      <AdminLayout>
        <div>Test Content</div>
      </AdminLayout>,
      { environment },
    );

    expect(screen.getByText('Test Content')).toBeInTheDocument();
  });

  it('keeps children mounted during a background refresh when already authenticated', () => {
    // Regression: fetchCurrentUser (profile save, token refresh) flips
    // isLoading while the user stays authenticated. Showing the loader then
    // unmounted the admin page and wiped its state.
    const environment = createMockEnvironment({
      user: mockAdminUser,
      isAuthenticated: true,
      isLoading: true,
    });

    renderWithProviders(
      <AdminLayout>
        <div>Test Content</div>
      </AdminLayout>,
      { environment },
    );

    expect(screen.getByText('Test Content')).toBeInTheDocument();
    expect(screen.queryByText(/Loading admin access/i)).not.toBeInTheDocument();
  });

  it('should render navigation in the app right sidebar', async () => {
    const environment = createMockEnvironment({
      user: mockAdminUser,
      isAuthenticated: true,
    });

    renderWithProviders(
      <AdminLayoutHarness>
        <AdminLayout>
          <div data-testid="admin-page">Content</div>
        </AdminLayout>
      </AdminLayoutHarness>,
      { environment },
    );

    await waitFor(() => {
      expect(
        within(screen.getByTestId('right-sidebar')).getByRole('navigation', {
          name: 'Admin sections',
        }),
      ).toBeInTheDocument();
    });
    expect(within(screen.getByTestId('admin-page')).queryByRole('navigation')).toBeNull();
  });

  it('omits optional and internal admin tools from the primary sidebar', async () => {
    const environment = createMockEnvironment({
      user: mockAdminUser,
      isAuthenticated: true,
    });

    renderWithProviders(
      <AdminLayoutHarness>
        <AdminLayout>
          <div>Content</div>
        </AdminLayout>
      </AdminLayoutHarness>,
      { environment },
    );

    await waitFor(() => {
      expect(
        within(screen.getByTestId('right-sidebar')).getByRole('navigation', {
          name: 'Admin sections',
        }),
      ).toBeInTheDocument();
    });

    const sidebar = within(screen.getByTestId('right-sidebar'));
    expect(sidebar.getByRole('button', { name: /security/i })).toBeInTheDocument();
    expect(sidebar.getByRole('button', { name: /audit/i })).toBeInTheDocument();
    expect(sidebar.getByRole('button', { name: /legal/i })).toBeInTheDocument();
    if (hasAdminModule) {
      expect(sidebar.getByRole('button', { name: /health/i })).toBeInTheDocument();
      expect(sidebar.getByRole('button', { name: /users/i })).toBeInTheDocument();
      expect(sidebar.queryByRole('button', { name: /dashboard/i })).toBeNull();
    } else {
      expect(sidebar.getByRole('button', { name: /dashboard/i })).toBeInTheDocument();
    }
    if (hasMod('support')) {
      expect(sidebar.getByRole('button', { name: /support/i })).toBeInTheDocument();
    }
    if (hasMod('flags')) {
      expect(sidebar.getByRole('button', { name: /feature flags/i })).toBeInTheDocument();
    }
    if (hasMod('webhooks')) {
      expect(sidebar.getByRole('button', { name: /webhook monitor/i })).toBeInTheDocument();
      expect(sidebar.getByRole('button', { name: /webhook endpoints/i })).toBeInTheDocument();
    }
    if (hasNotificationsModule) {
      expect(sidebar.getByRole('button', { name: /notifications/i })).toBeInTheDocument();
    }
    expect(sidebar.queryByRole('button', { name: /billing/i })).toBeNull();
    expect(sidebar.queryByRole('button', { name: /jobs/i })).toBeNull();
    expect(sidebar.queryByRole('button', { name: /api routes/i })).toBeNull();
  });

  it('surfaces advanced optional tools but never the internal route manifest', async () => {
    const environment = createMockEnvironment({
      user: mockAdminUser,
      isAuthenticated: true,
      capabilities: {
        ...EMPTY_CAPABILITY_CONTEXT,
        flags: { 'flags.advanced_admin': true },
      },
    });

    renderWithProviders(
      <AdminLayoutHarness>
        <AdminLayout>
          <div>Content</div>
        </AdminLayout>
      </AdminLayoutHarness>,
      { environment },
    );

    await waitFor(() => {
      expect(
        within(screen.getByTestId('right-sidebar')).getByRole('navigation', {
          name: 'Admin sections',
        }),
      ).toBeInTheDocument();
    });

    const sidebar = within(screen.getByTestId('right-sidebar'));
    expect(sidebar.getByRole('button', { name: /dashboard/i })).toBeInTheDocument();
    if (hasMod('flags')) {
      expect(sidebar.getByRole('button', { name: /feature flags/i })).toBeInTheDocument();
    }
    if (hasNotificationsModule) {
      expect(sidebar.getByRole('button', { name: /notifications/i })).toBeInTheDocument();
    }
    expect(sidebar.queryByRole('button', { name: /api routes/i })).toBeNull();
  });

  it('marks the index surface active on the /admin index route', async () => {
    const environment = createMockEnvironment({
      user: mockAdminUser,
      isAuthenticated: true,
    });

    renderWithProviders(
      <AdminLayoutHarness>
        <AdminLayout>
          <div>Content</div>
        </AdminLayout>
      </AdminLayoutHarness>,
      { environment, route: '/admin' },
    );

    await waitFor(() => {
      expect(
        within(screen.getByTestId('right-sidebar')).getByRole('navigation', {
          name: 'Admin sections',
        }),
      ).toBeInTheDocument();
    });

    const sidebar = within(screen.getByTestId('right-sidebar'));
    if (hasAdminModule) {
      expect(sidebar.getByRole('button', { name: /health/i })).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(sidebar.getByRole('button', { name: /users/i })).not.toHaveAttribute('aria-current');
    } else {
      expect(sidebar.getByRole('button', { name: /dashboard/i })).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(sidebar.getByRole('button', { name: /security/i })).not.toHaveAttribute(
        'aria-current',
      );
    }
  });
});
