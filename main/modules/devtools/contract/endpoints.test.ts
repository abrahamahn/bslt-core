// main/modules/devtools/contract/endpoints.test.ts
import { describe, expect, it } from 'vitest';

import { devtoolsEndpoints } from './endpoints';

describe('@bslt/devtools endpoints', () => {
  it('declares admin-protected GET /api/admin/routes', () => {
    expect(devtoolsEndpoints.getRouteManifest.method).toBe('GET');
    expect(devtoolsEndpoints.getRouteManifest.path).toBe('/api/admin/routes');
    expect(devtoolsEndpoints.getRouteManifest.auth).toBe('admin');
  });

  it('rejects invalid response payloads on getRouteManifest response schema', () => {
    expect(devtoolsEndpoints.getRouteManifest.response.safeParse(null).success).toBe(false);
    expect(
      devtoolsEndpoints.getRouteManifest.response.safeParse({ routes: [], count: -5 }).success,
    ).toBe(false);
  });
});
