// main/client/engine/src/theme/density.ts

import { DEFAULT_DENSITY as SHARED_DEFAULT_DENSITY } from '@bslt/shared/constants/core';

/**
 * Theme density variants for adjusting spacing across the UI.
 *
 * - `compact`: Tighter spacing (0.75x), ideal for data-dense interfaces
 * - `normal`: Default spacing (1x), balanced for most use cases
 * - `comfortable`: Looser spacing (1.25x), more breathing room
 */

export type Density = 'compact' | 'normal' | 'comfortable';

/** Multipliers for each density level */
export const densityMultipliers = {
  compact: 0.75,
  normal: 1,
  comfortable: 1.25,
} as const;

export const DEFAULT_DENSITY: Density = SHARED_DEFAULT_DENSITY;

/**
 * Base spacing values. Fine gaps (xs–xl) are static rem numbers; page-level
 * gaps (2xl/3xl) are fluid clamp() definitions `{ min, base, slope }rem/vw`
 * whose midpoints hit the legacy values (2rem/3rem) at an 80rem viewport.
 * Must stay in sync with `main/client/ui/src/theme/spacing.ts`.
 */
const baseSpacing = {
  xs: 0.25, // 4px
  sm: 0.5, // 8px
  md: 0.75, // 12px
  lg: 1, // 16px
  xl: 1.5, // 24px
  ['2xl']: { min: 1.5, base: 1, slope: 1.25, max: 2.25 }, // 32px @ 80rem viewport
  ['3xl']: { min: 2, base: 1.5, slope: 1.875, max: 3.5 }, // 48px @ 80rem viewport
} as const;

/** Fluid clamp() spacing definition in rem (min/base/max) and vw (slope). */
type FluidSpacing = { min: number; base: number; slope: number; max: number };

function formatRem(value: number): string {
  return `${value.toFixed(3).replace(/\.?0+$/, '')}rem`;
}

function scaleSpacing(value: number | FluidSpacing, multiplier: number): string {
  if (typeof value === 'number') {
    return formatRem(value * multiplier);
  }
  const vw = `${(value.slope * multiplier).toFixed(4).replace(/\.?0+$/, '')}vw`;
  return `clamp(${formatRem(value.min * multiplier)}, ${formatRem(value.base * multiplier)} + ${vw}, ${formatRem(value.max * multiplier)})`;
}

/**
 * Generate spacing values for a given density
 */
export function getSpacingForDensity(density: Density): Record<keyof typeof baseSpacing, string> {
  const multiplier = densityMultipliers[density];
  const entries = Object.entries(baseSpacing) as [
    keyof typeof baseSpacing,
    number | FluidSpacing,
  ][];

  return Object.fromEntries(
    entries.map(([key, value]) => [key, scaleSpacing(value, multiplier)]),
  ) as Record<keyof typeof baseSpacing, string>;
}

/**
 * Generate CSS custom properties for density-scaled spacing
 */
export function getDensityCssVariables(density: Density): Record<string, string> {
  const spacing = getSpacingForDensity(density);

  return {
    ['--ui-gap-xs']: spacing.xs,
    ['--ui-gap-sm']: spacing.sm,
    ['--ui-gap-md']: spacing.md,
    ['--ui-gap-lg']: spacing.lg,
    ['--ui-gap-xl']: spacing.xl,
    ['--ui-gap-2xl']: spacing['2xl'],
    ['--ui-gap-3xl']: spacing['3xl'],
  };
}
