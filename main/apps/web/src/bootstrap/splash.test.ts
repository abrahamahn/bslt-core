// main/apps/web/src/bootstrap/splash.test.ts
/**
 * The splash's one hard requirement is that it goes away.
 *
 * Everything else is decoration: it is a spinner. But it is a full-screen layer
 * over a working application, so the interesting cases are not the happy ones —
 * they are the ones where a signal never arrives, and the tests below are written
 * so that a splash without a ceiling fails them.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  removeSplash,
  revealAppWhenReady,
  ROUTE_PENDING_ATTRIBUTE,
  SPLASH_ELEMENT_ID,
  SPLASH_FADE_OUT_MS,
  SPLASH_FAILSAFE_MS,
} from './splash';

// ============================================================================
// Helpers
// ============================================================================

/** index.html as it ships: the splash is a SIBLING of #root, never a child. */
function mountShell(): HTMLElement {
  document.body.innerHTML =
    `<div id="root"></div>` +
    `<div id="${SPLASH_ELEMENT_ID}" aria-hidden="true"><div class="app-splash__mark"></div></div>`;

  const root = document.getElementById('root');
  if (root === null) throw new Error('no root');
  return root;
}

function splash(): HTMLElement | null {
  return document.getElementById(SPLASH_ELEMENT_ID);
}

/** A signal that never arrives: the hung image, the stalled request. */
function never(): Promise<never> {
  return new Promise<never>(() => undefined);
}

/** jsdom has no `document.fonts`, so font readiness has to be installed to be withheld. */
function stubFonts(ready: Promise<unknown>): void {
  Object.defineProperty(document, 'fonts', { value: { ready }, configurable: true });
}

/** React has committed the first route: real content, no pending marker. */
function renderRoute(root: HTMLElement): void {
  root.innerHTML = '<main>Dashboard</main>';
}

/** The route-level Suspense fallback: the lazy chunk is still in flight. */
function renderRoutePending(root: HTMLElement): void {
  root.innerHTML = `<div ${ROUTE_PENDING_ATTRIBUTE}="" role="status">Loading page</div>`;
}

// A ceiling far outside every other timeout in these tests, so that any reveal in
// the signal cases below is the SIGNALS revealing — never the failsafe rescuing a
// broken implementation and making it look correct.
const NO_RESCUE = 10 * SPLASH_FAILSAFE_MS;

/** Let the MutationObserver and the promise chain run, then the timers. */
async function settle(ms: number = SPLASH_FADE_OUT_MS): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(ms);
}

// ============================================================================
// Tests
// ============================================================================

describe('revealAppWhenReady', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(document, 'fonts');
  });

  it('ALWAYS REVEALS: tears the splash down when not one signal ever arrives', async () => {
    // Fonts that never load, a session restore that never settles, an app that
    // never mounts. Every one of these is a real production failure, and without a
    // hard ceiling the splash sits over a working app forever — strictly worse than
    // never having had a splash, because the app underneath is fine and the user
    // cannot reach it.
    const root = mountShell();
    stubFonts(never());

    revealAppWhenReady({ root, authSettled: never() });

    await settle(SPLASH_FAILSAFE_MS - 1);
    expect(splash()).not.toBeNull(); // still holding: the ceiling has not been reached

    await settle(1 + SPLASH_FADE_OUT_MS);
    expect(splash()).toBeNull();
  });

  it('reveals on the signals, long before the ceiling could rescue it', async () => {
    const root = mountShell();
    stubFonts(Promise.resolve());

    revealAppWhenReady({ root, authSettled: Promise.resolve(), failsafeMs: NO_RESCUE });
    renderRoute(root);

    await settle();

    expect(splash()).toBeNull();
  });

  it('holds while the first route chunk is still loading', async () => {
    // "The root has children" is not the signal — the Suspense fallback is children.
    // Revealing there swaps the splash for another spinner, which is the exact thing
    // the splash exists to avoid.
    const root = mountShell();
    stubFonts(Promise.resolve());

    revealAppWhenReady({ root, authSettled: Promise.resolve(), failsafeMs: NO_RESCUE });
    renderRoutePending(root);

    await settle(SPLASH_FAILSAFE_MS);
    expect(splash()).not.toBeNull();

    renderRoute(root); // the chunk lands
    await settle();
    expect(splash()).toBeNull();
  });

  it('holds until the session restore settles, so the signed-out shell cannot flash past', async () => {
    const root = mountShell();
    stubFonts(Promise.resolve());
    let restore: () => void = () => undefined;
    const authSettled = new Promise<void>((resolve) => {
      restore = resolve;
    });

    revealAppWhenReady({ root, authSettled, failsafeMs: NO_RESCUE });
    renderRoute(root);

    await settle();
    expect(splash()).not.toBeNull();

    restore();
    await settle();
    expect(splash()).toBeNull();
  });

  it('reveals when the session restore REJECTS — offline is settled, not pending', async () => {
    // `Promise.all` here would never resolve its `.then`, and the user would stare
    // at a spinner until the ceiling fired. A failed signal is a finished signal.
    const root = mountShell();
    stubFonts(Promise.resolve());

    revealAppWhenReady({
      root,
      authSettled: Promise.reject(new Error('offline')),
      failsafeMs: NO_RESCUE,
    });
    renderRoute(root);

    await settle();

    expect(splash()).toBeNull();
  });

  it('does not wait for a font API that the browser does not have', async () => {
    // `document.fonts` is absent in jsdom and in older browsers. An environment with
    // no font loading API has no fonts left to wait for; blocking on it would hold
    // the splash to the ceiling on every single load.
    const root = mountShell();

    revealAppWhenReady({ root, authSettled: Promise.resolve(), failsafeMs: NO_RESCUE });
    renderRoute(root);

    await settle();

    expect(splash()).toBeNull();
  });

  it('survives a document that never had a splash', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root');
    if (root === null) throw new Error('no root');

    expect(() => {
      revealAppWhenReady({ root, authSettled: Promise.resolve() });
    }).not.toThrow();

    await settle(SPLASH_FAILSAFE_MS + SPLASH_FADE_OUT_MS);
  });
});

describe('removeSplash', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mountShell();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fades first, then DETACHES — a transparent full-screen layer would eat every click', async () => {
    removeSplash();

    expect(splash()?.dataset['leaving']).toBe('true'); // the fade starts immediately

    await vi.advanceTimersByTimeAsync(SPLASH_FADE_OUT_MS);

    expect(splash()).toBeNull();
  });

  it('is idempotent: two callers, one teardown', async () => {
    // The signals and the ceiling race, and both call it. The loser must be a no-op,
    // not a second removal scheduled against a detached node.
    removeSplash();
    removeSplash();

    await vi.advanceTimersByTimeAsync(SPLASH_FADE_OUT_MS);
    expect(splash()).toBeNull();

    expect(() => {
      removeSplash();
    }).not.toThrow();
  });

  it('no-ops on a document with no splash', () => {
    document.body.innerHTML = '<div id="root"></div>';

    expect(() => {
      removeSplash();
    }).not.toThrow();
  });
});
