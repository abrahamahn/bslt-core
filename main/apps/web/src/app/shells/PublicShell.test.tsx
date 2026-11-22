// main/apps/web/src/app/shells/PublicShell.test.tsx
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createMockEnvironment, renderWithProviders } from '../../__tests__/utils';

import { PublicShell } from './PublicShell';

describe('PublicShell', () => {
  it('renders SSR-safe public header, main landmark, and footer without sidebars or resizable panes', () => {
    const environment = createMockEnvironment({ isAuthenticated: false, isLoading: false });
    const { container } = renderWithProviders(
      <PublicShell>
        <div>Public Marketing Page</div>
      </PublicShell>,
      { environment, route: '/' },
    );

    expect(container.querySelector('[data-shell="public"]')).toBeInTheDocument();
    expect(screen.getByTestId('app-top-panel')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Footer' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent('Public Marketing Page');
    expect(container.querySelector('.resizable-panel-group')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Mobile primary' })).toBeNull();
  });
});
