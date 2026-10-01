// main/client/ui/src/theme/breakpoints.ts
/**
 * Canonical viewport breakpoint design tokens.
 *
 * The values live in `@bslt/shared/constants` (`BREAKPOINTS`) so that
 * `@bslt/react` hooks (`useIsMobile`, `useBreakpoint`) and this theme layer
 * derive from one source. They are emitted as `--ui-breakpoint-*` custom
 * properties by {@link buildThemeCss} for JS consumers and documentation.
 * CSS `@media` rules cannot reference `var()`, so every media query in the
 * codebase MUST use one of these rem values literally
 * (e.g. `@media (max-width: 48rem)`) — enforced by `pnpm lint:responsive`.
 *
 * | Token | rem | px   | Device class                                  |
 * |-------|-----|------|-----------------------------------------------|
 * | sm    | 30  | 480  | Large phones (stack below, compact paddings)  |
 * | md    | 48  | 768  | Portrait tablets — the mobile cutoff          |
 * | lg    | 64  | 1024 | Landscape tablets / small laptops             |
 * | xl    | 80  | 1280 | Laptops (fluid-token midpoint: today's look)  |
 * | 2xl   | 96  | 1536 | Large / ultrawide desktops                    |
 *
 * `md` (48rem) is the mobile boundary and stays in sync with `useIsMobile`
 * in `main/client/react/src/hooks/useIsMobile.ts` via the shared constant.
 */
import { BREAKPOINTS, CONTENT_MAX_WIDTH, TOUCH_TARGET_SIZE } from '@bslt/shared/constants';

export const breakpoints = BREAKPOINTS;

/** Inferred type of the breakpoint token record. */
export type Breakpoints = typeof breakpoints;

/**
 * Maximum readable width for main content areas (`--ui-content-max`).
 * Keeps line lengths and dashboards sane on ultrawide displays.
 */
export const contentMaxWidth = CONTENT_MAX_WIDTH; // 90rem / 1440px

/**
 * Minimum hit area for interactive elements on coarse pointers
 * (`--ui-touch-target`). 2.75rem = 44px, the WCAG/HIG touch minimum.
 */
export const touchTargetSize = TOUCH_TARGET_SIZE; // 44px
