// main/kernel/contract/src/router.ts
import { emptyBodySchema, errorResponseSchema } from './envelope';
import { lookupErrorCode } from './errors';
import { validateModules, type ModuleDefinition } from './module';

import type { Endpoint, HttpMethod } from './endpoint';
import type { Schema } from '@bslt/schema';

export interface ComposedEndpointShape {
  readonly method: HttpMethod;
  readonly path: string;
  readonly pathParams?: Record<string, Schema> | Schema;
  readonly body?: Schema;
  readonly query?: Schema;
  readonly responses: Record<string, Schema>;
  readonly summary?: string;
}

function normalizeParamPath(path: string): string {
  return path.replace(/:[^/]+/gu, ':param');
}

function segmentsOf(path: string): readonly string[] {
  return path.split('/').filter((segment) => segment.length > 0);
}

/**
 * Checks whether an earlier `:param` route shadows a later static route at the
 * same depth and prefix on the same HTTP method.
 */
function shadowsStaticRoute(paramSegs: readonly string[], staticSegs: readonly string[]): boolean {
  if (paramSegs.length !== staticSegs.length) {
    return false;
  }
  let sawParamShadowingStatic = false;
  for (let i = 0; i < paramSegs.length; i++) {
    const earlier = paramSegs[i] ?? '';
    const later = staticSegs[i] ?? '';
    if (earlier === later) {
      continue;
    }
    const earlierIsParam = earlier.startsWith(':');
    const laterIsParam = later.startsWith(':');
    if (earlierIsParam && !laterIsParam) {
      sawParamShadowingStatic = true;
      continue;
    }
    if (earlierIsParam && laterIsParam) {
      continue;
    }
    return false;
  }
  return sawParamShadowingStatic;
}

function buildResponsesForEndpoint(ep: Endpoint): Record<string, Schema> {
  const responses: Record<string, Schema> = {
    [String(ep.status ?? 200)]: ep.response,
  };

  const hasNonEmptyInputSchema =
    (ep.body !== undefined && ep.body !== emptyBodySchema) || ep.query !== undefined;
  if (hasNonEmptyInputSchema) {
    responses['400'] = errorResponseSchema;
  }

  if (ep.auth !== 'public' && !(typeof ep.auth === 'object' && 'webhook' in ep.auth)) {
    responses['401'] = errorResponseSchema;
  }

  if (
    ep.auth === 'admin' ||
    ep.auth === 'moderator' ||
    (typeof ep.auth === 'object' && 'org' in ep.auth) ||
    (ep.requires !== undefined && ep.requires.length > 0)
  ) {
    responses['403'] = errorResponseSchema;
  }

  for (const errCode of ep.errors ?? []) {
    const reg = lookupErrorCode(errCode);
    if (reg !== undefined) {
      responses[String(reg.status)] = errorResponseSchema;
    }
  }

  return responses;
}

export function moduleEndpointsToContract(
  mod: ModuleDefinition,
): Readonly<Record<string, ComposedEndpointShape>> {
  const out: Record<string, ComposedEndpointShape> = {};
  for (const [name, ep] of Object.entries(mod.endpoints)) {
    out[name] = {
      method: ep.method,
      path: ep.path,
      ...(ep.params !== undefined ? { pathParams: ep.params } : {}),
      ...(ep.body !== undefined ? { body: ep.body } : {}),
      ...(ep.query !== undefined ? { query: ep.query } : {}),
      responses: buildResponsesForEndpoint(ep),
      summary: ep.summary,
    };
  }
  return out;
}

type InstalledModulesRouter<Ms extends readonly ModuleDefinition[]> = {
  readonly [M in Ms[number] as keyof M['endpoints'] extends never ? never : M['id']]: {
    readonly [K in keyof M['endpoints']]: ComposedEndpointShape & {
      readonly responses: { readonly 200: M['endpoints'][K]['response'] } & Record<string, Schema>;
    };
  };
};

export function composeRouter<const Ms extends readonly ModuleDefinition[]>(
  installedModules: Ms,
): InstalledModulesRouter<Ms> {
  validateModules(installedModules);

  const merged: Record<string, Readonly<Record<string, ComposedEndpointShape>>> = {};
  const seenNormalized = new Map<string, string>();
  const moduleRoutesByMethod = new Map<
    HttpMethod,
    Array<{ readonly id: string; readonly path: string; readonly segs: readonly string[] }>
  >();

  for (const mod of installedModules) {
    if (Object.keys(mod.endpoints).length === 0) {
      continue;
    }

    merged[mod.id] = moduleEndpointsToContract(mod);

    for (const [key, ep] of Object.entries(mod.endpoints)) {
      const id = `${mod.id}.${key}`;
      const normKey = `${ep.method} ${normalizeParamPath(ep.path)}`;
      const existing = seenNormalized.get(normKey);
      if (existing !== undefined) {
        throw new Error(
          `Duplicate route "${ep.method} ${ep.path}" claimed by both "${existing}" and "${id}"`,
        );
      }
      seenNormalized.set(normKey, id);

      const segs = segmentsOf(ep.path);
      const priorOnMethod = moduleRoutesByMethod.get(ep.method) ?? [];
      for (const earlier of priorOnMethod) {
        if (shadowsStaticRoute(earlier.segs, segs)) {
          throw new Error(
            `Param route "${earlier.id}" (${ep.method} ${earlier.path}) shadows static route "${id}" (${ep.method} ${ep.path}); declare static routes before param routes`,
          );
        }
      }
      priorOnMethod.push({ id, path: ep.path, segs });
      moduleRoutesByMethod.set(ep.method, priorOnMethod);
    }
  }

  const sortedKeys = Object.keys(merged).sort();
  const sortedRouter: Record<string, Readonly<Record<string, ComposedEndpointShape>>> = {};
  for (const key of sortedKeys) {
    const value = merged[key];
    if (value !== undefined) {
      sortedRouter[key] = value;
    }
  }

  return sortedRouter as InstalledModulesRouter<Ms>;
}
