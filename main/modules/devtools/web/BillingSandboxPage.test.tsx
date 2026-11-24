// main/modules/devtools/web/BillingSandboxPage.test.tsx
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type Transport } from '@bslt/client-engine';
import { TransportProvider } from '@bslt/react';
import { MemoryRouter } from '@bslt/react/router';

import { BillingSandboxPage } from './BillingSandboxPage';

describe('BillingSandboxPage', () => {
  afterEach(() => {
    cleanup();
  });

  it('loads plans and subscription, simulates checkout, and handles API errors gracefully', async () => {
    const request = vi.fn(async (path: string) => {
      if (path === '/api/billing/plans') {
        return {
          plans: [
            { id: 'plan-pro', name: 'Pro', priceInCents: 2900, currency: 'usd', interval: 'month' },
          ],
        };
      }
      if (path === '/api/billing/subscription') {
        return { subscription: null };
      }
      if (path === '/api/billing/checkout') {
        return { url: 'https://billing.mock.local/checkout/cs_mock_pro', sessionId: 'cs_mock_pro' };
      }
      return {};
    }) as unknown as Transport['request'];

    render(
      <MemoryRouter>
        <TransportProvider transport={{ request }}>
          <BillingSandboxPage />
        </TransportProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Pro')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Simulate checkout' }));

    await waitFor(() => {
      expect(screen.getByText(/Created mock checkout session for Pro/i)).toBeInTheDocument();
    });
    expect(screen.getByText('https://billing.mock.local/checkout/cs_mock_pro')).toBeInTheDocument();
  });

  it('surfaces transport failure messages when billing API is unreachable', async () => {
    const request = vi
      .fn()
      .mockRejectedValue(new Error('Billing unavailable')) as unknown as Transport['request'];
    render(
      <MemoryRouter>
        <TransportProvider transport={{ request }}>
          <BillingSandboxPage />
        </TransportProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Billing unavailable')).toBeInTheDocument();
  });
});
