// main/kernel/web/src/layout-context.test.tsx
import { render, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  AppLayoutContext,
  RealtimeSubscribeContext,
  useAppRightSidebar,
  useRealtimeChannel,
  type AppLayoutContextValue,
  type RealtimeSubscribeFn,
} from './index';

describe('RealtimeSubscribeContext & useRealtimeChannel', () => {
  it('no-ops cleanly when rendered outside RealtimeSubscribeContext or with null channel', () => {
    const onInvalidate = vi.fn();
    const { result } = renderHook(() => useRealtimeChannel('org:org-1', onInvalidate));
    expect(result.current).toBe(false);
    expect(onInvalidate).not.toHaveBeenCalled();

    const subscribe: RealtimeSubscribeFn = vi.fn(() => vi.fn());
    const { result: nullResult } = renderHook(() => useRealtimeChannel(null, onInvalidate), {
      wrapper: ({ children }) => (
        <RealtimeSubscribeContext.Provider value={subscribe}>
          {children}
        </RealtimeSubscribeContext.Provider>
      ),
    });
    expect(nullResult.current).toBe(false);
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('subscribes on mount, forwards invalidations, and unsubscribes on unmount', () => {
    const unsubscribe = vi.fn();
    let capturedHandler: ((key: `org:${string}`, version: number) => void) | undefined;
    const subscribe: RealtimeSubscribeFn = vi.fn((_key, handler) => {
      capturedHandler = handler as (key: `org:${string}`, version: number) => void;
      return unsubscribe;
    });
    const onInvalidate = vi.fn();

    const { result, unmount } = renderHook(() => useRealtimeChannel('org:org-42', onInvalidate), {
      wrapper: ({ children }) => (
        <RealtimeSubscribeContext.Provider value={subscribe}>
          {children}
        </RealtimeSubscribeContext.Provider>
      ),
    });

    expect(result.current).toBe(true);
    expect(subscribe).toHaveBeenCalledWith('org:org-42', expect.any(Function));
    capturedHandler?.('org:org-42', 99);
    expect(onInvalidate).toHaveBeenCalledWith(99);
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('AppLayoutContext & useAppRightSidebar', () => {
  it('returns false and does not throw when rendered outside AppLayoutContext', () => {
    const { result } = renderHook(() => useAppRightSidebar(<div>Sidebar</div>));
    expect(result.current).toBe(false);
  });

  it('sets right sidebar content on mount and clears to null on unmount', () => {
    const setRightSidebar = vi.fn();
    const ctxValue: AppLayoutContextValue = { setRightSidebar };

    function Child() {
      const available = useAppRightSidebar(<span>Active Sidebar</span>);
      return <div data-available={String(available)} />;
    }

    const { unmount } = render(
      <AppLayoutContext.Provider value={ctxValue}>
        <Child />
      </AppLayoutContext.Provider>,
    );

    expect(setRightSidebar).toHaveBeenCalledTimes(1);
    unmount();
    expect(setRightSidebar).toHaveBeenLastCalledWith(null);
  });
});
