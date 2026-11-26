// main/kernel/web/src/layout-context.ts
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';

import type { SubscriptionKey } from '@bslt/contract';

export interface AppLayoutContextValue {
  setRightSidebar: (content: ReactNode | null) => void;
}

export const AppLayoutContext = createContext<AppLayoutContextValue | null>(null);

export type RealtimeSubscribeFn = (
  key: SubscriptionKey,
  handler: (key: SubscriptionKey, version: number) => void,
) => () => void;

export const RealtimeSubscribeContext = createContext<RealtimeSubscribeFn | null>(null);

/**
 * Subscribe a module view to live WebSocket invalidations on a declared channel
 * (e.g. `org:${orgId}`). No-ops cleanly when rendered outside a realtime provider.
 */
export function useRealtimeChannel(
  channel: SubscriptionKey | null,
  onInvalidate: (version: number) => void,
): boolean {
  const subscribe = useContext(RealtimeSubscribeContext);
  const handlerRef = useRef(onInvalidate);

  useEffect(() => {
    handlerRef.current = onInvalidate;
  }, [onInvalidate]);

  useEffect(() => {
    if (subscribe === null || channel === null) return;
    return subscribe(channel, (_key, version) => {
      handlerRef.current(version);
    });
  }, [subscribe, channel]);

  return subscribe !== null && channel !== null;
}

/**
 * Inject content into the active shell's right sidebar when present,
 * clearing automatically when the component unmounts.
 */
export function useAppRightSidebar(content: ReactNode): boolean {
  const ctx = useContext(AppLayoutContext);

  useEffect(() => {
    if (ctx === null) return;
    ctx.setRightSidebar(content);
    return (): void => {
      ctx.setRightSidebar(null);
    };
  }, [ctx, content]);

  return ctx !== null;
}
