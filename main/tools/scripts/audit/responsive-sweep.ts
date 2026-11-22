// main/tools/scripts/audit/responsive-sweep.ts
/**
 * The responsive contract, executed: load the key pages at the width ladder a
 * phone actually spans and assert the invariants that per-device fixes used to
 * guard by hand (docs/dev/responsive.md; ported from ganbate).
 *
 * Asserted per page × width:
 *   - no horizontal document overflow (the classic "strip down the side")
 *   - below the ramp reference width, the root ramp is ACTIVE (html font < 16px) —
 *     the single rule that makes every rem-sized component device-proportional
 *   - any text input computes to ≥16 REAL px, or iOS zooms the page on focus
 *
 * Network-dependent by nature (it drives a real browser at a real URL), so it
 * is NOT part of the merge gate: run it before pushing UI work, and after any
 * change to tokens, breakpoints, or the root ramp.
 *
 *   BASE_URL=http://localhost:5173 pnpm bslt report responsive-sweep
 *   SWEEP_PAGES=/,/pricing,/login pnpm bslt report responsive-sweep   # override the page list
 */

import { chromium, devices, webkit, type Browser, type Page } from '@playwright/test';

import { REFERENCE_WIDTHS } from '../../../kernel/ui/src/theme/breakpoints';

const BASE_URL = process.env['BASE_URL'] ?? 'http://localhost:5173';
/**
 * Where the root ramp starts, in the CSS pixels this sweep drives.
 *
 * Read from the shared declaration rather than written as 500 so the two cannot
 * drift: change the ramp's coefficient and this ladder follows. The rem→px
 * conversion is sound here specifically because Playwright runs with the
 * default 16px root — on a reader's own browser the boundary moves with their
 * font preference, which is the point of declaring it in rem.
 */
const ROOT_RAMP_PX = Number.parseFloat(REFERENCE_WIDTHS.rootRamp) * 16;
/** The width ladder: Fold cover, Galaxy narrow, Galaxy, iPhone, big iPhone, the authoring reference. */
const WIDTHS = [280, 320, 360, 390, 430, ROOT_RAMP_PX] as const;
const PAGES = (process.env['SWEEP_PAGES'] ?? '/,/pricing').split(',');
/** iOS zooms the page onto any focused input under 16 real px. */
const INPUT_FONT_FLOOR_PX = 15.5;

interface Violation {
  readonly width: number;
  readonly page: string;
  readonly rule: string;
}

async function dismissGates(page: Page): Promise<void> {
  try {
    await page.getByRole('button', { name: /Accept All/i }).click({ timeout: 2500, force: true });
  } catch {
    /* already answered, or not shown */
  }
}

interface PageProbe {
  readonly vw: number;
  readonly docW: number;
  readonly rootFontPx: number;
  readonly inputFontPx: number | null;
}

async function probe(page: Page): Promise<PageProbe> {
  return page.evaluate(() => {
    const input = document.querySelector('.input');
    return {
      vw: document.documentElement.clientWidth,
      docW: document.documentElement.scrollWidth,
      rootFontPx: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
      inputFontPx: input === null ? null : Number.parseFloat(getComputedStyle(input).fontSize),
    };
  });
}

function check(width: number, route: string, m: PageProbe): Violation[] {
  const violations: Violation[] = [];
  const flag = (rule: string): void => {
    violations.push({ width, page: route, rule });
  };

  if (m.docW > m.vw + 1)
    flag(`horizontal overflow: document ${String(m.docW)}px in ${String(m.vw)}px`);
  if (width < ROOT_RAMP_PX && m.rootFontPx >= 16)
    flag(`root ramp inactive: html font ${String(m.rootFontPx)}px`);
  if (m.inputFontPx !== null && m.inputFontPx < INPUT_FONT_FLOOR_PX) {
    flag(`input font ${String(m.inputFontPx)}px < 16px — iOS will zoom on focus`);
  }
  return violations;
}

async function sweep(browser: Browser, engineName: string, width: number): Promise<Violation[]> {
  const ctx = await browser.newContext({
    ...devices['Pixel 7'],
    viewport: { width, height: 850 },
    colorScheme: 'dark',
  });
  const page = await ctx.newPage();
  const violations: Violation[] = [];

  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 45_000 });
  await page.waitForTimeout(1200);
  await dismissGates(page);

  for (const route of PAGES) {
    if (route !== '/')
      await page.goto(`${BASE_URL}${route}`, { waitUntil: 'load', timeout: 45_000 });
    await page.waitForTimeout(1200);
    const m = await probe(page);
    const found = check(width, route, m);
    violations.push(...found);
    const status = found.length === 0 ? 'ok' : `FAIL ${found.map((v) => v.rule).join('; ')}`;
    console.log(`  ${engineName} ${String(width)}px ${route.padEnd(11)} ${status}`);
  }

  await ctx.close();
  return violations;
}

export async function run(): Promise<number> {
  const all: Violation[] = [];

  console.log(`Responsive sweep against ${BASE_URL}`);
  const chromiumBrowser = await chromium.launch();
  for (const width of WIDTHS) all.push(...(await sweep(chromiumBrowser, 'chromium', width)));
  await chromiumBrowser.close();

  // One WebKit pass at iPhone width: the engine real iPhones run.
  const webkitBrowser = await webkit.launch();
  all.push(...(await sweep(webkitBrowser, 'webkit  ', 390)));
  await webkitBrowser.close();

  if (all.length > 0) {
    console.error(`\nResponsive sweep FAILED: ${String(all.length)} violation(s).`);
    return 1;
  }
  console.log('\nResponsive sweep passed.');
  return 0;
}
