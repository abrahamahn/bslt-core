// main/client/ui/src/theme/spacing.ts
/**
 * Base spacing design tokens.
 *
 * Provides the default (normal density) spacing scale in rem units.
 * Used by {@link buildThemeCss} to generate `--ui-gap-*` CSS custom properties
 * and by {@link density} utilities as the base values before multiplier scaling.
 *
 * Fine gaps (xs–xl) are static rem for readability and density stability.
 * Page-level gaps (2xl/3xl) are fluid `clamp()` values that scale with the
 * viewport; their midpoints hit the historical values (2rem/3rem) at an
 * 80rem (1280px) viewport, so laptops render today's design unchanged.
 * These clamp strings must stay in sync with the density engine
 * (`main/client/engine/src/theme/density.ts`), which re-emits them scaled
 * by the density multiplier at runtime.
 *
 * | Token | Value                              | Pixels @80rem |
 * |-------|------------------------------------|---------------|
 * | xs    | 0.25rem                            | 4px           |
 * | sm    | 0.5rem                             | 8px           |
 * | md    | 0.75rem                            | 12px          |
 * | lg    | 1rem                               | 16px          |
 * | xl    | 1.5rem                             | 24px          |
 * | 2xl   | clamp(1.5rem, 1rem + 1.25vw, 2.25rem)   | 32px    |
 * | 3xl   | clamp(2rem, 1.5rem + 1.875vw, 3.5rem)   | 48px    |
 */
export const spacing = {
  xs: '0.25rem', // 4px
  sm: '0.5rem', // 8px
  md: '0.75rem', // 12px
  lg: '1rem', // 16px
  xl: '1.5rem', // 24px
  ['2xl']: 'clamp(1.5rem, 1rem + 1.25vw, 2.25rem)', // 32px @ 80rem viewport
  ['3xl']: 'clamp(2rem, 1.5rem + 1.875vw, 3.5rem)', // 48px @ 80rem viewport
} as const;

/** Inferred type of the spacing token record. */
export type Spacing = typeof spacing;
