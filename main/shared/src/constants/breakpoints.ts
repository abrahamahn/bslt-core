// main/shared/src/constants/breakpoints.ts
/**
 * Canonical viewport breakpoint scale shared by every runtime.
 *
 * Single source of truth for responsive boundaries across the design system:
 * - `@bslt/ui` re-exports these as theme tokens and emits `--ui-breakpoint-*`
 *   custom properties (see `main/client/ui/src/theme/breakpoints.ts`).
 * - `@bslt/react` derives its media-query hooks (`useIsMobile`,
 *   `useBreakpoint`) from this scale.
 * - `main/tools/scripts/lint/lint-responsive.ts` enforces that CSS width
 *   media queries only use these rem values.
 *
 * | Token | rem | px   | Device class                                  |
 * |-------|-----|------|-----------------------------------------------|
 * | sm    | 30  | 480  | Large phones (stack below, compact paddings)  |
 * | md    | 48  | 768  | Portrait tablets — the mobile cutoff          |
 * | lg    | 64  | 1024 | Landscape tablets / small laptops             |
 * | xl    | 80  | 1280 | Laptops (fluid-token midpoint: today's look)  |
 * | 2xl   | 96  | 1536 | Large / ultrawide desktops                    |
 *
 * CSS `@media` rules cannot reference `var()`, so stylesheets must use these
 * rem values literally (e.g. `@media (max-width: 48rem)`).
 */
export const BREAKPOINTS = {
  sm: '30rem', // 480px
  md: '48rem', // 768px
  lg: '64rem', // 1024px
  xl: '80rem', // 1280px
  ['2xl']: '96rem', // 1536px
} as const;

/** Named breakpoint key in the canonical scale. */
export type BreakpointKey = keyof typeof BREAKPOINTS;

/** Breakpoint keys ordered smallest to largest. */
export const BREAKPOINT_ORDER: readonly BreakpointKey[] = ['sm', 'md', 'lg', 'xl', '2xl'];

/**
 * The mobile boundary: viewports at or below `BREAKPOINTS.md` are treated as
 * mobile by `useIsMobile` and by `@media (max-width: 48rem)` rules.
 */
export const MOBILE_BREAKPOINT: BreakpointKey = 'md';

/**
 * Widths that appear in a media query but are **not** layout breakpoints.
 *
 * The canonical scale above answers "when does the layout change shape". These
 * answer something else: they are the crossover points of a fluid formula, and
 * their value is derived from that formula rather than chosen from a scale.
 * Snapping one to the nearest breakpoint would not tidy it, it would silently
 * re-tune the curve it belongs to.
 *
 * `lint-responsive.ts` accepts these in addition to `BREAKPOINTS`, so the
 * numbers stay declared in one place and an undeclared width still fails. Add
 * an entry only when the width is genuinely derived, and record the derivation.
 */
export const REFERENCE_WIDTHS = {
  /**
   * Where the root font-size ramp begins (`AppShell.css`).
   *
   * The ramp is `clamp(0.75rem, 3.2vw, 1rem)` on `html`, and `3.2vw` equals
   * exactly `1rem` at this width — so the gate opens precisely where the ramp
   * would otherwise start shrinking text, with no step at the boundary.
   *
   * Expressed in rem rather than the equivalent 500px on purpose. On the root
   * element, `rem` resolves against the browser's *initial* font size, and so
   * does `rem` inside a media query — so both sides track the reader's own font
   * preference and the boundary stays continuous for all of them. Hard-coding
   * `500px` pins the gate to the 16px default while the clamp keeps moving:
   * a reader on a 20px default would cross a 500px gate and have the root drop
   * 20px → 16px in a single pixel of resize.
   */
  rootRamp: '31.25rem', // 500px at the usual 16px root
} as const;

/** Maximum readable width for main content areas (`--ui-content-max`). */
export const CONTENT_MAX_WIDTH = '90rem'; // 1440px

/**
 * Minimum hit area for interactive elements on coarse pointers
 * (`--ui-touch-target`). 2.75rem = 44px, the WCAG/HIG touch minimum.
 */
export const TOUCH_TARGET_SIZE = '2.75rem'; // 44px

/**
 * Media query matching viewports at or above the given breakpoint
 * (mobile-first, mirrors the `bp:` utility-class variants).
 *
 * @example breakpointUp('md') // '(min-width: 48rem)'
 */
export function breakpointUp(key: BreakpointKey): string {
  return `(min-width: ${BREAKPOINTS[key]})`;
}

/**
 * Media query matching viewports at or below the given breakpoint
 * (mirrors the design system's `@media (max-width: …)` convention).
 *
 * @example breakpointDown('md') // '(max-width: 48rem)'
 */
export function breakpointDown(key: BreakpointKey): string {
  return `(max-width: ${BREAKPOINTS[key]})`;
}
