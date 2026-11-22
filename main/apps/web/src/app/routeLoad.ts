// main/apps/web/src/app/routeLoad.ts
/**
 * Route-chunk loading policy: what happens between "the router wants a page"
 * and "React gets its module".
 *
 * Two failure modes live here. A dynamic import that fails usually means the
 * tab's HTML predates the latest deploy and references chunks that no longer
 * exist — recoverable by one full reload. And a chunk that arrives in 40ms
 * flashes the route fallback for a few frames, which reads as flicker, not
 * feedback — so a first load is paced to a small floor instead.
 */

import { lazy, type ComponentType, type ElementType } from 'react';

import { SPLASH_ELEMENT_ID } from '../bootstrap/splash';

import type { LazyPageDescriptor } from '@bslt/web-platform';

export const CHUNK_RELOAD_KEY = 'chunk-reload-at';
export const CHUNK_RELOAD_COOLDOWN_MS = 30_000;

/**
 * The floor on a route chunk's first load. Under it, the Suspense fallback
 * (App.tsx's RouteLoadingFallback) appears for only a frame or two and reads
 * as a glitch; at ~400ms it reads as a deliberate loading state. Only the
 * FIRST visit pays this — React.lazy caches the resolved module, so returning
 * to a page never suspends again.
 *
 * Zero under test: no suite should sit through the pacing floor.
 */
export const MIN_ROUTE_LOAD_MS = import.meta.env.MODE === 'test' ? 0 : 400;

function reloadPage(): void {
  window.location.reload();
}

/**
 * A failed dynamic import usually means the tab's HTML predates the latest
 * deploy and references chunks that no longer exist. One full reload fetches
 * the new bundle; the cooldown stops a reload loop when the failure is real.
 *
 * `reload` is injectable only because jsdom's `location.reload` is unforgeable
 * and cannot be spied on; every production caller takes the default.
 */
export function reloadOnceForStaleChunk(error: unknown, reload: () => void = reloadPage): never {
  // No window means the build-time prerenderer: there is no page to reload,
  // and the import failure itself is the error worth surfacing.
  if (typeof window !== 'undefined') {
    const lastReload = Number(window.sessionStorage.getItem(CHUNK_RELOAD_KEY) ?? 0);
    if (Date.now() - lastReload > CHUNK_RELOAD_COOLDOWN_MS) {
      window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
      reload();
    }
  }
  throw error;
}

/** Resolves with `work`, but never sooner than `ms`. Rejects as soon as `work` does. */
export async function notBefore<T>(work: Promise<T>, ms: number): Promise<T> {
  const floor = new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
  const [result] = await Promise.all([work, floor]);
  return result;
}

/**
 * Fetches a page, pacing the swap so the route fallback never flashes.
 *
 * Skipped when the boot splash (index.html's #app-splash) still covers the
 * app: the fallback is invisible under it, and the splash itself waits for
 * `data-route-pending` to clear (src/bootstrap/splash.ts) — pacing there would
 * only hold the splash on screen longer.
 */
export async function loadPaced<Module>(
  load: () => Promise<Module>,
  floorMs: number = MIN_ROUTE_LOAD_MS,
): Promise<Module> {
  // Node SSR rendering resolves pages without browser pacing or `document`.
  // A zero floor is test mode's "no pacing", so it skips the timer outright.
  if (typeof document === 'undefined' || floorMs === 0) return load();
  if (document.getElementById(SPLASH_ELEMENT_ID) !== null) return load();

  return notBefore(load(), floorMs);
}

/** The export name each lazy page was split from: a `lazy()` component has no name of its own. */
const lazyPageNames = new WeakMap<object, string>();

/**
 * Code-split a page by its named module export. Optional capability pages are
 * loaded only when their route is actually registered, keeping the starter
 * bundle (and the route table) small. The `name` is checked against the
 * module's exports; the single cast is the unavoidable lazy-loading boundary.
 */
export function lazyPage<Module>(load: () => Promise<Module>, name: keyof Module): ElementType {
  const page = lazy(async () => {
    // The pacing wraps only the success path: a stale-chunk failure reloads at
    // once rather than sitting out a floor in front of an error.
    const module = await loadPaced(load).catch(reloadOnceForStaleChunk);
    return { default: module[name] as ComponentType<unknown> };
  });
  lazyPageNames.set(page, String(name));
  return page;
}

const lazyModulePages = new WeakMap<LazyPageDescriptor, ElementType>();

/**
 * Code-split a module-contributed `LazyPageDescriptor` (`lazyModulePage`) with the
 * app's route-pacing floor and stale-chunk reload policy, preserving `pageName` for
 * `bslt snapshot web-routes`. Memoized per descriptor so recomputing route tables
 * keeps mounted React lazy components stable across capability transitions.
 */
export function lazyModuleRoutePage(descriptor: LazyPageDescriptor): ElementType {
  if (descriptor.eager !== undefined) {
    lazyPageNames.set(descriptor.eager, descriptor.pageName);
    return descriptor.eager;
  }
  const existing = lazyModulePages.get(descriptor);
  if (existing !== undefined) {
    return existing;
  }
  const page = lazy(async () => {
    const component = await loadPaced(descriptor.load).catch(reloadOnceForStaleChunk);
    return { default: component as ComponentType<unknown> };
  });
  lazyPageNames.set(page, descriptor.pageName);
  lazyModulePages.set(descriptor, page);
  return page;
}

/**
 * The name of the page a route renders: the module export of a `lazyPage`, else
 * the component's own name. Tooling reads it (`bslt snapshot web-routes`
 * records which page each path renders); nothing renders with it.
 *
 * @returns `undefined` for a component that has no name.
 */
export function routePageName(element: ElementType): string | undefined {
  if (typeof element === 'string') return element;
  const lazyName = lazyPageNames.get(element);
  if (lazyName !== undefined) return lazyName;
  const named = element as { readonly displayName?: unknown; readonly name?: unknown };
  if (typeof named.displayName === 'string' && named.displayName !== '') return named.displayName;
  return typeof named.name === 'string' && named.name !== '' ? named.name : undefined;
}
