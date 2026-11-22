// main/modules/audit/web/hooks.test.tsx
import { act, cleanup, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { QueryCache } from '@bslt/client-engine';
import { QueryCacheProvider, TransportProvider } from '@bslt/react';

import {
  useActivities,
  useAuditEvents,
  useExportEvents,
  useSecurityEvent,
  useSecurityEvents,
  useSecurityMetrics,
} from './hooks';

import type { Transport } from '@bslt/client-engine';

afterEach(() => {
  cleanup();
});

function makeWrapper(requestFn: ReturnType<typeof vi.fn>, cache = new QueryCache()) {
  const transport: Transport = {
    request: requestFn as Transport['request'],
  };
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      QueryCacheProvider,
      { cache },
      createElement(TransportProvider, { transport }, children),
    );
  return { wrapper };
}

describe('audit web hooks', () => {
  it('surfaces transport errors cleanly across activities, audit, security, and export hooks', async () => {
    vi.useFakeTimers();
    try {
      const requestFn = vi.fn().mockRejectedValue(new Error('Network offline'));
      const { wrapper } = makeWrapper(requestFn);

      const { result } = renderHook(
        () => ({
          activities: useActivities({ limit: 10 }),
          audit: useAuditEvents({ filter: { limit: 10 } }),
          security: useSecurityEvents(),
          metrics: useSecurityMetrics({ period: 'day' }),
          exporter: useExportEvents(),
        }),
        { wrapper },
      );

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(result.current.activities.isError).toBe(true);
      expect(result.current.audit.isError).toBe(true);
      expect(result.current.security.isError).toBe(true);
      expect(result.current.metrics.isError).toBe(true);
      expect(result.current.activities.activities).toEqual([]);
      expect(result.current.activities.error?.message).toBe('Network offline');

      await act(async () => {
        result.current.exporter.exportEvents('csv');
        await vi.runAllTimersAsync();
      });

      expect(result.current.exporter.isError).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips fetching useSecurityEvent when id is missing or empty', () => {
    const requestFn = vi.fn();
    const { wrapper } = makeWrapper(requestFn);

    const { result } = renderHook(() => useSecurityEvent(''), { wrapper });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(requestFn).not.toHaveBeenCalled();
  });

  it('resets pagination to page 1 when security filter changes and updates period', async () => {
    const requestFn = vi.fn().mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      limit: 50,
      hasNext: false,
      hasPrev: false,
      totalPages: 0,
    });
    const { wrapper } = makeWrapper(requestFn);

    const { result } = renderHook(
      () => ({
        events: useSecurityEvents(),
        metrics: useSecurityMetrics({ period: 'day' }),
      }),
      { wrapper },
    );

    act(() => {
      result.current.events.setPage(3);
    });
    expect(result.current.events.pagination.page).toBe(3);

    act(() => {
      result.current.events.setFilter({ severity: 'critical' });
      result.current.metrics.setPeriod('week');
    });
    expect(result.current.events.pagination.page).toBe(1);
    expect(result.current.events.filter).toEqual({ severity: 'critical' });
    expect(result.current.metrics.period).toBe('week');
  });
});
