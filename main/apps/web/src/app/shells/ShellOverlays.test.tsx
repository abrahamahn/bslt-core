// main/apps/web/src/app/shells/ShellOverlays.test.tsx
import { closeAuthModal, openAuthModal } from '@bslt/identity/web';
import { act, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { createMockEnvironment, renderWithProviders } from '../../__tests__/utils';

import { ShellOverlays } from './ShellOverlays';

describe('ShellOverlays', () => {
  beforeEach(() => {
    closeAuthModal();
  });

  it('keeps AuthModal closed by default and opens it when openAuthModal is triggered', async () => {
    const environment = createMockEnvironment({ isAuthenticated: false, isLoading: false });
    renderWithProviders(<ShellOverlays />, { environment });

    expect(screen.queryByRole('dialog')).toBeNull();

    act(() => {
      openAuthModal('login');
    });
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });
});
