// main/tools/scripts/audit/route-contract-coverage.ts
/**
 * Route contract coverage gate.
 *
 * Verifies bidirectional contract parity across both legacy route maps and
 * native installed modules:
 * 1. Every non-exempt server route has a matching contract in the composed router.
 * 2. Every mutating non-exempt server route declares a request schema (`hasSchema`).
 * 3. Every contract endpoint in the composed router corresponds to a registered route.
 */

import fs from 'node:fs';
import path from 'node:path';

import { composeRouter } from '@bslt/contract';
import { devOnlyModules, installedModules } from '@bslt/server/generated/modules';

import { fail, pass, type CheckResult } from '../../gates/types';

import { generateManifest, populateRegistryFromRouteMaps } from './route-manifest';

import type { RouteManifestEntry } from './route-manifest';

type EndpointKey = `${Uppercase<string>} ${string}`;

export interface ContractEndpoint {
  readonly domain: string;
  readonly key: string;
  readonly method: string;
  readonly path: string;
  readonly rawBodyWebhook?: boolean | undefined;
}

interface RouteCoverage {
  readonly route: RouteManifestEntry;
  readonly contract?: ContractEndpoint | undefined;
  readonly exemptReason?: string | undefined;
  readonly requiresSchema: boolean;
}

interface CoverageReport {
  readonly totalRoutes: number;
  readonly exemptRoutes: number;
  readonly auditedRoutes: number;
  readonly contractEndpoints: number;
  readonly routesWithContracts: number;
  readonly routesWithRequiredSchema: number;
  readonly missingContracts: readonly RouteCoverage[];
  readonly missingRequiredSchemas: readonly RouteCoverage[];
  readonly contractOnlyEndpoints: readonly ContractEndpoint[];
}

interface RouteContractCoverageOptions {
  /** Fail when audited routes miss a contract, required schema, or route registration. */
  readonly failOnDrift?: boolean;
  /** Print every uncovered route instead of a shortened list. */
  readonly verbose?: boolean;
  /** Optional route override for unit testing. */
  readonly routes?: readonly RouteManifestEntry[];
  /** Optional contract override for unit testing. */
  readonly contracts?: readonly ContractEndpoint[];
}

interface ExemptionRule {
  readonly reason: string;
  readonly module?: string;
  readonly pattern?: RegExp;
}

const EXEMPTION_RULES: readonly ExemptionRule[] = [
  { module: 'system', reason: 'infrastructure health endpoint' },
  { module: 'realtime', reason: 'optional realtime transport endpoint' },
  { module: 'files', reason: 'file transfer endpoint' },
  {
    pattern: /\/download$/i,
    reason: 'binary file-download endpoint (raw-response client, not typed)',
  },
  { pattern: /\/health$/i, reason: 'health endpoint' },
  { pattern: /\/readiness$/i, reason: 'readiness endpoint' },
  {
    pattern: /\/api\/auth\/oauth\/(google|github|apple|kakao)(?:\/callback|\/link|\/unlink)?$/i,
    reason: 'OAuth browser redirect endpoint',
  },
] as const;

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const MAX_LIST_ITEMS = 25;

function normalizePath(rawPath: string): string {
  let pathValue = rawPath.trim();
  const queryIndex = pathValue.indexOf('?');
  if (queryIndex >= 0) pathValue = pathValue.slice(0, queryIndex);

  if (pathValue.startsWith('http://') || pathValue.startsWith('https://')) {
    const apiIndex = pathValue.indexOf('/api/');
    if (apiIndex >= 0) pathValue = pathValue.slice(apiIndex);
  }

  const apiIndexInPath = pathValue.indexOf('/api/');
  if (apiIndexInPath >= 0) pathValue = pathValue.slice(apiIndexInPath);

  if (!pathValue.startsWith('/')) pathValue = `/${pathValue}`;
  if (!pathValue.startsWith('/api/')) pathValue = `/api${pathValue}`;

  return pathValue
    .replace(/\/\$\{[^}]+\}/gu, '/:param')
    .replace(/\$\{[^}]+\}/gu, '')
    .replace(/\/+/gu, '/');
}

function endpointKey(method: string, pathValue: string): EndpointKey {
  return `${method.toUpperCase()} ${normalizePath(pathValue)}` as EndpointKey;
}

function pathsEquivalent(left: string, right: string): boolean {
  const leftSegments = normalizePath(left).split('/').filter(Boolean);
  const rightSegments = normalizePath(right).split('/').filter(Boolean);

  if (leftSegments.length !== rightSegments.length) return false;

  for (let index = 0; index < leftSegments.length; index += 1) {
    const leftSegment = leftSegments[index];
    const rightSegment = rightSegments[index];
    if (leftSegment === undefined || rightSegment === undefined) return false;
    if (leftSegment.startsWith(':') || rightSegment.startsWith(':')) continue;
    if (leftSegment !== rightSegment) return false;
  }

  return true;
}

function isContractEndpointLike(
  value: unknown,
): value is { readonly method: string; readonly path: string } {
  if (value === null || value === undefined || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return typeof obj['method'] === 'string' && typeof obj['path'] === 'string';
}

function flattenContract(domain: string, contract: Record<string, unknown>): ContractEndpoint[] {
  const endpoints: ContractEndpoint[] = [];

  for (const [key, endpoint] of Object.entries(contract)) {
    if (!isContractEndpointLike(endpoint)) continue;
    endpoints.push({
      domain,
      key,
      method: endpoint.method,
      path: normalizePath(endpoint.path),
    });
  }

  return endpoints;
}

function getContractEndpoints(): ContractEndpoint[] {
  const allModules = [...installedModules, ...devOnlyModules];
  const rawBodyWebhooks = new Set<string>();
  for (const mod of allModules) {
    for (const [key, ep] of Object.entries(mod.endpoints)) {
      if (typeof ep.auth === 'object' && 'webhook' in ep.auth && ep.auth.rawBody === true) {
        rawBodyWebhooks.add(`${mod.id}.${key}`);
      }
    }
  }
  const composedRouter = composeRouter(allModules);
  return Object.entries(composedRouter).flatMap(([domain, contract]) =>
    flattenContract(domain, contract as Record<string, unknown>).map((ep) =>
      rawBodyWebhooks.has(`${ep.domain}.${ep.key}`) ? { ...ep, rawBodyWebhook: true } : ep,
    ),
  );
}

function loadRouteManifest(): RouteManifestEntry[] {
  const manifestPath = path.resolve('route-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    populateRegistryFromRouteMaps();
    return generateManifest();
  }

  const raw = fs.readFileSync(manifestPath, 'utf8');
  const jsonStart = raw.indexOf('[');
  if (jsonStart < 0) {
    throw new Error('route-manifest.json does not contain valid JSON array output');
  }

  return JSON.parse(raw.slice(jsonStart)) as RouteManifestEntry[];
}

function getExemptReason(
  route: RouteManifestEntry,
  rules: readonly ExemptionRule[],
): string | undefined {
  for (const rule of rules) {
    if (rule.module !== undefined && route.module === rule.module) return rule.reason;
    if (rule.pattern !== undefined && rule.pattern.test(route.path)) return rule.reason;
  }

  return undefined;
}

function requiresRequestSchema(
  route: RouteManifestEntry,
  contract: ContractEndpoint | undefined,
): boolean {
  if (contract?.rawBodyWebhook === true) {
    return false;
  }
  return !SAFE_METHODS.has(route.method.toUpperCase());
}

function findContract(
  route: RouteManifestEntry,
  contracts: readonly ContractEndpoint[],
): ContractEndpoint | undefined {
  const key = endpointKey(route.method, route.path);
  const exact = contracts.find((contract) => endpointKey(contract.method, contract.path) === key);
  if (exact !== undefined) return exact;

  return contracts.find(
    (contract) =>
      contract.method.toUpperCase() === route.method.toUpperCase() &&
      pathsEquivalent(contract.path, route.path),
  );
}

function hasMatchingRoute(
  contract: ContractEndpoint,
  routes: readonly RouteManifestEntry[],
): boolean {
  const exactKey = endpointKey(contract.method, contract.path);
  return routes.some(
    (route) =>
      endpointKey(route.method, route.path) === exactKey ||
      (route.method.toUpperCase() === contract.method.toUpperCase() &&
        pathsEquivalent(route.path, contract.path)),
  );
}

export function assessRouteContractCoverage(
  routes: readonly RouteManifestEntry[],
  contracts: readonly ContractEndpoint[],
): CoverageReport {
  const coverage: RouteCoverage[] = routes.map((route) => {
    const contract = findContract(route, contracts);
    return {
      route,
      contract,
      exemptReason: getExemptReason(route, EXEMPTION_RULES),
      requiresSchema: requiresRequestSchema(route, contract),
    };
  });

  const contractOnlyEndpoints = contracts.filter((contract) => !hasMatchingRoute(contract, routes));

  const audited = coverage.filter((item) => item.exemptReason === undefined);
  const missingContracts = audited.filter((item) => item.contract === undefined);
  const missingRequiredSchemas = audited.filter(
    (item) => item.requiresSchema && !item.route.hasSchema,
  );

  return {
    totalRoutes: coverage.length,
    exemptRoutes: coverage.length - audited.length,
    auditedRoutes: audited.length,
    contractEndpoints: contracts.length,
    routesWithContracts: audited.filter((item) => item.contract !== undefined).length,
    routesWithRequiredSchema: audited.length - missingRequiredSchemas.length,
    missingContracts,
    missingRequiredSchemas,
    contractOnlyEndpoints,
  };
}

function formatRoute(item: RouteCoverage): string {
  const route = item.route;
  return `${route.method.padEnd(6)} ${route.path} (${route.module})`;
}

function printItems(title: string, items: readonly RouteCoverage[], verbose: boolean): void {
  if (items.length === 0) return;

  const visibleItems = verbose ? items : items.slice(0, MAX_LIST_ITEMS);
  console.log(`\n${title}:\n`);
  for (const item of visibleItems) {
    console.log(`  ${formatRoute(item)}`);
  }

  if (!verbose && items.length > visibleItems.length) {
    console.log(`  ... ${String(items.length - visibleItems.length)} more; rerun with --verbose`);
  }
}

function printReport(report: CoverageReport, verbose: boolean): void {
  console.log('\nRoute Contract Coverage Report\n');
  console.log(`Routes:               ${String(report.totalRoutes)}`);
  console.log(`Exempt routes:        ${String(report.exemptRoutes)}`);
  console.log(`Audited routes:       ${String(report.auditedRoutes)}`);
  console.log(`Contract endpoints:   ${String(report.contractEndpoints)}`);
  console.log(`Routes w/ contracts:  ${String(report.routesWithContracts)}`);
  console.log(`Routes w/ schemas:    ${String(report.routesWithRequiredSchema)}`);
  console.log(`Missing contracts:    ${String(report.missingContracts.length)}`);
  console.log(`Missing schemas:      ${String(report.missingRequiredSchemas.length)}`);
  console.log(`Contract-only:        ${String(report.contractOnlyEndpoints.length)}`);

  printItems('Missing shared contracts', report.missingContracts, verbose);
  printItems('Missing required request schemas', report.missingRequiredSchemas, verbose);

  if (report.contractOnlyEndpoints.length > 0) {
    console.log('\nContract-only endpoints (in composed router, missing from routes):\n');
    for (const item of report.contractOnlyEndpoints) {
      console.log(`  ${item.method.padEnd(6)} ${item.path} (${item.domain}.${item.key})`);
    }
  }
}

function hasDrift(report: CoverageReport): boolean {
  return (
    report.missingContracts.length > 0 ||
    report.missingRequiredSchemas.length > 0 ||
    report.contractOnlyEndpoints.length > 0
  );
}

export function run(options: RouteContractCoverageOptions = {}): CheckResult {
  const routes = options.routes ?? loadRouteManifest();
  const contracts = options.contracts ?? getContractEndpoints();
  const report = assessRouteContractCoverage(routes, contracts);

  printReport(report, options.verbose === true);

  if (options.failOnDrift === true && hasDrift(report)) {
    return fail(`route contract drift across ${String(report.totalRoutes)} routes`);
  }
  return pass(`${String(report.totalRoutes)} routes audited for contract and schema coverage`);
}
