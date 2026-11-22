// main/kernel/ui/src/theme/contrast.ts
/**
 * The colour pairs the theme tokens render together, and their WCAG contrast.
 *
 * `contrast.test.ts` is the contrast gate (restructure plan, section 12): it
 * runs `auditContrast` on the light and dark themes and on both with the
 * high-contrast overrides, and fails below 4.5:1 for text (WCAG 1.4.3) and
 * below 3:1 for the parts of a control and the focus ring (WCAG 1.4.11).
 *
 * The pairs are derived from the token names by the rules in `contrastPairs`,
 * so a new token joins the gate by existing. A colour token that no rule
 * reaches must be named in `DECORATION`, or the gate fails.
 */
import { highContrastDarkOverrides, highContrastLightOverrides } from '@bslt/client-engine';

import { buildThemeTokens } from './buildThemeCss';
import { darkColors, lightColors } from './colors';

/** WCAG 2.1 AA, normal text (1.4.3). */
export const AA_TEXT = 4.5;
/** WCAG 2.1 AA, user interface components and graphical objects (1.4.11). */
export const AA_UI = 3;

type Tokens = Readonly<Record<string, string>>;

export const THEME_NAMES = ['light', 'dark', 'light-high-contrast', 'dark-high-contrast'] as const;
type ThemeName = (typeof THEME_NAMES)[number];

/** The CSS custom properties of a theme, as the browser resolves them. */
export function themeTokens(name: ThemeName): Tokens {
  switch (name) {
    case 'light':
      return buildThemeTokens(lightColors);
    case 'dark':
      return buildThemeTokens(darkColors);
    case 'light-high-contrast':
      return { ...buildThemeTokens(lightColors), ...highContrastLightOverrides };
    case 'dark-high-contrast':
      return { ...buildThemeTokens(darkColors), ...highContrastDarkOverrides };
  }
}

const HEX = /^#[0-9a-f]{6}$/iu;

/** Relative luminance per WCAG 2.1, from a `#rrggbb` string. */
function relativeLuminance(hex: string): number {
  if (!HEX.test(hex)) throw new Error(`not a #rrggbb colour: ${hex}`);
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((offset) => {
    const srgb = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG contrast ratio between two `#rrggbb` colours, 1:1 to 21:1.
 *
 * @throws {Error} When a value is not a six-digit hex colour.
 */
export function contrastRatio(a: string, b: string): number {
  const [lighter = 0, darker = 0] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

/** The ring colours of a focus `box-shadow`, innermost first. */
export function focusRingColors(boxShadow: string): string[] {
  return boxShadow.match(/#[0-9a-f]{6}/giu) ?? [];
}

interface ContrastPair {
  /** What a person sees, for the failure message. */
  readonly what: string;
  /** Token name of the text, border, thumb or ring. */
  readonly foreground: string;
  /** Token name of what it is drawn on. */
  readonly background: string;
  readonly foregroundColor: string;
  readonly backgroundColor: string;
  readonly minimum: typeof AA_TEXT | typeof AA_UI;
}

const FOCUS = '--ui-focus';
const INNER_RING = `${FOCUS} (inner ring)`;
const color = (name: string): string => `--ui-color-${name}`;

/** Surfaces body text is set on: the page, a raised surface, and both pressed states. */
const TEXT_SURFACES = ['bg', 'surface', 'hover', 'active'] as const;
/** Surfaces a control sits on. */
const CONTROL_SURFACES = ['bg', 'surface', 'hover'] as const;
const TEXT = [
  ['text', 'body text'],
  ['text-muted', 'muted text'],
] as const;
/** Colours used as text or as a mark on the page: links, status text, the radio dot. */
const INKS = [
  'primary',
  'accent',
  'brand',
  'neutral',
  'muted',
  'danger',
  'success',
  'warning',
  'live',
  'premium',
  'locked',
] as const;
/** Fills that carry a label in the inverse text colour: buttons, tooltips, environment badges. */
const LABELLED_FILLS = [
  'primary',
  'danger',
  'success',
  'warning',
  'muted',
  'surface-strong',
] as const;

const SURFACE_NAMES: Readonly<Record<string, string>> = {
  bg: 'the page',
  surface: 'a raised surface',
  hover: 'a hovered surface',
  active: 'a pressed surface',
};

/**
 * Every pair of the token set, by rule:
 *
 * 1. text and muted text on each surface text is set on (4.5:1);
 * 2. each ink on the page and on a raised surface (4.5:1);
 * 3. the inverse label on each fill that carries one (4.5:1);
 * 4. `--ui-color-on-<name>` on `--ui-color-<name>` (4.5:1);
 * 5. `--ui-<family>-<tone>-text` on `--ui-<family>-<tone>-bg`, and the tone's ink
 *    on `--ui-badge-<tone>-bg` and on the muted primary fill (4.5:1);
 * 6. the control border on each surface a control sits on (3:1);
 * 7. the switch thumb on its checked and unchecked track (3:1);
 * 8. the focus ring on each surface a control sits on, and on its own inner
 *    ring when it has one (3:1).
 */
export function contrastPairs(tokens: Tokens): ContrastPair[] {
  const pairs: ContrastPair[] = [];
  const add = (
    what: string,
    foreground: string,
    background: string,
    minimum: ContrastPair['minimum'],
    colors?: { readonly foreground?: string; readonly background?: string },
  ): void => {
    const foregroundColor = colors?.foreground ?? tokens[foreground];
    const backgroundColor = colors?.background ?? tokens[background];
    if (foregroundColor === undefined || backgroundColor === undefined) {
      throw new Error(`contrast pair "${what}" names a token the theme does not define`);
    }
    pairs.push({ what, foreground, background, foregroundColor, backgroundColor, minimum });
  };
  const surfaceName = (surface: string): string => SURFACE_NAMES[surface] ?? surface;

  for (const [text, label] of TEXT) {
    for (const surface of TEXT_SURFACES) {
      add(`${label} on ${surfaceName(surface)}`, color(text), color(surface), AA_TEXT);
    }
  }
  for (const ink of INKS) {
    for (const surface of ['bg', 'surface'] as const) {
      add(`${ink} ink on ${surfaceName(surface)}`, color(ink), color(surface), AA_TEXT);
    }
  }
  for (const fill of LABELLED_FILLS) {
    add(`label on a ${fill} fill`, color('text-inverse'), color(fill), AA_TEXT);
  }

  for (const name of Object.keys(tokens)) {
    const onColor = /^--ui-color-on-(.+)$/u.exec(name);
    if (onColor?.[1] !== undefined) {
      add(`text on ${onColor[1]}`, name, color(onColor[1]), AA_TEXT);
    }
    const familyText = /^(--ui-[a-z]+-[a-z]+)-text$/u.exec(name);
    if (familyText?.[1] !== undefined) {
      add(
        `${familyText[1].slice('--ui-'.length)} text on its fill`,
        name,
        `${familyText[1]}-bg`,
        AA_TEXT,
      );
    }
    const badge = /^--ui-badge-([a-z]+)-bg$/u.exec(name);
    if (badge?.[1] !== undefined) {
      add(`${badge[1]} badge ink on its fill`, color(badge[1]), name, AA_TEXT);
    }
  }
  add('default badge ink on its fill', color('primary'), color('primary-muted'), AA_TEXT);
  add('body text on a selected option', color('text'), color('primary-muted'), AA_TEXT);

  for (const surface of CONTROL_SURFACES) {
    add(
      `control border on ${surfaceName(surface)}`,
      color('border-control'),
      color(surface),
      AA_UI,
    );
  }
  add('switch thumb on the checked track', color('control-thumb'), color('primary'), AA_UI);
  add(
    'switch thumb on the unchecked track',
    color('control-thumb'),
    color('border-control'),
    AA_UI,
  );

  const rings = focusRingColors(tokens[FOCUS] ?? '');
  const outer = rings.at(-1);
  if (outer === undefined) throw new Error(`${FOCUS} names no ring colour`);
  for (const surface of CONTROL_SURFACES) {
    add(`focus ring on ${surfaceName(surface)}`, FOCUS, color(surface), AA_UI, {
      foreground: outer,
    });
  }
  const inner = rings.length > 1 ? rings[0] : undefined;
  if (inner !== undefined) {
    add('focus ring on its inner ring', FOCUS, INNER_RING, AA_UI, {
      foreground: outer,
      background: inner,
    });
  }
  return pairs;
}

/** One line per pair below its minimum. */
export function auditContrast(tokens: Tokens): string[] {
  return contrastPairs(tokens).flatMap((pair) => {
    const ratio = contrastRatio(pair.foregroundColor, pair.backgroundColor);
    if (ratio >= pair.minimum) return [];
    return [
      `${pair.what}: ${pair.foreground} (${pair.foregroundColor}) on ` +
        `${pair.background} (${pair.backgroundColor}) is ${ratio.toFixed(2)}:1, ` +
        `below ${String(pair.minimum)}:1`,
    ];
  });
}

/**
 * Colour tokens that are decoration: nothing a person has to read or operate is
 * drawn in them, so no contrast minimum applies.
 */
const DECORATION: ReadonlyArray<readonly [token: RegExp, why: string]> = [
  [/^--ui-color-border$/u, 'the hairline: card edges, dividers, table rules; never a control'],
  [/^--ui-layout-border$/u, 'the hairline as a border shorthand'],
  [/^--ui-(?:alert|badge)-[a-z]+-border$/u, 'the edge of a fill whose text is held'],
  [/^--ui-color-shadow(?:-overlay)?$/u, 'elevation'],
  [/^--ui-elevation-[a-z]+$/u, 'elevation shadow tokens'],
  [/^--ui-color-scrim$/u, 'dims what is behind a dialog'],
  [
    /^--ui-color-brand-(?:50|100|200|300|400|500|600|700|800|900|950)$/u,
    'brand accent ramp steps; active brand/on-brand pair is checked via --ui-color-brand / --ui-color-on-brand',
  ],
];

const HOLDS_A_COLOR = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/iu;

/** Colour tokens that are in no pair and are not named as decoration. */
export function unclassifiedColorTokens(tokens: Tokens): string[] {
  const paired = new Set(
    contrastPairs(tokens).flatMap((pair) => [pair.foreground, pair.background]),
  );
  return Object.entries(tokens)
    .filter(([, value]) => HOLDS_A_COLOR.test(value))
    .map(([name]) => name)
    .filter((name) => !paired.has(name) && !DECORATION.some(([pattern]) => pattern.test(name)));
}
