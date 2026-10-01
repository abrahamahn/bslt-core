// main/client/ui/src/theme/typography.ts
/**
 * Typography design tokens.
 *
 * Defines the font family stack, type scale sizes, font weights, and
 * line heights used across the UI. Consumed by {@link buildThemeCss} to
 * generate `--ui-font-*` and `--ui-line-height-*` CSS custom properties.
 *
 * **Font family:** System font stack for fast rendering without web font downloads.
 *
 * **Sizes:** body sizes (2xs–md) are static rem for readability. Heading
 * sizes (lg/xl) are fluid `clamp()` values whose midpoints hit the
 * historical values (1.25rem/1.5rem) at an 80rem (1280px) viewport, so
 * laptops render today's design unchanged while phones/ultrawides scale.
 *
 * | Token | Value                                    | px @80rem |
 * |-------|------------------------------------------|-----------|
 * | 2xs   | 0.625rem                                 | 10        |
 * | xs    | 0.75rem                                  | 12        |
 * | sm    | 0.875rem                                 | 14        |
 * | md    | 1rem                                     | 16        |
 * | lg    | clamp(1.125rem, 1rem + 0.3125vw, 1.375rem) | 20      |
 * | xl    | clamp(1.25rem, 1rem + 0.625vw, 1.75rem)  | 24        |
 */
export const typography = {
  fontFamily:
    'system-ui, -apple-system, Segoe UI, sans-serif, Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji',
  fontFamilyMono: 'Monaco, Menlo, "Ubuntu Mono", Consolas, "Courier New", monospace',
  sizes: {
    ['2xs']: '0.625rem', // 10px
    xs: '0.75rem', // 12px
    sm: '0.875rem', // 14px
    md: '1rem', // 16px
    lg: 'clamp(1.125rem, 1rem + 0.3125vw, 1.375rem)', // 20px @ 80rem viewport
    xl: 'clamp(1.25rem, 1rem + 0.625vw, 1.75rem)', // 24px @ 80rem viewport
  },
  weights: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  lineHeights: {
    tight: 1.2,
    normal: 1.5,
    loose: 1.7,
  },
} as const;

/** Inferred type of the typography token record. */
export type Typography = typeof typography;
