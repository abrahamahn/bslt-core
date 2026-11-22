// main/modules/devtools/web/ApiRoutesPage.test.tsx
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiRoutesPage } from './ApiRoutesPage';

const mockRoutes = vi.hoisted(() => [
  { method: 'GET', path: '/api/auth/strategies', module: 'identity', public: true },
  { method: 'POST', path: '/api/billing/checkout', module: 'billing', public: false },
  { method: 'GET', path: '/api/billing/invoices/:id', module: 'billing', public: false },
]);

vi.mock('./routeInventory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./routeInventory')>();
  return {
    ...actual,
    apiRouteInventory: mockRoutes,
  };
});

describe('ApiRoutesPage', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('REJECTS invalid Query JSON and missing required path parameters before sending fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<ApiRoutesPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Open GET /api/billing/invoices/:id' }));

    fireEvent.change(screen.getByLabelText('id path parameter'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('id path parameter is required');
    });
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('id path parameter'), { target: { value: 'inv-1' } });
    fireEvent.change(screen.getByLabelText('Query JSON'), { target: { value: '{broken' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Query JSON must be valid JSON');
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders route inventory counts and sends valid requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ strategies: ['local'] }), {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<ApiRoutesPage />);
    expect(screen.getByRole('heading', { name: 'API Routes' })).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
