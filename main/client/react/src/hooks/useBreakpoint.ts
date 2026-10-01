// main/client/react/src/hooks/useBreakpoint.ts
import {
  BREAKPOINT_ORDER,
  breakpointDown,
  breakpointUp,
  type BreakpointKey,
} from '@bslt/shared/constants';

import { useMediaQuery } from './useMediaQuery';

/**
 * The currently active breakpoint bucket. `'xs'` means the viewport is below
 * the smallest token (`sm`, 30rem); every other value means the viewport is
 * at or above that token (mobile-first, like the `bp:` utility variants).
 */
export type ActiveBreakpoint = 'xs' | BreakpointKey;

/**
 * Hook that reports the active named breakpoint for the current viewport,
 * derived from the canonical scale in `@bslt/shared/constants`.
 *
 * SSR-safe: returns `'xs'` on the server (mobile-first default).
 *
 * @example
 * ```tsx
 * const bp = useBreakpoint(); // 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl'
 * const columns = bp === 'xs' || bp === 'sm' ? 1 : 3;
 * ```
 */
export function useBreakpoint(): ActiveBreakpoint {
  const sm = useMediaQuery(breakpointUp('sm'));
  const md = useMediaQuery(breakpointUp('md'));
  const lg = useMediaQuery(breakpointUp('lg'));
  const xl = useMediaQuery(breakpointUp('xl'));
  const twoXl = useMediaQuery(breakpointUp('2xl'));

  if (twoXl) return '2xl';
  if (xl) return 'xl';
  if (lg) return 'lg';
  if (md) return 'md';
  if (sm) return 'sm';
  return 'xs';
}

/**
 * Hook that reports whether the viewport is at or above the given breakpoint
 * (`min-width`), matching the mobile-first `bp:` utility-class variants.
 *
 * @example
 * ```tsx
 * const isDesktop = useBreakpointUp('lg');
 * ```
 */
export function useBreakpointUp(key: BreakpointKey): boolean {
  return useMediaQuery(breakpointUp(key));
}

/**
 * Hook that reports whether the viewport is at or below the given breakpoint
 * (`max-width`), matching the design system's `@media (max-width: …)` rules.
 *
 * @example
 * ```tsx
 * const isCompact = useBreakpointDown('md');
 * ```
 */
export function useBreakpointDown(key: BreakpointKey): boolean {
  return useMediaQuery(breakpointDown(key));
}

/** Breakpoint keys ordered smallest to largest, re-exported for convenience. */
export { BREAKPOINT_ORDER };
export type { BreakpointKey };
