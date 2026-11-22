// main/kernel/react/src/query/useEndpoint.ts
/**
 * Contract-driven React query and mutation hooks (`useEndpoint`, `useEndpointMutation`).
 *
 * Bridges `createEndpointClient` callables directly to `QueryCache`:
 * - Canonical query key `[moduleId, endpointName]` or `[moduleId, endpointName, input]`
 * - Automatic sibling cache invalidation via `Endpoint.invalidates`
 */

import { useMemo } from 'react';

import { useQueryCache } from './QueryCacheProvider';
import { useMutation, type UseMutationOptions, type UseMutationResult } from './useMutation';
import { useQuery, type UseQueryOptions, type UseQueryResult } from './useQuery';

import type {
  EndpointCall,
  EndpointCallMeta,
  EndpointClientInput,
  QueryKey,
} from '@bslt/client-engine';
import type { Endpoint, OutputOf } from '@bslt/contract';

type CanOmitInput<T> = object extends T ? true : [T] extends [Record<string, never>] ? true : false;

export type UseEndpointOptions<E extends Endpoint, TError = Error> = Omit<
  UseQueryOptions<OutputOf<E>, TError>,
  'queryKey' | 'queryFn'
>;

export type UseEndpointMutationOptions<
  E extends Endpoint,
  TError = Error,
  TContext = unknown,
> = Omit<UseMutationOptions<OutputOf<E>, TError, EndpointClientInput<E>, TContext>, 'mutationFn'>;

function isEmptyInputObject(input: unknown): boolean {
  if (input === undefined) return true;
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  return Object.keys(input).length === 0;
}

/**
 * Derive the canonical `QueryCache` key for a contract endpoint call.
 */
export function endpointQueryKey<Id extends string, Name extends string, E extends Endpoint>(
  call: EndpointCallMeta<Id, Name, E>,
  input?: EndpointClientInput<E>,
): QueryKey {
  return isEmptyInputObject(input)
    ? [call.moduleId, call.endpointName]
    : [call.moduleId, call.endpointName, input];
}

export function useEndpoint<
  Id extends string,
  Name extends string,
  E extends Endpoint,
  TError = Error,
>(
  call: EndpointCall<Id, Name, E>,
  ...args: CanOmitInput<EndpointClientInput<E>> extends true
    ? [input?: EndpointClientInput<E>, options?: UseEndpointOptions<E, TError>]
    : [input: EndpointClientInput<E>, options?: UseEndpointOptions<E, TError>]
): UseQueryResult<OutputOf<E>, TError> {
  const input = args[0];
  const options = args[1];

  const queryKey = useMemo(() => endpointQueryKey(call, input), [call, input]);
  const invoke = call as unknown as (arg?: EndpointClientInput<E>) => Promise<OutputOf<E>>;

  return useQuery<OutputOf<E>, TError>({
    ...options,
    queryKey,
    queryFn: () => invoke(input),
  });
}

export function useEndpointMutation<
  Id extends string,
  Name extends string,
  E extends Endpoint,
  TError = Error,
  TContext = unknown,
>(
  call: EndpointCall<Id, Name, E>,
  options?: UseEndpointMutationOptions<E, TError, TContext>,
): UseMutationResult<OutputOf<E>, TError, EndpointClientInput<E>> {
  const cache = useQueryCache();
  const invoke = call as unknown as (arg: EndpointClientInput<E>) => Promise<OutputOf<E>>;
  const userOnSuccess = options?.onSuccess;

  return useMutation<OutputOf<E>, TError, EndpointClientInput<E>, TContext>({
    ...options,
    mutationFn: (variables) => invoke(variables),
    onSuccess: async (data, variables, context) => {
      const siblings = call.endpoint.invalidates;
      if (siblings !== undefined && siblings.length > 0) {
        const siblingSet = new Set(siblings);
        cache.invalidateQueries(
          (key) => key[0] === call.moduleId && typeof key[1] === 'string' && siblingSet.has(key[1]),
        );
      }
      if (userOnSuccess !== undefined) {
        await userOnSuccess(data, variables, context);
      }
    },
  });
}
