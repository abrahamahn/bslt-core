// main/tools/snapshot/api.ts
/**
 * `bslt snapshot api`: the API surface oracle (restructure plan, sections 7.1,
 * 14.3 and Phase 5).
 *
 * It composes the server with the production `buildApp()` and records every
 * route the server serves: the route maps `registerRoutes` composes, and the
 * routes registered straight on the server at boot (the provider webhooks, the
 * CSRF token, the uploads). Per route: method, path, the declared
 * auth requirement, the schema the route validates its body with, and the
 * schemas of its contract.
 *
 * Three sources, joined by method and path:
 * - `built.routes()`: what Fastify registered. A row exists because the server
 *   serves the route.
 * - the route registry of `@bslt/server-system/http`: what `registerRouteMap`
 *   was told (public or protected, roles, module, the schema object).
 * - `composeRouter` of `@bslt/contract` and module contract sources (./contract-source.ts):
 *   the contract endpoint of the route and its schema expressions.
 *
 * No database: `buildApp` gets a context, so no phase opens a connection. The
 * environment is pinned below; nothing is read from `process.env`.
 */
import { AUTH_STRATEGIES, composeRouter } from '@bslt/contract';
import { buildApp, type BuildAppOptions } from '@bslt/server/bootstrap/build-app';
import { devOnlyModules, installedModules } from '@bslt/server/generated/modules';
import { load } from '@bslt/server-system/config';
import {
  clearRegistry,
  getRegisteredRoutes,
  getRouteDefinition,
  type RouteOpenApiMeta,
} from '@bslt/server-system/http';
import { createLogger } from '@bslt/server-system/logger';

import { REPO_ROOT } from '../lib/paths';

import { readContractSources, type ContractSchemaSource } from './contract-source';
import { API_SNAPSHOT, checkSnapshot, compareText, serializeSnapshot } from './snapshot-file';

import type { CheckResult } from '../gates/types';
import type { InfraContext } from '@bslt/server/bootstrap/context';

export { API_SNAPSHOT } from './snapshot-file';

/**
 * The environment the snapshot composes the server for: the widest route set
 * one configuration gives. Every auth strategy is on (the strategy filter drops
 * no auth route), billing is on (the provider webhook routes are registered),
 * storage is local (`/uploads/*` is served). The values are placeholders: the
 * server is composed, never started, and nothing connects anywhere.
 */
export const API_SNAPSHOT_ENV: Readonly<Record<string, string>> = {
  NODE_ENV: 'test',
  AUTH_STRATEGIES: AUTH_STRATEGIES.join(','),
  DATABASE_URL: 'postgresql://127.0.0.1:1/api-snapshot-never-opened',
  JWT_SECRET: 'api-snapshot-placeholder-jwt-0123456789-abcdefghij',
  COOKIE_SECRET: 'api-snapshot-placeholder-cookie-0123456789-abcdefg',
  OAUTH_TOKEN_ENCRYPTION_KEY: 'api-snapshot-placeholder-oauth-0123456789-abcdefgh',
  STRIPE_SECRET_KEY: 'api-snapshot-placeholder',
  STRIPE_PUBLISHABLE_KEY: 'api-snapshot-placeholder',
};

/** A route as Fastify registered it (`BuiltApp.routes()`). */
export interface ServedRoute {
  readonly method: string;
  readonly url: string;
}

/** What `registerRouteMap` was told about a route. */
export interface RegisteredRoute {
  readonly method: string;
  readonly path: string;
  readonly module: string;
  readonly isPublic: boolean;
  readonly roles: readonly string[];
  readonly deprecated: boolean;
  /** The schema object the route validates its body with, if any. */
  readonly schema: unknown;
  /** Names of the route's own pre-handlers (they run after the auth guard). */
  readonly preHandlers: readonly string[];
  readonly bodyLimit: number | null;
  readonly summary?: string;
  /** The JSON Schemas Fastify validates and serializes the route with. */
  readonly openapi?: RouteOpenApiMeta;
}

/** An endpoint of `apiRouter`: its schema objects, and their expressions in the source. */
export interface ContractEndpoint {
  /** `<domain>.<endpoint>`. */
  readonly id: string;
  readonly method: string;
  readonly path: string;
  readonly summary?: string;
  readonly schemas: {
    readonly body?: unknown;
    readonly query?: unknown;
    /** One schema for all path parameters, or one per parameter. */
    readonly pathParams?: unknown;
    readonly responses: Readonly<Record<string, unknown>>;
  };
  readonly source: ContractSchemaSource;
}

export interface ApiRouteContract {
  readonly endpoint: string;
  readonly body: string | null;
  readonly query: string | null;
  readonly pathParams: string | null;
  readonly responses: Readonly<Record<string, string>>;
}

/** One row of the snapshot. */
export interface ApiRoute {
  readonly method: string;
  readonly path: string;
  /** GET rows only: Fastify also answers HEAD on this path. */
  readonly head?: boolean;
  /** `route-map`: through `registerRouteMap`. `server`: straight on the Fastify instance. */
  readonly registeredBy: 'route-map' | 'server';
  readonly module: string | null;
  /**
   * `public`, `authenticated` (any signed-in user) or `role` (one of `roles`),
   * as the route map declares it. `undeclared` for a route registered straight
   * on the server: whatever it checks, it checks in its handler.
   */
  readonly auth: 'public' | 'authenticated' | 'role' | 'undeclared';
  readonly roles: readonly string[];
  readonly deprecated: boolean;
  readonly bodyLimit: number | null;
  readonly preHandlers: readonly string[];
  /** The schema the route validates its body with, by its expression in the contracts. */
  readonly request: string | null;
  readonly contract: ApiRouteContract | null;
}

/** A schema that is in no contract has no name to give. */
const UNDECLARED_SCHEMA = '(a schema no contract declares)';

const routeKey = (method: string, path: string): string => `${method.toUpperCase()} ${path}`;

/** `/api/items/:itemId` and `/api/items/:id` are the same route. */
const parameterless = (path: string): string => path.replace(/:[^/]+/gu, ':');

function schemaNames(contracts: readonly ContractEndpoint[]): Map<unknown, string> {
  const names = new Map<unknown, string>();
  const name = (schema: unknown, text: string | null | undefined): void => {
    if (schema === undefined || text === null || text === undefined || names.has(schema)) return;
    names.set(schema, text);
  };
  for (const contract of [...contracts].sort((a, b) => compareText(a.id, b.id))) {
    name(contract.schemas.body, contract.source.body);
    name(contract.schemas.query, contract.source.query);
    for (const [status, schema] of Object.entries(contract.schemas.responses)) {
      name(schema, contract.source.responses[status]);
    }
  }
  return names;
}

function contractOf(
  method: string,
  path: string,
  contracts: readonly ContractEndpoint[],
): ContractEndpoint | undefined {
  const sameMethod = contracts.filter((contract) => contract.method.toUpperCase() === method);
  const exact = sameMethod.filter((contract) => contract.path === path);
  const matches =
    exact.length > 0
      ? exact
      : sameMethod.filter((contract) => parameterless(contract.path) === parameterless(path));
  if (matches.length > 1) {
    throw new Error(
      `${routeKey(method, path)} is claimed by more than one contract endpoint: ${matches
        .map((contract) => contract.id)
        .sort(compareText)
        .join(', ')}`,
    );
  }
  return matches[0];
}

/**
 * The snapshot rows for a composed server, sorted by path and then method.
 *
 * @throws {Error} When the route registry names a route the server does not
 *   serve (the registry belongs to another server, or to another copy of the
 *   module), or when two contract endpoints claim one route.
 */
export function describeApiRoutes(input: {
  readonly served: readonly ServedRoute[];
  readonly registered: readonly RegisteredRoute[];
  readonly contracts: readonly ContractEndpoint[];
}): ApiRoute[] {
  const servedKeys = new Set(input.served.map((route) => routeKey(route.method, route.url)));
  const registry = new Map<string, RegisteredRoute>();
  for (const route of input.registered) {
    const key = routeKey(route.method, route.path);
    if (!servedKeys.has(key)) {
      throw new Error(
        `the route registry lists ${key}, which is not served by the composed server`,
      );
    }
    registry.set(key, route);
  }
  const names = schemaNames(input.contracts);

  const rows: ApiRoute[] = [];
  for (const key of [...servedKeys]) {
    const [method = '', path = ''] = key.split(' ');
    // Fastify answers HEAD wherever it answers GET; that is a property of the GET row.
    if (method === 'HEAD' && servedKeys.has(routeKey('GET', path))) continue;
    const route = registry.get(key);
    const contract = contractOf(method, path, input.contracts);
    const roles = [...(route?.roles ?? [])].sort(compareText);
    rows.push({
      method,
      path,
      ...(method === 'GET' ? { head: servedKeys.has(routeKey('HEAD', path)) } : {}),
      registeredBy: route === undefined ? 'server' : 'route-map',
      module: route?.module ?? null,
      auth:
        route === undefined
          ? 'undeclared'
          : route.isPublic
            ? 'public'
            : roles.length > 0
              ? 'role'
              : 'authenticated',
      roles,
      deprecated: route?.deprecated ?? false,
      bodyLimit: route?.bodyLimit ?? null,
      preHandlers: [...(route?.preHandlers ?? [])],
      request: route?.schema === undefined ? null : (names.get(route.schema) ?? UNDECLARED_SCHEMA),
      contract:
        contract === undefined
          ? null
          : {
              endpoint: contract.id,
              body: contract.source.body,
              query: contract.source.query,
              pathParams: contract.source.pathParams,
              responses: contract.source.responses,
            },
    });
  }
  return rows.sort((a, b) => compareText(a.path, b.path) || compareText(a.method, b.method));
}

interface RuntimeEndpoint {
  readonly method: string;
  readonly path: string;
  readonly summary?: string;
  readonly body?: unknown;
  readonly query?: unknown;
  readonly pathParams?: unknown;
  readonly responses: Readonly<Record<string, unknown>>;
}

/** The endpoints of the composed router, each with the schema expressions of its source. */
export function contractEndpoints(root: string = REPO_ROOT): ContractEndpoint[] {
  const sources = readContractSources(root);
  const composedRouter = composeRouter([...installedModules, ...devOnlyModules]);
  const endpoints: ContractEndpoint[] = [];
  for (const [domain, contract] of Object.entries(composedRouter)) {
    for (const [key, endpoint] of Object.entries(contract as Record<string, RuntimeEndpoint>)) {
      const id = `${domain}.${key}`;
      const source = sources.get(id);
      if (source === undefined) {
        throw new Error(
          `contract endpoint ${id} exists at runtime but was not found in the source`,
        );
      }
      endpoints.push({
        id,
        method: endpoint.method,
        path: endpoint.path,
        ...(endpoint.summary === undefined ? {} : { summary: endpoint.summary }),
        schemas: {
          ...(endpoint.body === undefined ? {} : { body: endpoint.body }),
          ...(endpoint.query === undefined ? {} : { query: endpoint.query }),
          ...(endpoint.pathParams === undefined ? {} : { pathParams: endpoint.pathParams }),
          responses: endpoint.responses,
        },
        source,
      });
    }
  }
  return endpoints;
}

function registeredRoutes(): RegisteredRoute[] {
  return getRegisteredRoutes().map((entry) => {
    const definition = getRouteDefinition(entry);
    return {
      method: entry.method,
      path: entry.path,
      module: entry.module,
      isPublic: entry.isPublic,
      roles: entry.roles,
      deprecated: entry.deprecated === true,
      schema: definition?.schema,
      preHandlers: (definition?.preHandlers ?? []).map((handler) =>
        handler.name === '' ? '(anonymous)' : handler.name,
      ),
      bodyLimit: definition?.routeOptions?.bodyLimit ?? null,
      ...(entry.summary === undefined ? {} : { summary: entry.summary }),
      ...(definition?.openapi === undefined ? {} : { openapi: definition.openapi }),
    };
  });
}

export interface BuildApiSnapshotOptions {
  /** Repository root the contract sources are read from. */
  readonly root?: string;
  /** Passed to `buildApp`: runs after the routes are registered (tests seed a change here). */
  readonly extend?: BuildAppOptions['extend'];
}

/** The server composed for the snapshot, described by its three sources. */
export interface ComposedApi {
  readonly config: ReturnType<typeof load>;
  /** The snapshot rows (`describeApiRoutes`). */
  readonly rows: readonly ApiRoute[];
  readonly registered: readonly RegisteredRoute[];
  readonly contracts: readonly ContractEndpoint[];
}

/**
 * Compose the server under `API_SNAPSHOT_ENV` and read its routes, its route
 * registry and the contracts. The API snapshot and the OpenAPI document
 * (../sync/openapi.ts) are both written from this.
 *
 * @param options - Test seams; the commands pass none.
 */
export async function composeApi(options: BuildApiSnapshotOptions = {}): Promise<ComposedApi> {
  const config = load({ ...API_SNAPSHOT_ENV });
  // Route registration reads the config, the logger, the repositories (the
  // guard closes over them) and `db.healthCheck`. Nothing is called.
  const context = {
    config,
    log: createLogger('error', { service: 'bslt-snapshot-api', env: 'test' }),
    db: { healthCheck: () => Promise.resolve(true) },
    repos: {},
    errorTracker: {
      captureError: () => undefined,
      addBreadcrumb: () => undefined,
      setUserContext: () => undefined,
    },
  } as unknown as InfraContext;

  // The registry is one list per process: start from an empty one.
  clearRegistry();
  const built = await buildApp(config, {
    context,
    ...(options.extend === undefined ? {} : { extend: options.extend }),
  });
  try {
    await built.ready();
    const registered = registeredRoutes();
    const contracts = contractEndpoints(options.root);
    const rows = describeApiRoutes({ served: built.routes(), registered, contracts });
    return { config, rows, registered, contracts };
  } finally {
    await built.stop();
    clearRegistry();
  }
}

/**
 * Compose the server and return the content of the API snapshot file.
 *
 * @param options - Test seams; the command passes none.
 */
export async function buildApiSnapshot(options: BuildApiSnapshotOptions = {}): Promise<string> {
  const { config, rows } = await composeApi(options);
  return serializeSnapshot(API_SNAPSHOT, {
    composedFor: {
      authStrategies: [...config.auth.strategies],
      billingProvider: config.billing.enabled ? config.billing.provider : null,
      storageProvider: config.storage.provider,
    },
    routes: rows,
  });
}

/** The `snapshot-api` gate: the committed snapshot equals what the server composes now. */
export async function run(root: string = REPO_ROOT): Promise<CheckResult> {
  return checkSnapshot(API_SNAPSHOT, await buildApiSnapshot({ root }), root);
}
