// main/kernel/web/src/layout-context.ts
import { createContext, useContext, useEffect, type ReactNode } from 'react';

export interface AppLayoutContextValue {
  setRightSidebar: (content: ReactNode | null) => void;
}

export const AppLayoutContext = createContext<AppLayoutContextValue | null>(null);

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
