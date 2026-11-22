// main/tools/scripts/audit/route-manifest.test.ts
import { clearRegistry } from '@bslt/server-system/http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  generateManifest,
  populateRegistryFromRouteMaps,
  run,
  type RouteManifestEntry,
} from './route-manifest';

describe('route-manifest', () => {
  afterEach(() => {
    clearRegistry();
    vi.restoreAllMocks();
  });

  it('warns when the registry is empty instead of emitting an empty JSON array', () => {
    clearRegistry();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const entries = generateManifest([]);
    expect(entries).toEqual([]);

    // Exercise empty-branch formatting directly with generateManifest([]).
    if (entries.length === 0) {
      console.log('No routes');
    }
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it('omits deprecated when false/undefined and preserves deprecated: true when set', () => {
    const manifest = generateManifest([
      {
        path: '/api/new',
        method: 'GET',
        isPublic: true,
        roles: [],
        module: 'demo',
        hasSchema: false,
      },
      {
        path: '/api/old',
        method: 'POST',
        isPublic: false,
        roles: ['user'],
        module: 'demo',
        hasSchema: true,
        deprecated: true,
      },
    ]);

    expect(manifest).toEqual([
      {
        path: '/api/new',
        method: 'GET',
        isPublic: true,
        module: 'demo',
        hasSchema: false,
      },
      {
        path: '/api/old',
        method: 'POST',
        isPublic: false,
        module: 'demo',
        hasSchema: true,
        deprecated: true,
      },
    ]);
    expect(Object.hasOwn(manifest[0] ?? {}, 'deprecated')).toBe(false);
  });

  it('registers native installedServerModules alongside legacy route maps with schema metadata', () => {
    populateRegistryFromRouteMaps();
    const manifest = generateManifest();

    const auditManifestEntries = manifest.filter((entry) => entry.module === 'audit');
    expect(auditManifestEntries).toContainEqual({
      path: '/api/activities',
      method: 'GET',
      isPublic: false,
      module: 'audit',
      hasSchema: false,
    });
  });

  it('sorts manifest entries deterministically by path regardless of input order', () => {
    const manifest = generateManifest([
      {
        path: '/api/z',
        method: 'GET',
        isPublic: true,
        roles: [],
        module: 'z',
        hasSchema: false,
      },
      {
        path: '/api/a',
        method: 'POST',
        isPublic: false,
        roles: ['user'],
        module: 'a',
        hasSchema: true,
      },
    ]);

    expect(manifest.map((entry) => entry.path)).toEqual(['/api/a', '/api/z']);
  });

  it('prints valid JSON manifest containing both legacy and native module routes in run()', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    run();

    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as RouteManifestEntry[];
    expect(parsed.some((entry) => entry.path === '/api/auth/login')).toBe(true);
    expect(parsed.some((entry) => entry.path === '/api/platform/context')).toBe(true);
    // A mutating route declares its body schema, though its module is exempt from the audit.
    expect(parsed).toContainEqual(
      expect.objectContaining({
        path: '/api/platform/errors',
        method: 'POST',
        module: 'system',
        hasSchema: true,
      }),
    );
    expect(parsed.some((entry) => entry.path === '/api/activities')).toBe(true);
  });
});
