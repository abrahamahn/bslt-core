// main/apps/web/src/app/shells/AuthShell.test.tsx
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createMockEnvironment, renderWithProviders } from '../../__tests__/utils';

import { AuthShell } from './AuthShell';

describe('AuthShell', () => {
  it('renders centered auth shell without primary sidebar, mobile bottom bar, or resizable panes', () => {
    const environment = createMockEnvironment({ isAuthenticated: false, isLoading: false });
    const { container } = renderWithProviders(
      <AuthShell>
        <div>Reset Password Card</div>
      </AuthShell>,
      { environment, route: '/auth/reset-password' },
    );

    expect(container.querySelector('[data-shell="auth"]')).toBeInTheDocument();
    expect(screen.getByTestId('app-top-panel')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent('Reset Password Card');
    expect(screen.queryByRole('navigation', { name: 'Primary' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Footer' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Mobile primary' })).toBeNull();
    expect(container.querySelector('.resizable-panel-group')).toBeNull();
  });
});
