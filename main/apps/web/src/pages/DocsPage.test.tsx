// main/apps/web/src/pages/DocsPage.test.tsx
import { MemoryRouter, Route, Routes } from '@bslt/react/router';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DocsPage } from './DocsPage';

describe('DocsPage', () => {
  it('renders the overview guide chapter by default with live route links and next-chapter pager', () => {
    render(
      <MemoryRouter initialEntries={['/docs']}>
        <Routes>
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/docs/:section" element={<DocsPage />} />
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
    expect(screen.getByRole('link', { name: /Create an Account/i })).toHaveAttribute(
      'href',
      '/register',
    );
    expect(screen.getByRole('link', { name: /Identity & Security/i })).toHaveAttribute(
      'href',
      '/docs/auth',
    );
  });

  it('navigates between chapters from the sidebar and renders chapter-specific routes and CLI snippets', () => {
    render(
      <MemoryRouter initialEntries={['/docs']}>
        <Routes>
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/docs/:section" element={<DocsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Workspaces & Teams' }));
    expect(
      screen.getByRole('heading', { level: 1, name: 'Workspaces, Roles & Self-Service Webhooks' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Workspace Webhooks/i })).toHaveAttribute(
      'href',
      '/workspace/webhooks',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Branding, CLI & Dev Sandbox' }));
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Single-Manifest Branding, CLI Presets & Offline Sandbox',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/pnpm quickstart --preset b2b-saas/i)).toBeInTheDocument();
  });

  it('filters sidebar chapters by search query and shows an empty hint on no matches', () => {
    render(
      <MemoryRouter initialEntries={['/docs/billing']}>
        <Routes>
          <Route path="/docs/:section" element={<DocsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Pricing, Subscriptions & Entitlements' }),
    ).toBeInTheDocument();

    const filterInput = screen.getByRole('searchbox', { name: 'Filter app guide topics' });
    fireEvent.change(filterInput, { target: { value: 'passkey' } });
    expect(screen.getByRole('button', { name: 'Identity & Security' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Billing & Entitlements' })).toBeNull();

    fireEvent.change(filterInput, { target: { value: 'zzzz-missing-topic' } });
    expect(screen.getByText('No matching guide chapters.')).toBeInTheDocument();
  });
});
