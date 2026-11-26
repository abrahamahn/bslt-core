// main/apps/web/src/ssr/PublicDocumentShell.test.tsx
import { MemoryRouter } from '@bslt/react/router';
import { ThemeProvider } from '@bslt/ui';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { installedPublicSsrModules } from '../generated/public-modules';

import { PublicDocumentShell } from './PublicDocumentShell';

describe('PublicDocumentShell', () => {
  it('renders public topbar, main landmark, footer links, and anonymous CPRA switch without AuthService', () => {
    const { container } = render(
      <ThemeProvider>
        <MemoryRouter initialEntries={['/status']}>
          <PublicDocumentShell>
            <h1>Live Status Body</h1>
          </PublicDocumentShell>
        </MemoryRouter>
      </ThemeProvider>,
    );

    expect(container.querySelector('[data-shell="public"]')).not.toBeNull();
    expect(screen.getByTestId('app-top-panel')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Footer' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent('Live Status Body');
    expect(screen.getByRole('link', { name: 'Login' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'Register' })).toHaveAttribute('href', '/register');
    expect(document.getElementById('do-not-sell')).not.toBeNull();

    const publicModuleIds: ReadonlySet<string> = new Set(
      installedPublicSsrModules.map((mod) => mod.id),
    );
    const hasGrowth = publicModuleIds.has('growth');
    const blogLinks = screen.queryAllByRole('link', { name: 'Blog' });
    const waitlistLinks = screen.queryAllByRole('link', { name: 'Waitlist' });
    if (hasGrowth) {
      expect(blogLinks.length).toBeGreaterThanOrEqual(2);
      expect(waitlistLinks.length).toBeGreaterThanOrEqual(2);
    } else {
      expect(blogLinks).toHaveLength(0);
      expect(waitlistLinks).toHaveLength(0);
    }
  });
});
