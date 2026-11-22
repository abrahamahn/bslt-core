// main/apps/web/src/app/shells/AppShell.test.tsx
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createMockEnvironment, mockUser, renderWithProviders } from '../../__tests__/utils';

import { AppShell } from './AppShell';

describe('AppShell', () => {
  it('renders fixed header, left primary nav, and footer on desktop while omitting mobile bottom bar and resizable panes', () => {
    const environment = createMockEnvironment({ user: mockUser, isAuthenticated: true });
    const { container } = renderWithProviders(
      <AppShell>
        <div>Workspace Content</div>
      </AppShell>,
      { environment, route: '/dashboard' },
    );

    expect(container.querySelector('[data-shell="app"]')).toBeInTheDocument();
    expect(screen.getByTestId('app-top-panel')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Mobile primary' })).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Footer' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent('Workspace Content');
    expect(container.querySelector('.resizable-panel-group')).toBeNull();
    expect(screen.queryByRole('button', { name: /reset layout/i })).toBeNull();

    const sidebar = container.querySelector('.shell-app__sidebar');
    expect(sidebar).toHaveAttribute('data-open', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    expect(sidebar).toHaveAttribute('data-open', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Close navigation menu' }));
    expect(sidebar).toHaveAttribute('data-open', 'false');
  });

  it('mounts BottombarLayout mobile navigation from slot app.primary on mobile viewports', () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn((query: string) => ({
        matches: query.includes('48rem'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    try {
      const environment = createMockEnvironment({ user: mockUser, isAuthenticated: true });
      renderWithProviders(
        <AppShell>
          <div>Mobile Workspace</div>
        </AppShell>,
        { environment, route: '/dashboard' },
      );

      expect(screen.getByRole('navigation', { name: 'Mobile primary' })).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: originalMatchMedia,
      });
    }
  });
});
