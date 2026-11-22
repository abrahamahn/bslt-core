// main/tools/scripts/audit/route-contract-coverage.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import { assessRouteContractCoverage, run, type ContractEndpoint } from './route-contract-coverage';

import type { RouteManifestEntry } from './route-manifest';

describe('route-contract-coverage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fails when a non-exempt route is missing a contract', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const routes: readonly RouteManifestEntry[] = [
      {
        path: '/api/tasks',
        method: 'GET',
        isPublic: false,
        module: 'tasks',
        hasSchema: false,
      },
    ];

    const report = assessRouteContractCoverage(routes, []);
    expect(report.missingContracts).toHaveLength(1);
    expect(report.missingContracts[0]?.route.path).toBe('/api/tasks');

    const result = run({ failOnDrift: true, routes, contracts: [] });
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('route contract drift');
  });

  it('fails when a mutating non-exempt route lacks a request schema', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const routes: readonly RouteManifestEntry[] = [
      {
        path: '/api/tasks/create',
        method: 'POST',
        isPublic: false,
        module: 'tasks',
        hasSchema: false,
      },
    ];
    const contracts: readonly ContractEndpoint[] = [
      {
        domain: 'tasks',
        key: 'create',
        method: 'POST',
        path: '/api/tasks/create',
      },
    ];

    const report = assessRouteContractCoverage(routes, contracts);
    expect(report.missingContracts).toHaveLength(0);
    expect(report.missingRequiredSchemas).toHaveLength(1);

    const result = run({ failOnDrift: true, routes, contracts });
    expect(result.ok).toBe(false);
  });

  it('fails when a contract endpoint has no matching server route', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const contracts: readonly ContractEndpoint[] = [
      {
        domain: 'tasks',
        key: 'ghost',
        method: 'POST',
        path: '/api/tasks/ghost',
      },
    ];

    const report = assessRouteContractCoverage([], contracts);
    expect(report.contractOnlyEndpoints).toEqual(contracts);

    const result = run({ failOnDrift: true, routes: [], contracts });
    expect(result.ok).toBe(false);
  });

  it('treats method mismatches on the same path as both missing contract and contract-only drift', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const routes: readonly RouteManifestEntry[] = [
      {
        path: '/api/tasks/:id/delete',
        method: 'DELETE',
        isPublic: false,
        module: 'tasks',
        hasSchema: true,
      },
    ];
    const contracts: readonly ContractEndpoint[] = [
      {
        domain: 'tasks',
        key: 'delete',
        method: 'POST',
        path: '/api/tasks/:id/delete',
      },
    ];

    const report = assessRouteContractCoverage(routes, contracts);
    expect(report.missingContracts).toHaveLength(1);
    expect(report.contractOnlyEndpoints).toHaveLength(1);

    const result = run({ failOnDrift: true, routes, contracts });
    expect(result.ok).toBe(false);
  });

  it('audits rawBody webhook routes for contract presence while exempting JSON body schemas', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const routes: readonly RouteManifestEntry[] = [
      {
        path: '/api/health',
        method: 'GET',
        isPublic: true,
        module: 'system',
        hasSchema: false,
      },
      {
        path: '/api/webhooks/stripe',
        method: 'POST',
        isPublic: true,
        module: 'billing',
        hasSchema: false,
      },
      {
        path: '/api/tasks/:taskId/update',
        method: 'POST',
        isPublic: false,
        module: 'tasks',
        hasSchema: true,
      },
    ];
    const contracts: readonly ContractEndpoint[] = [
      {
        domain: 'billing',
        key: 'stripeWebhook',
        method: 'POST',
        path: '/api/webhooks/stripe',
        rawBodyWebhook: true,
      },
      {
        domain: 'tasks',
        key: 'update',
        method: 'POST',
        path: '/api/tasks/:id/update',
      },
    ];

    const result = run({ failOnDrift: true, routes, contracts });
    expect(result.ok).toBe(true);

    // Without a contract, /api/webhooks/stripe is no longer path-exempt!
    const rogueResult = run({
      failOnDrift: true,
      routes: routes.filter((r) => r.path === '/api/webhooks/stripe'),
      contracts: [],
    });
    expect(rogueResult.ok).toBe(false);
  });

  it('passes with zero drift across the composed legacyApiRouter and installedModules', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const result = run({ failOnDrift: true });
    expect(result.ok).toBe(true);
  });
});
