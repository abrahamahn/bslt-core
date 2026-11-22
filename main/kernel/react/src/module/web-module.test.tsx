// main/kernel/react/src/module/web-module.test.tsx
import { render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TransportProvider, useTransport } from './web-module';

import type { Transport } from '@bslt/client-engine';
import type { ReactElement } from 'react';

describe('TransportProvider / useTransport', () => {
  it('throws when useTransport is called outside TransportProvider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => renderHook(() => useTransport())).toThrow(/TransportProvider/u);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('propagates transport request rejections to callers without swallowing errors', async () => {
    const failingTransport: Transport = {
      request: vi.fn().mockRejectedValue(new Error('network_down')),
    };

    const { result } = renderHook(() => useTransport(), {
      wrapper: ({ children }) => (
        <TransportProvider transport={failingTransport}>{children}</TransportProvider>
      ),
    });

    await expect(result.current.request('/tasks', { method: 'GET' })).rejects.toThrow(
      /network_down/u,
    );
  });

  it('provides the configured Transport instance to descendant components', () => {
    const mockTransport: Transport = {
      request: vi.fn().mockResolvedValue({ ok: true }),
    };

    function Probe(): ReactElement {
      const transport = useTransport();
      return <span data-testid="probe">{String(transport === mockTransport)}</span>;
    }

    render(
      <TransportProvider transport={mockTransport}>
        <Probe />
      </TransportProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('true');
  });
});
