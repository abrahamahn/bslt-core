// main/apps/web/src/pages/DocsPage.test.tsx
import { MemoryRouter, Route, Routes } from '@bslt/react/router';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DocsPage } from './DocsPage';
import { DOCS_REFERENCE } from './docsReference.generated';

describe('DocsPage', () => {
  it('renders the overview guide chapter with live platform stats and next-chapter pager', () => {
    render(
      <MemoryRouter initialEntries={['/docs']}>
        <Routes>
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/docs/:section" element={<DocsPage />} />
          <Route path="/docs/modules/:moduleId" element={<DocsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Inside the BSLT App' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'App Tour & Map' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const statsSection = screen.getByLabelText('Live platform inventory');
    expect(
      within(statsSection).getByText(String(DOCS_REFERENCE.apiRoutes.length)),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Create an Account/i })).toHaveAttribute(
      'href',
      '/register',
    );
    expect(screen.getByRole('link', { name: /Next chapter/i })).toHaveAttribute(
      'href',
      '/docs/api',
    );
  });

  it('navigates across reference explorers, module deep dives, and guided chapters', () => {
    render(
      <MemoryRouter initialEntries={['/docs']}>
        <Routes>
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/docs/:section" element={<DocsPage />} />
          <Route path="/docs/modules/:moduleId" element={<DocsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /HTTP API Reference/i }));
    expect(
      screen.getByRole('heading', { level: 1, name: /HTTP API Reference/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('/api/auth/login')).toBeInTheDocument();

    const sidebarNav = screen.getByRole('navigation', {
      name: 'App guide navigation',
    });
    fireEvent.click(within(sidebarNav).getByRole('button', { name: /^identity \d+$/ }));
    expect(screen.getByRole('heading', { level: 1, name: '@bslt/identity' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Workspaces & Teams' }));
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Workspaces, Roles & Self-Service Webhooks',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Workspace Webhooks/i })).toHaveAttribute(
      'href',
      '/workspace/webhooks',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Branding, CLI & Sandbox' }));
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Single-Manifest Branding, CLI Presets & Offline Sandbox',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/pnpm quickstart --preset b2b-saas/i)).toBeInTheDocument();
  });

  it('falls back cleanly on unknown module slug and shows empty hint on unmatched sidebar search', () => {
    render(
      <MemoryRouter initialEntries={['/docs/modules/does-not-exist']}>
        <Routes>
          <Route path="/docs/:section" element={<DocsPage />} />
          <Route path="/docs/modules/:moduleId" element={<DocsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    // Unknown moduleId falls back to the Modules & Kernel catalog view
    expect(
      screen.getByRole('heading', { level: 1, name: /Vertical Modules/i }),
    ).toBeInTheDocument();

    const filterInput = screen.getByRole('searchbox', {
      name: 'Filter app guide topics',
    });
    fireEvent.change(filterInput, { target: { value: 'passkey' } });
    expect(screen.getByRole('button', { name: 'Identity & Security' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Billing & Entitlements' })).toBeNull();

    fireEvent.change(filterInput, { target: { value: 'zzzz-missing-topic' } });
    expect(screen.getByText('No matching guide chapters.')).toBeInTheDocument();
  });
});
