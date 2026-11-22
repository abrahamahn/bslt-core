// main/modules/devtools/web/routeInventory.test.ts
import { describe, expect, it } from 'vitest';

import { apiRouteInventory, getApiRouteCoverage, type ApiRouteDefinition } from './routeInventory';

describe('routeInventory & getApiRouteCoverage', () => {
  it('REJECTS duplicate method+path entries, non-/api paths, empty modules, and invalid methods', () => {
    expect(apiRouteInventory.length).toBeGreaterThan(0);

    const seenKeys = new Set<string>();
    const duplicateKeys: string[] = [];
    const nonApiPaths: string[] = [];
    const blankModules: string[] = [];
    const invalidMethods: string[] = [];
    const validMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

    for (const entry of apiRouteInventory) {
      const typed: ApiRouteDefinition = entry;
      const key = `${typed.method}:${typed.path}`;
      if (seenKeys.has(key)) duplicateKeys.push(key);
      seenKeys.add(key);

      if (!typed.path.startsWith('/api/')) nonApiPaths.push(typed.path);
      if (typed.module.trim() === '') blankModules.push(key);
      if (!validMethods.has(typed.method)) invalidMethods.push(typed.method);
    }

    expect(duplicateKeys).toEqual([]);
    expect(nonApiPaths).toEqual([]);
    expect(blankModules).toEqual([]);
    expect(invalidMethods).toEqual([]);
    expect(seenKeys.has('GET:/api/nonexistent-route')).toBe(false);
    expect(seenKeys.has('DELETE:/api/tasks')).toBe(false);
  });

  it('CLASSIFIES unknown mutations and unbacked routes as Pending and No product workflow', () => {
    const unbacked = {
      method: 'DELETE',
      path: '/api/internal/orphan',
      module: 'system',
      public: false,
    } as unknown as ApiRouteDefinition;
    expect(getApiRouteCoverage(unbacked)).toEqual({
      frontend: 'No product workflow',
      note: null,
      smoke: 'Pending',
    });

    const oauthCallback = {
      method: 'GET',
      path: '/api/auth/oauth/google/callback',
      module: 'identity',
      public: true,
    } as ApiRouteDefinition;
    expect(getApiRouteCoverage(oauthCallback).smoke).toBe('Pending');
    expect(getApiRouteCoverage(oauthCallback).frontend).toBe('External callback');
  });

  it('marks task routes as backed by product workflows and covered by smoke suites', () => {
    expect(
      getApiRouteCoverage({
        method: 'GET',
        path: '/api/tasks',
        module: 'tasks',
        public: false,
      }).frontend,
    ).toBe('Product workflow');
    expect(
      getApiRouteCoverage({
        method: 'POST',
        path: '/api/tasks/create',
        module: 'tasks',
        public: false,
      }).smoke,
    ).toBe('Mutation smoke');
  });
});
