// main/apps/web/src/entry-public.test.tsx
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderPublic } from '@bslt/web-platform';
import { act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { bootstrapPublicClient } from './entry-public';
import { PUBLIC_SSR_MODULES, publicRoutes } from './ssr/public-routes';
import { PublicDocumentShell } from './ssr/PublicDocumentShell';

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = readFileSync(path.join(WEB_ROOT, 'index.html'), 'utf8');

describe('entry-public', () => {
  afterEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('returns null without mounting when #__BSLT_STATE__ is absent', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root');
    expect(bootstrapPublicClient(root)).toBeNull();
  });

  it('hydrates server-rendered public route without remounting and removes #app-splash', async () => {
    const rendered = await renderPublic(new URL('https://app.bslt.dev/cookies'), publicRoutes, {
      apiInternalUrl: 'http://api.internal:8080',
      siteUrl: 'https://app.bslt.dev',
      modules: PUBLIC_SSR_MODULES,
      Shell: PublicDocumentShell,
      template: TEMPLATE,
    });

    const parsed = new DOMParser().parseFromString(rendered?.html ?? '', 'text/html');
    document.head.innerHTML = parsed.head.innerHTML;
    document.body.innerHTML = parsed.body.innerHTML;
    window.history.replaceState({}, '', '/cookies');

    const root = document.getElementById('root');
    if (root === null) throw new Error('missing #root');
    const serverMain = root.querySelector('main');
    expect(serverMain).not.toBeNull();

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let handle: ReturnType<typeof bootstrapPublicClient> = null;
    await act(async () => {
      handle = bootstrapPublicClient(root);
      await Promise.resolve();
    });

    expect(handle).not.toBeNull();
    expect(document.getElementById('app-splash')).toBeNull();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(root.querySelector('main')).toBe(serverMain);

    act(() => {
      handle?.unmount();
    });
  });

  it('dynamically loads docsPublicRoutes when hydrating a /docs SSR page', async () => {
    const rendered = await renderPublic(new URL('https://app.bslt.dev/docs'), publicRoutes, {
      apiInternalUrl: 'http://api.internal:8080',
      siteUrl: 'https://app.bslt.dev',
      modules: PUBLIC_SSR_MODULES,
      Shell: PublicDocumentShell,
      template: TEMPLATE,
    });

    const parsed = new DOMParser().parseFromString(rendered?.html ?? '', 'text/html');
    document.head.innerHTML = parsed.head.innerHTML;
    document.body.innerHTML = parsed.body.innerHTML;
    window.history.replaceState({}, '', '/docs');

    const root = document.getElementById('root');
    if (root === null) throw new Error('missing #root');
    const serverHeading = root.querySelector('#docs-chapter-title');
    expect(serverHeading).not.toBeNull();

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let handle: ReturnType<typeof bootstrapPublicClient> = null;
    await act(async () => {
      handle = bootstrapPublicClient(root);
      await new Promise((resolve) => {
        setTimeout(resolve, 25);
      });
    });

    expect(handle).not.toBeNull();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(root.querySelector('#docs-chapter-title')).toBe(serverHeading);

    act(() => {
      handle?.unmount();
    });
  });
});
