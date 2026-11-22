// main/apps/web/src/app/routeLoad.test.tsx
/**
 * Route-chunk loading policy tests.
 *
 * The floor exists so a fast chunk cannot flash the route fallback for a few
 * frames; the splash skip exists so the floor never delays the boot splash's
 * reveal; the reload-once exists so a stale-chunk deploy heals itself without
 * being able to loop. Each is pinned here, because none of them fail loudly —
 * they just quietly degrade into flicker, a slower boot, or a reload storm.
 */

import { lazyModulePage } from '@bslt/web-platform';
import { render, screen } from '@testing-library/react';
import { Suspense, lazy, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SPLASH_ELEMENT_ID } from '../bootstrap/splash';

import {
  CHUNK_RELOAD_COOLDOWN_MS,
  CHUNK_RELOAD_KEY,
  MIN_ROUTE_LOAD_MS,
  lazyModuleRoutePage,
  lazyPage,
  loadPaced,
  notBefore,
  reloadOnceForStaleChunk,
  routePageName,
} from './routeLoad';

const FLOOR_MS = 400;

describe('MIN_ROUTE_LOAD_MS', () => {
  it('is zero under test, so no suite sits through the pacing floor', () => {
    expect(MIN_ROUTE_LOAD_MS).toBe(0);
  });
});

describe('notBefore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('holds a fast resolution until the floor has elapsed', async () => {
    const settled = vi.fn();
    const paced = notBefore(Promise.resolve('page'), FLOOR_MS);
    void paced.then(settled);

    await vi.advanceTimersByTimeAsync(FLOOR_MS - 1);
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toHaveBeenCalledWith('page');
  });

  it('rejects immediately on failure — an error is not worth pacing', async () => {
    const error = new Error('chunk 404');

    // No timer advance at all: the rejection must not wait out the floor.
    await expect(notBefore(Promise.reject(error), FLOOR_MS)).rejects.toBe(error);
  });
});

describe('loadPaced', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.getElementById(SPLASH_ELEMENT_ID)?.remove();
  });

  it('paces a load to the floor when nothing covers the route fallback', async () => {
    const settled = vi.fn();
    void loadPaced(() => Promise.resolve('module'), FLOOR_MS).then(settled);

    await vi.advanceTimersByTimeAsync(FLOOR_MS - 1);
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toHaveBeenCalledWith('module');
  });

  it('skips the floor entirely while the boot splash is still on screen', async () => {
    const splash = document.createElement('div');
    splash.id = SPLASH_ELEMENT_ID;
    document.body.append(splash);

    // Timers are fake and never advanced: this resolves only if no floor was armed.
    await expect(loadPaced(() => Promise.resolve('module'), FLOOR_MS)).resolves.toBe('module');
  });
});

describe('reloadOnceForStaleChunk', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.sessionStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reloads once, records when, and rethrows so React still sees the failure', () => {
    const reload = vi.fn();
    const error = new Error('stale chunk');

    expect(() => reloadOnceForStaleChunk(error, reload)).toThrow(error);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(CHUNK_RELOAD_KEY)).toBe(String(Date.now()));
  });

  it('does not reload again within the cooldown — a real failure must not loop', () => {
    const reload = vi.fn();

    expect(() => reloadOnceForStaleChunk(new Error('first'), reload)).toThrow('first');
    vi.advanceTimersByTime(CHUNK_RELOAD_COOLDOWN_MS);
    expect(() => reloadOnceForStaleChunk(new Error('second'), reload)).toThrow('second');

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads again once the cooldown has passed', () => {
    const reload = vi.fn();

    expect(() => reloadOnceForStaleChunk(new Error('first'), reload)).toThrow('first');
    vi.advanceTimersByTime(CHUNK_RELOAD_COOLDOWN_MS + 1);
    expect(() => reloadOnceForStaleChunk(new Error('second'), reload)).toThrow('second');

    expect(reload).toHaveBeenCalledTimes(2);
  });
});

describe('lazyPage', () => {
  it('resolves the page from its named module export, not the module default', async () => {
    const Page = lazyPage(
      () =>
        Promise.resolve({
          RightPage: () => <div>right page</div>,
          WrongPage: () => <div>wrong page</div>,
        }),
      'RightPage',
    );

    render(
      <Suspense fallback={null}>
        <Page />
      </Suspense>,
    );

    expect(await screen.findByText('right page')).toBeInTheDocument();
    expect(screen.queryByText('wrong page')).not.toBeInTheDocument();
  });
});

describe('routePageName', () => {
  it('names a lazy page by the module export it was split from', () => {
    const Page = lazyPage(
      () => Promise.resolve({ RightPage: () => <div>right page</div> }),
      'RightPage',
    );

    expect(routePageName(Page)).toBe('RightPage');
  });

  it('names an eager page by its component name', () => {
    const EagerPage = (): ReactElement => <div>eager</div>;
    const Labelled = Object.assign((): ReactElement => <div>labelled</div>, {
      displayName: 'LabelledPage',
    });

    expect(routePageName(EagerPage)).toBe('EagerPage');
    expect(routePageName(Labelled)).toBe('LabelledPage');
  });

  it('has no name for an intrinsic element or an anonymous component', () => {
    expect(routePageName('div')).toBe('div');
    expect(routePageName(lazy(() => Promise.resolve({ default: () => null })))).toBeUndefined();
  });

  it('resolves lazyModuleRoutePage descriptors, preserves pageName, and rejects invalid exports', async () => {
    const descriptor = lazyModulePage(
      () => Promise.resolve({ ModulePage: () => <div>module page</div> }),
      'ModulePage',
    );
    const Page = lazyModuleRoutePage(descriptor);
    expect(routePageName(Page)).toBe('ModulePage');
    expect(lazyModuleRoutePage(descriptor)).toBe(Page);

    render(
      <Suspense fallback={null}>
        <Page />
      </Suspense>,
    );
    expect(await screen.findByText('module page')).toBeInTheDocument();

    const brokenDescriptor = lazyModulePage(
      () => Promise.resolve({ Broken: 'not-a-component' }),
      'Broken',
    );
    await expect(brokenDescriptor.load()).rejects.toThrow(
      'Lazy page export "Broken" is not a React component function',
    );
  });
});
