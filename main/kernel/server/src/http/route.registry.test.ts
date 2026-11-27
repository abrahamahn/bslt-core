// main/kernel/server/src/http/route.registry.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearRegistry, getRegisteredRoutes, registerRoute } from './route.registry';

describe('route registry singleton', () => {
  beforeEach(() => {
    clearRegistry();
  });

  afterEach(() => {
    clearRegistry();
  });

  it('starts empty after clearRegistry', () => {
    expect(getRegisteredRoutes()).toEqual([]);
  });

  it('records registered routes in order with full metadata', () => {
    registerRoute({
      path: '/api/auth/login',
      method: 'POST',
      isPublic: true,
      roles: [],
      hasSchema: true,
      module: 'identity',
      summary: 'Authenticate user',
      tags: ['auth'],
    });
    registerRoute({
      path: '/api/admin/users',
      method: 'GET',
      isPublic: false,
      roles: ['admin'],
      hasSchema: false,
      module: 'admin',
      deprecated: true,
    });

    const routes = getRegisteredRoutes();
    expect(routes).toHaveLength(2);
    expect(routes[0]).toMatchObject({
      path: '/api/auth/login',
      method: 'POST',
      isPublic: true,
      hasSchema: true,
      module: 'identity',
      summary: 'Authenticate user',
      tags: ['auth'],
    });
    expect(routes[1]).toMatchObject({
      path: '/api/admin/users',
      method: 'GET',
      isPublic: false,
      roles: ['admin'],
      deprecated: true,
    });
  });

  it('clears all previously registered entries on clearRegistry', () => {
    registerRoute({
      path: '/api/health',
      method: 'GET',
      isPublic: true,
      roles: [],
      hasSchema: false,
      module: 'system',
    });
    expect(getRegisteredRoutes()).toHaveLength(1);

    clearRegistry();
    expect(getRegisteredRoutes()).toHaveLength(0);
  });
});
