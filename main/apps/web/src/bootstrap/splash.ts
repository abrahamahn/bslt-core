// main/apps/web/src/bootstrap/splash.ts
/**
 * The pre-boot splash: what fills the gap between first paint and the app being
 * on screen.
 *
 * The element itself ships in index.html, styled by the critical `<style>` block
 * — no bundle, no font, no request. A splash that needs the bundle in order to
 * appear is decoration for the people who were never going to see it.
 *
 * Two properties make it more than decoration, and both live in this file:
 *
 * 1. IT IS A SIBLING OF #root, NEVER A CHILD, and it is torn down from here —
 *    never by React. Markup inside #root is markup React reconciles against on
 *    mount. A prerendered page already puts a tree in there that the client does
 *    not render (see src/ssr/ServerApp.tsx: the DOCUMENT, without the app shell),
 *    which is why `bootstrapClientApp` drops it; putting the splash in there too
 *    would re-arm exactly the mismatch we just disarmed.
 *
 * 2. IT ALWAYS REVEALS. Every signal below can simply fail to arrive — one hung
 *    image and `load` never fires, one stalled auth call and the session never
 *    settles — so the ceiling is armed BEFORE the first signal is even
 *    constructed, and nothing can cancel it except a reveal. A splash that can
 *    outlive the app is strictly worse than no splash: the app underneath works,
 *    and the user cannot reach it.
 */

/** The splash element in index.html. Its styles are in the same file's critical CSS. */
export const SPLASH_ELEMENT_ID = 'app-splash';

/**
 * Marks the route-level Suspense fallback (App.tsx). Its presence means the first
 * route's chunk is still loading, so the app is not on screen yet — revealing
 * then would only trade the splash for another spinner.
 */
export const ROUTE_PENDING_ATTRIBUTE = 'data-route-pending';

/**
 * The hard ceiling, measured from the moment the bundle mounts the app — so it
 * bounds how long the splash can outlast the code that is supposed to remove it.
 *
 * Long enough not to cut a legitimately slow boot short: an LCP over 4s is already
 * "poor", and the signals below wait for strictly more than LCP. Short enough that
 * one hung request cannot strand the user. Revealing early is cheap — the app has
 * its own loading states, and a spinner the user can escape beats one they cannot.
 */
export const SPLASH_FAILSAFE_MS = 5_000;

/** Must match the `transition: opacity` on `#app-splash` in index.html. */
export const SPLASH_FADE_OUT_MS = 240;

export interface RevealOptions {
  /** The React root. The first route rendering INTO it is one of the signals. */
  readonly root: HTMLElement;
  /**
   * The session restore from the refresh cookie. Awaited so a returning user does
   * not watch the signed-out shell flash past — and it may reject (offline, API
   * down), which counts as settled, not as never.
   */
  readonly authSettled: Promise<unknown>;
  /** Overridable so a test can prove there is a ceiling at all. */
  readonly failsafeMs?: number;
}

/**
 * Tear the splash down. Idempotent: safe once the fade has started, safe once the
 * element is gone, safe on a document that never had one (a test, an embed).
 */
export function removeSplash(): void {
  const splash = document.getElementById(SPLASH_ELEMENT_ID);
  if (splash === null || splash.dataset['leaving'] === 'true') return;

  // The fade is CSS; this only starts it. The element is detached afterwards so a
  // transparent full-screen layer cannot linger over the app.
  splash.dataset['leaving'] = 'true';
  window.setTimeout(() => {
    splash.remove();
  }, SPLASH_FADE_OUT_MS);
}

/** Resolves on `load` — every stylesheet, script and image the page asked for. */
function windowLoaded(): Promise<void> {
  if (document.readyState === 'complete') return Promise.resolve();

  return new Promise((resolve) => {
    window.addEventListener(
      'load',
      () => {
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * Resolves when webfonts are done. `document.fonts` is absent in jsdom and in
 * older browsers, and an environment with no font loading API has, by definition,
 * no fonts left to wait for.
 */
function fontsReady(): Promise<unknown> {
  const fonts: FontFaceSet | undefined = 'fonts' in document ? document.fonts : undefined;
  return fonts === undefined ? Promise.resolve() : fonts.ready;
}

/**
 * The app is on screen: React has committed a tree into the root AND that tree is
 * not the route-level Suspense fallback. Waiting only for "the root has children"
 * would reveal onto the lazy chunk's spinner — the splash would have handed off to
 * another loading state, which is the thing it exists to prevent.
 */
function isRouteOnScreen(root: HTMLElement): boolean {
  return (
    root.firstElementChild !== null && root.querySelector(`[${ROUTE_PENDING_ATTRIBUTE}]`) === null
  );
}

/**
 * Hold the splash until the app is genuinely usable — then reveal, whatever
 * happened.
 *
 * `allSettled`, not `all`: a rejected signal is a settled signal, and a session
 * restore that fails offline must not be able to hold the app hostage.
 *
 * Both exits — the signals and the ceiling — go through the same `reveal`, so the
 * observer is disconnected on the ceiling path too. It watches the whole app
 * subtree; leaving it running on a page whose first route never arrived would tax
 * every DOM mutation for the rest of the session.
 */
export function revealAppWhenReady({ root, authSettled, failsafeMs }: RevealOptions): void {
  let observer: MutationObserver | undefined;

  const reveal = (): void => {
    observer?.disconnect();
    removeSplash();
  };

  // Armed before a single signal is constructed, let alone awaited: it is the one
  // branch that nothing can starve.
  const ceiling = window.setTimeout(reveal, failsafeMs ?? SPLASH_FAILSAFE_MS);

  const firstRouteOnScreen = new Promise<void>((resolve) => {
    if (isRouteOnScreen(root)) {
      resolve();
      return;
    }

    observer = new MutationObserver(() => {
      if (isRouteOnScreen(root)) resolve();
    });
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [ROUTE_PENDING_ATTRIBUTE],
    });
  });

  void Promise.allSettled([windowLoaded(), fontsReady(), authSettled, firstRouteOnScreen]).then(
    () => {
      window.clearTimeout(ceiling);
      reveal();
    },
  );
}
