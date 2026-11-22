// main/apps/web/src/index-html.test.ts
/**
 * index.html must contain no inline <script>.
 *
 * Production serves `script-src 'self'` (see
 * main/shared/src/modules/system/security/csp.ts). Dev serves no CSP header at all,
 * so an inline script works perfectly on your machine, passes review, and is then
 * silently blocked for every real user — a pre-paint theme resolver is the classic
 * case, and it fails in exactly the way that is hardest to notice.
 *
 * Put the script in `main/apps/web/public/` and load it with `<script src="...">`.
 * Do not add 'unsafe-inline' to the policy; that is what the header is for.
 *
 * An inline <style> is fine and is deliberately not flagged: style-src carries
 * 'unsafe-inline' for the critical anti-flash CSS, and styles cannot execute.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { THEME_STORAGE_KEYS } from '@bslt/ui';
import { injectPublicSsrHtml } from '@bslt/web-platform';
import { describe, expect, it } from 'vitest';

import { SPLASH_ELEMENT_ID, SPLASH_FADE_OUT_MS, SPLASH_FAILSAFE_MS } from './bootstrap/splash';

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** `<script ...>` with a non-empty body. A `src=` script has an empty body and is fine. */
const SCRIPT_TAG = /<script\b([^>]*)>([\s\S]*?)<\/script>/giu;

/** Inline script bodies in an HTML document, ignoring `<script src=...>` loaders. */
function findInlineScripts(html: string): string[] {
  return (
    [...html.matchAll(SCRIPT_TAG)]
      .map(([, attributes = '', body = '']) => ({ attributes, body: body.trim() }))
      // A JSON/importmap block is data, not executable, but it is still blocked by
      // script-src — so it is not exempted here.
      .filter(({ body }) => body !== '')
      .map(({ attributes, body }) => `<script${attributes}> ${body.slice(0, 80)}`)
  );
}

describe('index.html', () => {
  const html = readFileSync(path.join(WEB_ROOT, 'index.html'), 'utf8');

  it('has no inline <script> — production CSP would silently block it', () => {
    expect(findInlineScripts(html)).toEqual([]);
  });

  it('still loads the app through a file, so the guard above is not vacuous', () => {
    // If the entry <script src> ever disappears, the assertion above would pass for
    // the wrong reason. Pin that a script tag exists at all.
    expect(html).toMatch(/<script[^>]+\bsrc=/u);
  });

  it('keeps its inline <style>, which the policy permits', () => {
    expect(html).toContain('<style>');
  });
});

/**
 * The pre-paint theme contract: theme-init.js must agree with the app it front-runs.
 *
 * The script sets data-theme from localStorage before first paint. Get the key
 * wrong and it reads nothing; run it after the critical CSS and the first frame
 * paints with the OS theme anyway; set a value useThemeMode does not re-assert
 * and React flips the theme back on mount. Each failure is invisible in review
 * and obvious to a dark-mode user, so each is pinned here.
 */
describe('index.html: the pre-paint theme', () => {
  const html = readFileSync(path.join(WEB_ROOT, 'index.html'), 'utf8');
  const themeInit = readFileSync(path.join(WEB_ROOT, 'public/theme-init.js'), 'utf8');
  const app = readFileSync(path.join(WEB_ROOT, 'src/app/App.tsx'), 'utf8');

  it('loads theme-init.js BEFORE the critical CSS, so the first paint can obey it', () => {
    const script = html.indexOf('<script src="/theme-init.js"></script>');

    expect(script).toBeGreaterThan(-1);
    expect(script).toBeLessThan(html.indexOf('<style>'));
  });

  it('reads the exact canonical storage key ThemeProvider uses in App.tsx', () => {
    expect(app).toContain('<ThemeProvider>');
    expect(themeInit).toContain(`window.localStorage.getItem('${THEME_STORAGE_KEYS.mode}')`);
  });

  it('parses the stored JSON — useLocalStorage writes \'"dark"\', quotes included', () => {
    expect(themeInit).toContain('JSON.parse(stored)');
  });

  it('sets data-theme for an explicit choice only, and never invents a value', () => {
    // 'system'/absent/corrupt must fall through to CSS light-dark(); a value
    // useThemeMode would not re-assert gets flipped back on mount — the flash
    // this script exists to prevent, in reverse.
    expect(themeInit).toContain("mode === 'light' || mode === 'dark'");
    expect(themeInit).toMatch(/setAttribute\('data-theme', mode\)/u);
    expect(themeInit).not.toMatch(/removeAttribute/u);
  });

  it('overrides color-scheme per data-theme, so light-dark() obeys the choice pre-paint', () => {
    expect(html).toMatch(/:root\[data-theme='light'\]\s*\{\s*color-scheme:\s*light;/u);
    expect(html).toMatch(/:root\[data-theme='dark'\]\s*\{\s*color-scheme:\s*dark;/u);
  });
});

/**
 * The splash's placement is a correctness property, not a styling one.
 *
 * Anything inside `#root` is markup React reconciles against when it mounts. A
 * prerendered page already puts a tree in there that the client does not render,
 * which is why `bootstrapClientApp` drops it and mounts fresh; a splash inside
 * `#root` would re-arm exactly that mismatch — and it would be torn out by React
 * mid-mount, which is the opposite of hiding the mount.
 */
describe('index.html: the boot splash', () => {
  const html = readFileSync(path.join(WEB_ROOT, 'index.html'), 'utf8');

  function parse(document_: string): Document {
    return new DOMParser().parseFromString(document_, 'text/html');
  }

  function assertSiblingOfRoot(doc: Document): void {
    const root = doc.getElementById('root');
    const splash = doc.getElementById(SPLASH_ELEMENT_ID);

    expect(root).not.toBeNull();
    expect(splash).not.toBeNull();
    expect(root?.querySelector(`#${SPLASH_ELEMENT_ID}`)).toBeNull();
    expect(splash?.parentElement?.tagName).toBe('BODY');
  }

  it('is a SIBLING of #root, never a child', () => {
    assertSiblingOfRoot(parse(html));
  });

  it('stays a sibling in the SSR-rendered public page, which is the page that hydrates', () => {
    const page = injectPublicSsrHtml(html, {
      headHtml: '<title>Terms of Service</title>',
      bodyHtml: '<main>Terms of Service</main>',
      stateScriptHtml:
        '<script type="application/json" id="__BSLT_STATE__">{"routePath":"/terms","urlPathname":"/terms","data":{},"queries":[]}</script>',
    });

    expect(page).toContain('data-ssr-public="true"');
    assertSiblingOfRoot(parse(page));
  });

  it('paints from the critical CSS, so it does not need the bundle it is covering for', () => {
    // A splash whose styles arrive with the stylesheet is invisible for exactly the
    // part of the load it exists to fill.
    expect(html).toMatch(new RegExp(`<style>[\\s\\S]*#${SPLASH_ELEMENT_ID}\\b`, 'u'));
  });

  it('reveals WITHOUT JavaScript — the ceiling in splash.ts is armed by the bundle it guards', () => {
    // SPLASH_FAILSAFE_MS cannot fire if the bundle never runs (chunk 404 after a
    // deploy, blocked script, a throw before bootstrapClientApp). A prerendered page
    // has real prose in #root; without a CSS-only reveal the user stares at an
    // opaque spinner over content that is already there.
    const failsafe =
      /#app-splash:not\(\[data-leaving\]\)\s*\{\s*animation:\s*app-splash-failsafe\s+(\d+)s/u.exec(
        html,
      );

    expect(failsafe).not.toBeNull();
    // It must never win a normal boot: strictly slower than the JS ceiling.
    expect(Number(failsafe?.[1]) * 1000).toBeGreaterThan(SPLASH_FAILSAFE_MS + SPLASH_FADE_OUT_MS);
    // Transparent is not enough — a full-screen layer still eats every click.
    expect(html).toMatch(/@keyframes app-splash-failsafe[\s\S]*visibility:\s*hidden/u);
  });
});

describe('findInlineScripts', () => {
  it('flags a bare inline script', () => {
    expect(findInlineScripts('<script>document.title = "x";</script>')).toHaveLength(1);
  });

  it('flags a pre-paint theme resolver — the exact trap this guard exists for', () => {
    const themeInit = `<script>
      const t = localStorage.getItem('theme');
      if (t) document.documentElement.dataset.theme = t;
    </script>`;

    expect(findInlineScripts(themeInit)).toHaveLength(1);
  });

  it('flags an inline script that also carries attributes', () => {
    expect(findInlineScripts('<script type="module">import "./x";</script>')).toHaveLength(1);
  });

  it('does not flag a <script src> loader', () => {
    expect(findInlineScripts('<script type="module" src="./src/entry.tsx"></script>')).toEqual([]);
  });

  it('does not flag an inline <style>', () => {
    expect(findInlineScripts('<style>:root { color-scheme: light dark; }</style>')).toEqual([]);
  });

  it('finds an inline script hiding after a legitimate loader', () => {
    const html = '<script src="/a.js"></script>\n<script>evil();</script>';

    expect(findInlineScripts(html)).toHaveLength(1);
  });
});
