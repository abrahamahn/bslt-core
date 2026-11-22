// main/kernel/client/src/transport/endpoint-client.ts
/**
 * Contract-inferred endpoint client (`createEndpointClient`) and IndexedDB
 * query persistence allowlist (`createPersistAllowlist`).
 */

import type { Transport } from './transport';
import type { Endpoint, ModuleDefinition, OutputOf } from '@bslt/contract';
import type { Infer, Schema } from '@bslt/schema';

type MergeIntersection<T> = { readonly [K in keyof T]: T[K] };

type CanOmit<T> = object extends T ? true : [T] extends [Record<string, never>] ? true : false;

type ParamsPart<E extends Endpoint> = E['params'] extends Schema
  ? { readonly params: Infer<E['params']> }
  : object;

type QueryPart<E extends Endpoint> = E['query'] extends Schema
  ? CanOmit<Infer<E['query']>> extends true
    ? { readonly query?: Infer<E['query']> | undefined }
    : { readonly query: Infer<E['query']> }
  : object;

type BodyPart<E extends Endpoint> = E['body'] extends Schema
  ? CanOmit<Infer<E['body']>> extends true
    ? { readonly body?: Infer<E['body']> | undefined }
    : { readonly body: Infer<E['body']> }
  : object;

type RawClientInput<E extends Endpoint> = ParamsPart<E> & QueryPart<E> & BodyPart<E>;

export type EndpointClientInput<E extends Endpoint> = keyof RawClientInput<E> extends never
  ? Record<string, never>
  : MergeIntersection<RawClientInput<E>>;

export interface EndpointCallMeta<
  Id extends string = string,
  Name extends string = string,
  E extends Endpoint = Endpoint,
> {
  readonly moduleId: Id;
  readonly endpointName: Name;
  readonly endpoint: E;
}

interface EndpointCallOptions {
  readonly headers?: Readonly<Record<string, string>> | undefined;
}

export type EndpointCall<
  Id extends string = string,
  Name extends string = string,
  E extends Endpoint = Endpoint,
> = (CanOmit<EndpointClientInput<E>> extends true
  ? (input?: EndpointClientInput<E>, options?: EndpointCallOptions) => Promise<OutputOf<E>>
  : (input: EndpointClientInput<E>, options?: EndpointCallOptions) => Promise<OutputOf<E>>) &
  EndpointCallMeta<Id, Name, E>;

export type EndpointClient<Id extends string, C extends Readonly<Record<string, Endpoint>>> = {
  readonly [K in keyof C & string]: EndpointCall<Id, K, C[K]>;
};

function formatUrlPart(val: unknown): string | undefined {
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'bigint') {
    return String(val);
  }
  return undefined;
}

function buildUrlPath(
  template: string,
  params: Record<string, unknown> | undefined,
  query: Record<string, unknown> | undefined,
): string {
  const segments = template.split('/');
  const resolved = segments.map((segment) => {
    if (!segment.startsWith(':')) return segment;
    const key = segment.slice(1);
    const formatted = formatUrlPart(params?.[key]);
    if (formatted === undefined || formatted.length === 0) {
      throw new Error(`Missing path parameter "${key}" for endpoint "${template}"`);
    }
    return encodeURIComponent(formatted);
  });

  const basePath = resolved.join('/');
  if (query === undefined) {
    return basePath;
  }

  const searchParams = new URLSearchParams();
  for (const key of Object.keys(query).sort()) {
    const value = query[key];
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        const formattedItem = formatUrlPart(item);
        if (formattedItem !== undefined) {
          searchParams.append(key, formattedItem);
        }
      }
    } else if (value !== null) {
      const formattedValue = formatUrlPart(value);
      if (formattedValue !== undefined) {
        searchParams.set(key, formattedValue);
      }
    }
  }

  const qs = searchParams.toString();
  return qs.length > 0 ? `${basePath}?${qs}` : basePath;
}

/**
 * Create a typed client from a module manifest's `endpoints` over a shared {@link Transport}.
 * No codegen: types flow directly from `@bslt/contract` `Endpoint` definitions.
 */
export function createEndpointClient<
  Id extends string,
  C extends Readonly<Record<string, Endpoint>>,
>(module: { readonly id: Id; readonly endpoints: C }, transport: Transport): EndpointClient<Id, C> {
  const client: Record<string, unknown> = {};

  for (const [endpointName, ep] of Object.entries(module.endpoints)) {
    const invoke = async (
      rawInput?: {
        readonly params?: Record<string, unknown>;
        readonly query?: Record<string, unknown>;
        readonly body?: unknown;
      },
      callOptions?: EndpointCallOptions,
    ): Promise<unknown> => {
      const path = buildUrlPath(ep.path, rawInput?.params, rawInput?.query);
      const hasBody = ep.body !== undefined;
      return transport.request(path, {
        method: ep.method,
        rawApiPath: true,
        requiresAuth: ep.auth !== 'public',
        responseSchema: ep.response,
        ...(hasBody ? { body: JSON.stringify(rawInput?.body ?? {}) } : {}),
        ...(callOptions?.headers !== undefined ? { headers: callOptions.headers } : {}),
      });
    };

    const callable = Object.assign(invoke, {
      moduleId: module.id,
      endpointName,
      endpoint: ep,
    });
    client[endpointName] = callable;
  }

  return client as EndpointClient<Id, C>;
}

/**
 * Build a persistence lookup for `[moduleId, endpointName, input]` query keys.
 *
 * Returns:
 * - `true` when `queryKey[0]` is an installed module id AND `queryKey[1]` names an endpoint with `persist: true`
 * - `false` when `queryKey[0]` is an installed module id without `persist: true` (deny-by-default)
 * - `undefined` when `queryKey[0]` is not an installed module id (so legacy coexistence rules can decide)
 */
export function createPersistAllowlist(
  modules: readonly Pick<ModuleDefinition, 'id' | 'endpoints'>[],
): (queryKey: readonly unknown[]) => boolean | undefined {
  const persistableByModule = new Map<string, ReadonlySet<string>>();
  for (const mod of modules) {
    const allowed = new Set<string>();
    for (const [name, ep] of Object.entries(mod.endpoints)) {
      if (ep.persist === true) {
        allowed.add(name);
      }
    }
    persistableByModule.set(mod.id, allowed);
  }

  return (queryKey: readonly unknown[]): boolean | undefined => {
    const head = queryKey[0];
    if (typeof head !== 'string') return undefined;
    const allowed = persistableByModule.get(head);
    if (allowed === undefined) return undefined;
    const endpointName = queryKey[1];
    if (typeof endpointName !== 'string') return false;
    return allowed.has(endpointName);
  };
}
