// main/modules/devtools/web/hooks.test.tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { QueryCache, type Transport } from '@bslt/client-engine';
import { QueryCacheProvider, TransportProvider } from '@bslt/react';

import { useDocContent, useRouteManifest, useUILibraryPanes } from './hooks';

vi.mock('@bslt/react/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bslt/react/hooks')>();
  return {
    ...actual,
    useIsMobile: () => false,
  };
});

describe('devtools web hooks', () => {
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('useRouteManifest SURFACES transport errors and skips requests when disabled', async () => {
    vi.useFakeTimers();
    const request = vi.fn().mockRejectedValue(new Error('manifest forbidden'));
    const transport: Transport = { request };
    const cache = new QueryCache();

    const disabledHook = renderHook(() => useRouteManifest({ enabled: false }), {
      wrapper: ({ children }) => (
        <TransportProvider transport={transport}>
          <QueryCacheProvider cache={cache}>{children}</QueryCacheProvider>
        </TransportProvider>
      ),
    });
    expect(request).not.toHaveBeenCalled();
    disabledHook.unmount();

    const { result } = renderHook(() => useRouteManifest(), {
      wrapper: ({ children }) => (
        <TransportProvider transport={transport}>
          <QueryCacheProvider cache={cache}>{children}</QueryCacheProvider>
        </TransportProvider>
      ),
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(result.current.isError).toBe(true);
    expect(result.current.error?.message).toBe('manifest forbidden');
  });

  it('useDocContent FALLS BACK gracefully when doc key does not exist', async () => {
    const { result } = renderHook(() => useDocContent('missing-doc-xyz'));
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.content).toBe('Failed to load documentation.');
  });

  it('useUILibraryPanes toggles, resizes, and resets layout panes', () => {
    const { result } = renderHook(() => useUILibraryPanes('test-pane-key'));
    expect(result.current.paneConfig.left.visible).toBe(true);

    act(() => {
      result.current.togglePane('left');
      result.current.handlePaneResize('right', 35);
    });
    expect(result.current.paneConfig.left.visible).toBe(false);
    expect(result.current.paneConfig.right.size).toBe(35);

    act(() => {
      result.current.resetLayout();
    });
    expect(result.current.paneConfig.left.visible).toBe(true);
    expect(result.current.paneConfig.right.size).toBe(25);
  });
});
