// main/kernel/ui/src/theme/buildThemeCss.ts
/**
 * Theme CSS generator for UI tokens (plan section 12.1).
 *
 * Emits layered CSS (`@layer ui.tokens, ui.base, ui.recipes, ui.utilities, app;`)
 * with brand accent scale, z-index & elevation tokens, display type scale,
 * media aspect tokens, semantic neutral hooks (`live`, `premium`, `locked`),
 * and `prefers-reduced-motion` collapse.
 */

import { buildBrandScale } from './brand';
import { breakpoints, contentMaxWidth, touchTargetSize } from './breakpoints';
import { darkColors, lightColors, type DarkColors, type LightColors } from './colors';
import { motion } from './motion';
import { radius } from './radius';
import { spacing } from './spacing';
import { typography } from './typography';

type ColorTheme = LightColors | DarkColors;

interface GenerateThemeOptions {
  readonly brandAccent?: string | undefined;
}

export function buildThemeTokens(
  colors: ColorTheme,
  options: GenerateThemeOptions = {},
): Record<string, string> {
  const tokens: Record<string, string> = {};
  const isDark = colors.bg === darkColors.bg;
  const brand = buildBrandScale(options.brandAccent);

  // Breakpoints
  tokens['--ui-breakpoint-sm'] = breakpoints.sm;
  tokens['--ui-breakpoint-md'] = breakpoints.md;
  tokens['--ui-breakpoint-lg'] = breakpoints.lg;
  tokens['--ui-breakpoint-xl'] = breakpoints.xl;
  tokens['--ui-breakpoint-2xl'] = breakpoints['2xl'];

  // Layout & media aspect tokens
  tokens['--ui-content-max'] = contentMaxWidth;
  tokens['--ui-touch-target'] = touchTargetSize;
  tokens['--ui-aspect-square'] = '1 / 1';
  tokens['--ui-aspect-video'] = '16 / 9';
  tokens['--ui-aspect-portrait'] = '3 / 4';
  tokens['--ui-aspect-wide'] = '21 / 9';

  // Z-index stacking scale
  tokens['--ui-z-base'] = '1';
  tokens['--ui-z-raised'] = '2';
  tokens['--ui-z-sticky'] = '10';
  tokens['--ui-z-header'] = '40';
  tokens['--ui-z-dropdown'] = '50';
  tokens['--ui-z-overlay'] = '999';
  tokens['--ui-z-modal'] = '1000';
  tokens['--ui-z-popover'] = '1001';
  tokens['--ui-z-peek'] = '1002';
  tokens['--ui-z-toast'] = '9998';
  tokens['--ui-z-tooltip'] = '9999';
  tokens['--ui-z-skip'] = '10000';

  // Radius
  tokens['--ui-radius-sm'] = radius.sm;
  tokens['--ui-radius-md'] = radius.md;
  tokens['--ui-radius-lg'] = radius.lg;
  tokens['--ui-radius-full'] = '999px';

  // Scrim
  tokens['--ui-color-scrim'] = 'rgb(0 0 0 / 50%)';

  // Spacing
  tokens['--ui-gap-xs'] = spacing.xs;
  tokens['--ui-gap-sm'] = spacing.sm;
  tokens['--ui-gap-md'] = spacing.md;
  tokens['--ui-gap-lg'] = spacing.lg;
  tokens['--ui-gap-xl'] = spacing.xl;
  tokens['--ui-gap-2xl'] = spacing['2xl'];
  tokens['--ui-gap-3xl'] = spacing['3xl'];

  // Border & outline
  tokens['--ui-border-width'] = '1px';
  tokens['--ui-outline-width'] = '2px';
  tokens['--ui-outline-offset'] = '2px';

  // Motion
  tokens['--ui-motion-duration-fast'] = motion.durations.fast;
  tokens['--ui-motion-duration-base'] = motion.durations.base;
  tokens['--ui-motion-duration-slow'] = motion.durations.slow;
  tokens['--ui-motion-duration-slower'] = motion.durations.slower;
  tokens['--ui-motion-duration-shimmer'] = motion.durations.shimmer;
  tokens['--ui-motion-ease-standard'] = motion.easing.standard;
  tokens['--ui-motion-ease-in'] = motion.easing.in;
  tokens['--ui-motion-ease-out'] = motion.easing.out;

  // Typography & display scale
  tokens['--ui-font-family'] = typography.fontFamily;
  tokens['--ui-font-family-mono'] = typography.fontFamilyMono;
  tokens['--ui-font-size-base'] = typography.sizes.sm;
  tokens['--ui-font-size-2xs'] = typography.sizes['2xs'];
  tokens['--ui-font-size-xs'] = typography.sizes.xs;
  tokens['--ui-font-size-sm'] = typography.sizes.sm;
  tokens['--ui-font-size-md'] = typography.sizes.md;
  tokens['--ui-font-size-lg'] = typography.sizes.lg;
  tokens['--ui-font-size-xl'] = typography.sizes.xl;
  tokens['--ui-font-size-2xl'] = typography.sizes['2xl'];
  tokens['--ui-font-size-3xl'] = typography.sizes['3xl'];
  tokens['--ui-font-size-display'] = typography.sizes.display;
  tokens['--ui-font-weight-regular'] = typography.weights.regular.toString();
  tokens['--ui-font-weight-medium'] = typography.weights.medium.toString();
  tokens['--ui-font-weight-semibold'] = typography.weights.semibold.toString();
  tokens['--ui-font-weight-bold'] = typography.weights.bold.toString();
  tokens['--ui-line-height-base'] = typography.lineHeights.normal.toString();
  tokens['--ui-line-height-tight'] = typography.lineHeights.tight.toString();
  tokens['--ui-line-height-normal'] = typography.lineHeights.normal.toString();
  tokens['--ui-line-height-loose'] = typography.lineHeights.loose.toString();

  // Brand accent scale (50-950) + active brand & on-brand ink
  for (const [step, hex] of Object.entries(brand.scale)) {
    tokens[`--ui-color-brand-${step}`] = hex;
  }
  tokens['--ui-color-brand'] = isDark ? brand.darkBrand : brand.lightBrand;
  tokens['--ui-color-on-brand'] = isDark ? brand.darkOnBrand : brand.lightOnBrand;

  // Core colors + neutral fork hooks (live, premium, locked)
  tokens['--ui-color-primary'] = colors.primary;
  tokens['--ui-color-accent'] = colors.accent;
  tokens['--ui-color-primary-muted'] = colors.primaryMuted;
  tokens['--ui-color-hover'] = colors.hover;
  tokens['--ui-color-active'] = colors.active;
  tokens['--ui-color-danger'] = colors.danger;
  tokens['--ui-color-success'] = colors.success;
  tokens['--ui-color-warning'] = colors.warning;
  tokens['--ui-color-neutral'] = colors.neutral;
  tokens['--ui-color-muted'] = colors.muted;
  tokens['--ui-color-live'] = colors.live;
  tokens['--ui-color-premium'] = colors.premium;
  tokens['--ui-color-locked'] = colors.locked;

  // Background colors
  tokens['--ui-color-bg'] = colors.bg;
  tokens['--ui-color-surface'] = colors.surface;
  tokens['--ui-color-surface-strong'] = colors.surfaceStrong;

  // Border colors
  tokens['--ui-color-border'] = colors.border;
  tokens['--ui-color-border-control'] = colors.borderControl;
  tokens['--ui-layout-border'] = 'var(--ui-border-width) solid var(--ui-color-border)';

  // Effects & elevation scale
  tokens['--ui-color-shadow'] = colors.shadow;
  tokens['--ui-color-shadow-overlay'] = colors.shadowOverlay;
  tokens['--ui-elevation-none'] = 'none';
  tokens['--ui-elevation-xs'] = colors.shadow;
  tokens['--ui-elevation-sm'] = colors.shadow;
  tokens['--ui-elevation-md'] = colors.shadowOverlay;
  tokens['--ui-elevation-lg'] = colors.shadowOverlay;
  tokens['--ui-elevation-overlay'] = colors.shadowOverlay;
  tokens['--ui-focus'] = colors.focus;

  // Text colors
  tokens['--ui-color-text'] = colors.text;
  tokens['--ui-color-text-muted'] = colors.textMuted;
  tokens['--ui-color-text-inverse'] = colors.textInverse;

  // Control colors
  tokens['--ui-color-control-thumb'] = colors.controlThumb;

  // Alert semantic colors
  for (const tone of [
    'info',
    'success',
    'danger',
    'warning',
    'live',
    'premium',
    'locked',
  ] as const) {
    tokens[`--ui-alert-${tone}-bg`] = colors.alert[tone].bg;
    tokens[`--ui-alert-${tone}-border`] = colors.alert[tone].border;
    tokens[`--ui-alert-${tone}-text`] = colors.alert[tone].text;
  }

  // Badge semantic colors
  for (const tone of [
    'primary',
    'success',
    'danger',
    'warning',
    'neutral',
    'live',
    'premium',
    'locked',
  ] as const) {
    tokens[`--ui-badge-${tone}-bg`] = colors.badge[tone].bg;
    tokens[`--ui-badge-${tone}-border`] = colors.badge[tone].border;
  }

  return tokens;
}

function serializeTokens(tokens: Record<string, string>, indent = '    '): string {
  return Object.entries(tokens)
    .map(([key, value]) => `${indent}${key}: ${value};`)
    .join('\n');
}

export function generateThemeCss(options: GenerateThemeOptions = {}): string {
  const lightTokens = buildThemeTokens(lightColors, options);
  const darkTokens = buildThemeTokens(darkColors, options);

  const reducedMotion = [
    '  @media (prefers-reduced-motion: reduce) {',
    '    :root {',
    '      --ui-motion-duration-fast: 0ms;',
    '      --ui-motion-duration-base: 0ms;',
    '      --ui-motion-duration-slow: 0ms;',
    '      --ui-motion-duration-slower: 0ms;',
    '      --ui-motion-duration-shimmer: 0ms;',
    '    }',
    '  }',
  ].join('\n');

  return [
    '@layer ui.tokens, ui.base, ui.recipes, ui.utilities, app;',
    '',
    '@layer ui.tokens {',
    '  :root {',
    serializeTokens(lightTokens),
    '  }',
    '',
    "  :root[data-theme='light'] {",
    serializeTokens(lightTokens),
    '  }',
    '',
    "  :root[data-theme='dark'] {",
    serializeTokens(darkTokens),
    '  }',
    '',
    '  @media (prefers-color-scheme: dark) {',
    '    :root:not([data-theme]) {',
    serializeTokens(darkTokens, '      '),
    '    }',
    '  }',
    '',
    reducedMotion,
    '}',
    '',
  ].join('\n');
}
