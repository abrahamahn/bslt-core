// main/modules/devtools/contract/schemas.test.ts
import { describe, expect, it } from 'vitest';

import {
  ADMIN_ROUTE_METHODS,
  adminRouteMethodSchema,
  routeManifestEntrySchema,
  routeManifestResponseSchema,
} from './schemas';

describe('@bslt/devtools contract schemas', () => {
  it('accepts valid route manifest entries and responses', () => {
    const validEntry = {
      path: '/api/admin/routes',
      method: 'GET',
      isPublic: false,
      roles: ['admin'],
      hasSchema: true,
      module: 'devtools',
      summary: 'Get registered route manifest',
      tags: ['Devtools'],
    };
    expect(ADMIN_ROUTE_METHODS).toContain('GET');
    expect(adminRouteMethodSchema.parse('POST')).toBe('POST');
    expect(routeManifestEntrySchema.parse(validEntry)).toEqual(validEntry);
    expect(routeManifestResponseSchema.parse({ routes: [validEntry], count: 1 })).toEqual({
      routes: [validEntry],
      count: 1,
    });
  });

  it('rejects unsupported HTTP method names', () => {
    expect(adminRouteMethodSchema.safeParse('CONNECT').success).toBe(false);
    expect(adminRouteMethodSchema.safeParse('TRACE').success).toBe(false);
    expect(adminRouteMethodSchema.safeParse('').success).toBe(false);
  });

  it('rejects malformed route manifest entries (missing fields, non-array roles, unknown keys)', () => {
    expect(routeManifestEntrySchema.safeParse(null).success).toBe(false);
    expect(
      routeManifestEntrySchema.safeParse({
        path: '/api/test',
        method: 'GET',
        isPublic: 'no',
        roles: ['admin'],
        hasSchema: true,
        module: 'test',
      }).success,
    ).toBe(false);
    expect(
      routeManifestEntrySchema.safeParse({
        path: '/api/test',
        method: 'GET',
        isPublic: false,
        roles: 'admin',
        hasSchema: true,
        module: 'test',
      }).success,
    ).toBe(false);
    expect(
      routeManifestEntrySchema.safeParse({
        path: '/api/test',
        method: 'GET',
        isPublic: false,
        roles: ['admin'],
        hasSchema: true,
        module: 'test',
        extraField: true,
      }).success,
    ).toBe(false);
  });

  it('rejects malformed route manifest responses (negative count, non-integer count, non-array routes)', () => {
    expect(routeManifestResponseSchema.safeParse({ routes: 'bad', count: 0 }).success).toBe(false);
    expect(routeManifestResponseSchema.safeParse({ routes: [], count: -1 }).success).toBe(false);
    expect(routeManifestResponseSchema.safeParse({ routes: [], count: 1.5 }).success).toBe(false);
  });
});
