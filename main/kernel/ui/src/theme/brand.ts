// main/kernel/ui/src/theme/brand.ts
/**
 * Brand accent scale generator (plan section 12.1).
 *
 * Derives an 11-step `50..950` sRGB `#rrggbb` ramp plus accessible light/dark
 * brand fills and `on-brand` ink from an `oklch(L C H)` or `#rrggbb` brand
 * accent string configured in `bslt.config.ts`.
 */

const DEFAULT_BRAND_ACCENT = 'oklch(0.62 0.19 264)';

type BrandStep =
  '50' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900' | '950';

interface BrandPalette {
  readonly scale: Readonly<Record<BrandStep, string>>;
  readonly lightBrand: string;
  readonly lightOnBrand: string;
  readonly darkBrand: string;
  readonly darkOnBrand: string;
}

const OKLCH_RE = /^oklch\(\s*([+-]?\d*\.?\d+)\s+([+-]?\d*\.?\d+)\s+([+-]?\d*\.?\d+)\s*\)$/iu;
const HEX_RE = /^#([0-9a-f]{6})$/iu;

function linearToSrgbChannel(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  const gamma = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, gamma)) * 255);
}

function srgbChannelToLinear(byte: number): number {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function oklchToLinearRgb(l: number, c: number, hDeg: number): readonly [number, number, number] {
  const hRad = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);

  const lPrime = l + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = l - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = l - 0.0894841775 * a - 1.291485548 * b;

  const lCube = lPrime * lPrime * lPrime;
  const mCube = mPrime * mPrime * mPrime;
  const sCube = sPrime * sPrime * sPrime;

  const r = 4.0767416621 * lCube - 3.3077115913 * mCube + 0.2309699292 * sCube;
  const g = -1.2684380046 * lCube + 2.6097574011 * mCube - 0.3413193965 * sCube;
  const bl = -0.0041960863 * lCube - 0.7034186147 * mCube + 1.707614701 * sCube;
  return [r, g, bl];
}

function inSrgbGamut(rgb: readonly [number, number, number]): boolean {
  return rgb.every((channel) => channel >= -0.0005 && channel <= 1.0005);
}

function oklchToHex(l: number, maxChroma: number, hDeg: number): string {
  // Binary-search chroma down into the sRGB gamut so lightness stays exact for WCAG contrast.
  let lo = 0;
  let hi = Math.max(0, maxChroma);
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (inSrgbGamut(oklchToLinearRgb(l, mid, hDeg))) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const [r, g, b] = oklchToLinearRgb(l, lo, hDeg);
  const hex = [r, g, b]
    .map((channel) => linearToSrgbChannel(channel).toString(16).padStart(2, '0'))
    .join('');
  return `#${hex}`;
}

function hexToOklch(hex: string): { readonly l: number; readonly c: number; readonly h: number } {
  const r = srgbChannelToLinear(Number.parseInt(hex.slice(1, 3), 16));
  const g = srgbChannelToLinear(Number.parseInt(hex.slice(3, 5), 16));
  const b = srgbChannelToLinear(Number.parseInt(hex.slice(5, 7), 16));

  const lCone = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const mCone = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const sCone = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const l = 0.2104542553 * lCone + 0.793617785 * mCone - 0.0040720468 * sCone;
  const a = 1.9779984951 * lCone - 2.428592205 * mCone + 0.4505937099 * sCone;
  const bVal = 0.0259040371 * lCone + 0.7827717662 * mCone - 0.808675766 * sCone;

  const c = Math.hypot(a, bVal);
  const h = ((Math.atan2(bVal, a) * 180) / Math.PI + 360) % 360;
  return { l, c, h };
}

function parseBrandOklch(input: string): {
  readonly l: number;
  readonly c: number;
  readonly h: number;
} {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new Error('Brand accent colour must not be empty');
  }
  const oklchMatch = OKLCH_RE.exec(trimmed);
  if (oklchMatch !== null) {
    const l = Number(oklchMatch[1]);
    const c = Number(oklchMatch[2]);
    const h = Number(oklchMatch[3]);
    if (!Number.isFinite(l) || l < 0 || l > 1) {
      throw new Error(`Brand accent OKLCH lightness must be in [0, 1], got ${String(l)}`);
    }
    if (!Number.isFinite(c) || c < 0 || c > 0.5) {
      throw new Error(`Brand accent OKLCH chroma must be in [0, 0.5], got ${String(c)}`);
    }
    if (!Number.isFinite(h)) {
      throw new Error(`Brand accent OKLCH hue must be finite, got "${trimmed}"`);
    }
    return { l, c, h: ((h % 360) + 360) % 360 };
  }
  if (HEX_RE.test(trimmed)) {
    return hexToOklch(trimmed);
  }
  throw new Error(`Unsupported brand accent "${input}": expected oklch(L C H) or #rrggbb`);
}

const STEP_SPECS: ReadonlyArray<
  readonly [step: BrandStep, lightness: number, chromaFactor: number]
> = [
  ['50', 0.97, 0.14],
  ['100', 0.93, 0.28],
  ['200', 0.86, 0.5],
  ['300', 0.79, 0.72],
  ['400', 0.74, 0.88],
  ['500', 0.62, 1.0],
  ['600', 0.49, 0.96],
  ['700', 0.41, 0.86],
  ['800', 0.33, 0.7],
  ['900', 0.25, 0.52],
  ['950', 0.18, 0.36],
];

export function buildBrandScale(accent: string = DEFAULT_BRAND_ACCENT): BrandPalette {
  const { c, h } = parseBrandOklch(accent);
  const scale = {} as Record<BrandStep, string>;
  for (const [step, lightness, factor] of STEP_SPECS) {
    scale[step] = oklchToHex(lightness, c * factor, h);
  }
  return {
    scale,
    lightBrand: scale['600'],
    lightOnBrand: '#ffffff',
    darkBrand: scale['400'],
    darkOnBrand: '#0a0a0a',
  };
}
