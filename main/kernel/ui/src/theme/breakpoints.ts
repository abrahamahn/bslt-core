// main/kernel/ui/src/theme/breakpoints.ts
/**
 * Canonical viewport breakpoint design tokens owned by `@bslt/ui`.
 *
 * Emitted as `--ui-breakpoint-*` custom properties by {@link buildThemeCss}.
 * CSS `@media` rules cannot reference `var()`, so every media query in the
 * codebase MUST use one of these rem values literally
 * (e.g. `@media (max-width: 48rem)`) — enforced by `pnpm bslt gate run responsive`.
 *
 * | Token | rem | px   | Device class                                  |
 * |-------|-----|------|-----------------------------------------------|
 * | sm    | 30  | 480  | Large phones (stack below, compact paddings)  |
 * | md    | 48  | 768  | Portrait tablets — the mobile cutoff          |
 * | lg    | 64  | 1024 | Landscape tablets / small laptops             |
 * | xl    | 80  | 1280 | Laptops (fluid-token midpoint: today's look)  |
 * | 2xl   | 96  | 1536 | Large / ultrawide desktops                    |
 */
export const BREAKPOINTS = {
  sm: '30rem', // 480px
  md: '48rem', // 768px
  lg: '64rem', // 1024px
  xl: '80rem', // 1280px
  ['2xl']: '96rem', // 1536px
} as const;

export const breakpoints = BREAKPOINTS;

export type Breakpoints = typeof breakpoints;

/**
 * Widths that appear in a media query as fluid-formula crossover points rather
 * than layout breakpoints (`lint-responsive.ts` accepts these in addition to
 * `BREAKPOINTS`).
 */
export const REFERENCE_WIDTHS = {
  rootRamp: '31.25rem',
} as const;

export const contentMaxWidth = '90rem';

export const touchTargetSize = '2.75rem';
