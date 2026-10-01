// main/client/react/src/hooks/useIsTouch.ts
import { useMediaQuery } from './useMediaQuery';

/** Media query matching devices whose primary pointer is coarse (touch). */
const COARSE_POINTER_QUERY = '(pointer: coarse)';

/**
 * Hook that reports whether the primary input is a coarse pointer (touch),
 * independent of viewport size. Use it to widen hit areas or swap hover-only
 * affordances — pair with `--ui-touch-target` (44px minimum).
 *
 * Prefer `@media (pointer: coarse)` in CSS when styling alone suffices.
 *
 * @example
 * ```tsx
 * const isTouch = useIsTouch();
 * ```
 */
export function useIsTouch(): boolean {
  return useMediaQuery(COARSE_POINTER_QUERY);
}
