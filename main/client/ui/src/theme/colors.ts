// main/client/ui/src/theme/colors.ts
/**
 * Theme color tokens — a monochrome palette: true black, true white, one ink.
 *
 * Single source of truth for every color used in the UI design system.
 * Colors are organized into semantic groups (core, background, border,
 * text, control, effect, alert, badge) with light and dark variants.
 *
 * The system is deliberately achromatic. `primary` is near-black on a white
 * page and near-white on a black one, so the accent *is* the theme rather than
 * a hue laid over it — a fork re-brands by changing two values. Elevation comes
 * from hairline borders and one soft lift, not from stacked shadows.
 *
 * Only `danger`, `success` and `warning` keep a hue, because there they carry
 * meaning rather than style. `info` is neutral: in a monochrome system there is
 * no accent left to distinguish it, and a blue would reintroduce exactly the
 * tint this palette removes.
 *
 * Consumed by {@link buildThemeCss} to generate CSS custom properties
 * and by the ThemeProvider at runtime.
 */

/** Core semantic colors for the light theme (brand, status, accent). */
const coreLight = {
  primary: '#0a0a0a',
  accent: '#0a0a0a',
  primaryMuted: '#f4f4f5',
  danger: '#b91c1c',
  success: '#15803d',
  warning: '#b45309',
  neutral: '#0a0a0a',
  muted: '#65656e',
} as const;

/** Core semantic colors for the dark theme (brand, status, accent). */
const coreDark = {
  primary: '#fafafa',
  accent: '#fafafa',
  primaryMuted: '#1c1c1f',
  danger: '#fca5a5',
  success: '#86efac',
  warning: '#fcd34d',
  neutral: '#fafafa',
  muted: '#a1a1aa',
} as const;

/** Background and surface colors for the light theme. */
const backgroundLight = {
  bg: '#ffffff',
  surface: '#fafafa',
  surfaceStrong: '#0a0a0a',
} as const;

/** Background and surface colors for the dark theme. */
const backgroundDark = {
  bg: '#000000',
  surface: '#0a0a0a',
  surfaceStrong: '#fafafa',
} as const;

/**
 * Border colors for the light theme.
 *
 * `border` is the hairline used for decoration — card edges, dividers, table
 * rules. It is ~1.3:1 against the page, which is the look this palette wants and
 * is fine for decoration.
 *
 * `borderStrong` is for the boundary of an interactive control (input, textarea,
 * checkbox, select), where WCAG 1.4.11 requires 3:1. It clears 3:1 against the
 * page, a raised surface, *and* the hover surface, since a control can sit on any
 * of the three.
 */
const borderLight = {
  border: '#e4e4e7',
  borderStrong: '#85858c',
} as const;

/** Border colors for the dark theme. */
const borderDark = {
  border: '#1f1f22',
  borderStrong: '#66666f',
} as const;

/** Text colors for the light theme (primary, muted, inverse). */
const textLight = {
  text: '#0a0a0a',
  textMuted: '#65656e',
  textInverse: '#fafafa',
} as const;

/** Text colors for the dark theme (primary, muted, inverse). */
const textDark = {
  text: '#fafafa',
  textMuted: '#a1a1aa',
  textInverse: '#0a0a0a',
} as const;

/** Control colors for the light theme (switch thumbs, slider handles, etc.). */
const controlLight = {
  controlThumb: '#ffffff',
} as const;

/** Control colors for the dark theme (switch thumbs, slider handles, etc.). */
const controlDark = {
  controlThumb: '#000000',
} as const;

/**
 * Interaction state surfaces for the light theme.
 *
 * `hover` and `active` are explicit rather than derived. Mixing `surface` toward
 * `border` — what the component CSS did before — produces a 1.05:1 change against
 * a true-black page, which is visually nothing. These are tuned to be perceptible
 * on both #000 and #fff while still carrying body text at AA.
 */
const interactionLight = {
  hover: '#efeff2',
  active: '#e4e4e7',
} as const;

/** Interaction state surfaces for the dark theme. */
const interactionDark = {
  hover: '#16161a',
  active: '#232329',
} as const;

/**
 * Effect colors for the light theme (box shadows, focus ring outlines).
 *
 * `shadow` is the subtle, resting elevation used by cards and panels.
 * `shadowOverlay` is the stronger, floating elevation used by transient
 * surfaces that sit above the page (dropdowns, popovers, dialogs, toasts).
 */
const effectLight = {
  shadow: '0 1px 2px rgba(9, 9, 11, 0.05)',
  shadowOverlay: '0 1px 2px rgba(9, 9, 11, 0.06), 0 8px 24px rgba(9, 9, 11, 0.08)',
  focus: '0 0 0 2px #ffffff, 0 0 0 4px #0a0a0a',
} as const;

/** Effect colors for the dark theme (box shadows, focus ring outlines). */
const effectDark = {
  shadow: '0 1px 2px rgba(0, 0, 0, 0.6)',
  shadowOverlay: '0 1px 2px rgba(0, 0, 0, 0.7), 0 8px 24px rgba(0, 0, 0, 0.65)',
  focus: '0 0 0 2px #000000, 0 0 0 4px #fafafa',
} as const;

/** Alert semantic colors for the light theme (info, success, danger, warning). */
const alertLight = {
  info: {
    bg: '#fafafa',
    border: '#e4e4e7',
    text: '#0a0a0a',
  },
  success: {
    bg: '#f0fdf4',
    border: '#bbf7d0',
    text: '#15803d',
  },
  danger: {
    bg: '#fef2f2',
    border: '#fecaca',
    text: '#b91c1c',
  },
  warning: {
    bg: '#fffbeb',
    border: '#fde68a',
    text: '#b45309',
  },
} as const;

/** Alert semantic colors for the dark theme (info, success, danger, warning). */
const alertDark = {
  info: {
    bg: '#0f0f11',
    border: '#27272a',
    text: '#fafafa',
  },
  success: {
    bg: '#0a1f14',
    border: '#166534',
    text: '#86efac',
  },
  danger: {
    bg: '#1f0d0d',
    border: '#991b1b',
    text: '#fca5a5',
  },
  warning: {
    bg: '#1f1707',
    border: '#92400e',
    text: '#fcd34d',
  },
} as const;

/** Badge semantic colors for the light theme (primary, success, danger, warning, neutral). */
const badgeLight = {
  primary: {
    bg: '#f4f4f5',
    border: '#e4e4e7',
  },
  success: {
    bg: '#f0fdf4',
    border: '#bbf7d0',
  },
  danger: {
    bg: '#fef2f2',
    border: '#fecaca',
  },
  warning: {
    bg: '#fffbeb',
    border: '#fde68a',
  },
  neutral: {
    bg: '#ffffff',
    border: '#e4e4e7',
  },
} as const;

/** Badge semantic colors for the dark theme (primary, success, danger, warning, neutral). */
const badgeDark = {
  primary: {
    bg: '#1c1c1f',
    border: '#2e2e33',
  },
  success: {
    bg: '#0a1f14',
    border: '#166534',
  },
  danger: {
    bg: '#1f0d0d',
    border: '#991b1b',
  },
  warning: {
    bg: '#1f1707',
    border: '#92400e',
  },
  neutral: {
    bg: '#000000',
    border: '#1f1f22',
  },
} as const;

/** Complete light theme color set, composed from all semantic groups. */
export const lightColors = {
  ...coreLight,
  ...backgroundLight,
  ...borderLight,
  ...textLight,
  ...controlLight,
  ...interactionLight,
  ...effectLight,
  alert: alertLight,
  badge: badgeLight,
} as const;

/** Complete dark theme color set, composed from all semantic groups. */
export const darkColors = {
  ...coreDark,
  ...backgroundDark,
  ...borderDark,
  ...textDark,
  ...controlDark,
  ...interactionDark,
  ...effectDark,
  alert: alertDark,
  badge: badgeDark,
} as const;

/** Top-level color map containing both light and dark theme variants. */
export const colors = {
  light: lightColors,
  dark: darkColors,
} as const;

/** Inferred type of the complete light color set. */
export type LightColors = typeof lightColors;
/** Inferred type of the complete dark color set. */
export type DarkColors = typeof darkColors;
/** Inferred type of the combined color map with both variants. */
export type ThemeColors = typeof colors;
