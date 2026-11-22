// main/modules/devtools/server/service.test.ts
import { describe, expect, it } from 'vitest';

import { buildRouteManifest } from './service';

describe('buildRouteManifest', () => {
  it('returns empty manifest when no routes are registered', () => {
    expect(buildRouteManifest(() => [])).toEqual({ routes: [], count: 0 });
  });

  it('copies registered route entries and preserves optional metadata', () => {
    const manifest = buildRouteManifest(() => [
      {
        path: '/api/admin/routes',
        method: 'GET',
        isPublic: false,
        roles: ['admin'],
        hasSchema: true,
        module: 'devtools',
        summary: 'Manifest',
        tags: ['Devtools'],
      },
    ]);
    expect(manifest.count).toBe(1);
    expect(manifest.routes[0]?.path).toBe('/api/admin/routes');
    expect(manifest.routes[0]?.roles).toEqual(['admin']);
  });

  it('propagates errors when route registry reader throws', () => {
    expect(() =>
      buildRouteManifest(() => {
        throw new Error('registry unavailable');
      }),
    ).toThrow('registry unavailable');
  });

  it('does not allow caller mutation of returned roles/tags arrays to corrupt source entries', () => {
    const sourceRoles = ['admin'];
    const sourceTags = ['Devtools'];
    const manifest = buildRouteManifest(() => [
      {
        path: '/api/admin/routes',
        method: 'GET',
        isPublic: false,
        roles: sourceRoles,
        hasSchema: true,
        module: 'devtools',
        tags: sourceTags,
      },
    ]);
    manifest.routes[0]?.roles.push('mutated');
    manifest.routes[0]?.tags?.push('mutated-tag');
    expect(sourceRoles).toEqual(['admin']);
    expect(sourceTags).toEqual(['Devtools']);
  });
});
