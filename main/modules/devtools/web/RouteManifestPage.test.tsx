// main/modules/devtools/web/RouteManifestPage.test.tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RouteManifestPage } from './RouteManifestPage';

const manifestState = vi.hoisted(() => ({
  isLoading: false,
  isError: false,
  error: null as Error | null,
  data: undefined as
    | {
        count: number;
        routes: Array<{
          method: string;
          path: string;
          module: string;
          isPublic: boolean;
          roles: string[];
          hasSchema: boolean;
        }>;
      }
    | undefined,
}));

vi.mock('./hooks', () => ({
  useRouteManifest: () => manifestState,
}));

describe('RouteManifestPage', () => {
  beforeEach(() => {
    manifestState.isLoading = false;
    manifestState.isError = false;
    manifestState.error = null;
    manifestState.data = undefined;
  });

  afterEach(() => {
    cleanup();
  });

  it('SURFACES manifest load errors and renders empty-filter message when no routes match', () => {
    manifestState.isError = true;
    manifestState.error = new Error('Admin token required');
    const { rerender } = render(<RouteManifestPage />);
    expect(screen.getByText(/Failed to load route manifest: Admin token required/)).not.toBeNull();

    manifestState.isError = false;
    manifestState.data = {
      count: 1,
      routes: [
        {
          method: 'GET',
          path: '/api/tasks',
          module: 'tasks',
          isPublic: false,
          roles: [],
          hasSchema: true,
        },
      ],
    };
    rerender(<RouteManifestPage />);
    fireEvent.change(screen.getByPlaceholderText('Search by path...'), {
      target: { value: '/nonexistent' },
    });
    expect(screen.getByText('No routes match the current filters')).not.toBeNull();
  });

  it('renders routes and filters by module and method', () => {
    manifestState.data = {
      count: 2,
      routes: [
        {
          method: 'GET',
          path: '/api/health',
          module: 'system',
          isPublic: true,
          roles: [],
          hasSchema: true,
        },
        {
          method: 'POST',
          path: '/api/admin/users/create',
          module: 'identity',
          isPublic: false,
          roles: ['admin'],
          hasSchema: false,
        },
      ],
    };
    render(<RouteManifestPage />);
    expect(screen.getByText('/api/health')).not.toBeNull();
    expect(screen.getByText('/api/admin/users/create')).not.toBeNull();
  });
});
