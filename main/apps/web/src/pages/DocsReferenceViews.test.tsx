// main/apps/web/src/pages/DocsReferenceViews.test.tsx
import { MemoryRouter } from '@bslt/react/router';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DOCS_REFERENCE } from './docsReference.generated';
import {
  DocsApiReferenceView,
  DocsDatabaseView,
  DocsEventsView,
  DocsModuleDetailView,
  DocsModulesView,
  DocsWebRoutesView,
} from './DocsReferenceViews';

describe('DocsReferenceViews', () => {
  it('filters API endpoints by search, HTTP method, auth, and expands curl/schema details', () => {
    render(
      <MemoryRouter>
        <DocsApiReferenceView />
      </MemoryRouter>,
    );

    expect(
      screen.getByText(
        `Showing ${String(DOCS_REFERENCE.apiRoutes.length)} of ${String(DOCS_REFERENCE.apiRoutes.length)} endpoints`,
      ),
    ).toBeInTheDocument();

    const searchInput = screen.getByRole('searchbox', {
      name: 'Search API endpoints',
    });
    fireEvent.change(searchInput, { target: { value: '/api/auth/login' } });
    expect(screen.getByText('/api/auth/login')).toBeInTheDocument();

    const detailsButtons = screen.getAllByRole('button', { name: 'Details' });
    expect(detailsButtons.length).toBeGreaterThan(0);
    fireEvent.click(detailsButtons[0] as HTMLElement);
    expect(screen.getByText(/curl -X POST/i)).toBeInTheDocument();

    // Adversarial empty state when combining incompatible method + search
    fireEvent.click(screen.getByRole('button', { name: 'DELETE' }));
    expect(screen.getByText('No matching API endpoints')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(
      screen.getByText(
        `Showing ${String(DOCS_REFERENCE.apiRoutes.length)} of ${String(DOCS_REFERENCE.apiRoutes.length)} endpoints`,
      ),
    ).toBeInTheDocument();
  });

  it('filters web routes by space and search and renders an empty state on misses', () => {
    render(
      <MemoryRouter>
        <DocsWebRoutesView />
      </MemoryRouter>,
    );

    expect(
      screen.getByText(
        `Showing ${String(DOCS_REFERENCE.webRoutes.length)} of ${String(DOCS_REFERENCE.webRoutes.length)} routes`,
      ),
    ).toBeInTheDocument();

    const searchInput = screen.getByRole('searchbox', {
      name: 'Search web routes',
    });
    fireEvent.change(searchInput, { target: { value: '/dashboard' } });
    expect(screen.getByRole('link', { name: '/dashboard' })).toHaveAttribute('href', '/dashboard');

    fireEvent.change(searchInput, {
      target: { value: 'zzzz-unknown-web-route' },
    });
    expect(screen.getByText('No matching web routes')).toBeInTheDocument();
  });

  it('filters vertical modules and renders kernel packages and single-module detail', () => {
    const identityMod = DOCS_REFERENCE.modules.find((mod) => mod.id === 'identity');
    expect(identityMod).toBeDefined();

    const { unmount } = render(
      <MemoryRouter>
        <DocsModulesView />
      </MemoryRouter>,
    );

    expect(screen.getByText('@bslt/identity')).toBeInTheDocument();
    expect(screen.getByText('@bslt/protocols')).toBeInTheDocument();

    const filterInput = screen.getByRole('searchbox', {
      name: 'Filter vertical modules',
    });
    fireEvent.change(filterInput, { target: { value: 'zzzz-missing-module' } });
    expect(screen.getByText('No matching modules')).toBeInTheDocument();
    unmount();

    if (identityMod !== undefined) {
      render(
        <MemoryRouter>
          <DocsModuleDetailView moduleRef={identityMod} />
        </MemoryRouter>,
      );
      expect(screen.getByRole('heading', { level: 1, name: '@bslt/identity' })).toBeInTheDocument();
      expect(screen.getByText('identity_users')).toBeInTheDocument();
      expect(screen.getByText('identity.user.registered')).toBeInTheDocument();
    }
  });

  it('filters database RLS tables and outbox events including webhooks-only mode', () => {
    const { unmount } = render(
      <MemoryRouter>
        <DocsDatabaseView />
      </MemoryRouter>,
    );

    expect(screen.getByText('identity_users')).toBeInTheDocument();
    expect(
      screen.getByText(
        'sys_apply_rls(tbl regclass, class text, owner_col name, user_ops text[], admin_ops text[], system_ops text[])',
      ),
    ).toBeInTheDocument();

    const dbSearch = screen.getByRole('searchbox', {
      name: 'Search database tables',
    });
    fireEvent.change(dbSearch, { target: { value: 'zzzz-no-table' } });
    expect(screen.getByText('No matching database tables')).toBeInTheDocument();
    unmount();

    render(
      <MemoryRouter>
        <DocsEventsView />
      </MemoryRouter>,
    );

    expect(screen.getByText('identity.user.registered')).toBeInTheDocument();
    expect(screen.getAllByText('sys.outbox.retention').length).toBeGreaterThanOrEqual(2);

    const webhookToggle = screen.getByRole('button', {
      name: /Outbound Webhooks Only/i,
    });
    fireEvent.click(webhookToggle);
    expect(screen.queryByText('identity.user.registered')).toBeNull();

    const evSearch = screen.getByRole('searchbox', {
      name: 'Search domain events',
    });
    fireEvent.change(evSearch, { target: { value: 'zzzz-no-event' } });
    expect(screen.getByText('No matching domain events.')).toBeInTheDocument();
  });
});
