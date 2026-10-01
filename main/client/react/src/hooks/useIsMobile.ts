// main/client/react/src/hooks/useIsMobile.ts
import { MOBILE_BREAKPOINT, breakpointDown } from '@bslt/shared/constants';

import { useMediaQuery } from './useMediaQuery';

/** Media query matching the design system's mobile breakpoint (md, 48rem). */
const MOBILE_MEDIA_QUERY = breakpointDown(MOBILE_BREAKPOINT);

/**
 * Hook that reports whether the viewport is at or below the design system's
 * mobile breakpoint (`md`, 48rem), derived from the canonical scale in
 * `@bslt/shared/constants`.
 *
 * @example
 * ```tsx
 * const isMobile = useIsMobile();
 * ```
 */
export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_MEDIA_QUERY);
}
