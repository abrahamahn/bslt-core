// main/client/react/src/query/useQuery.ts
/**
 * useQuery - React hook for data fetching with caching.
 *
 * Provides a React Query-compatible API built on our custom QueryCache.
 * Uses useSyncExternalStore for optimal React integration.
 */

import { MS_PER_SECOND } from '@bslt/shared/constants/time';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

import {
  logQueryFailure,
  logQueryRetryDecision,
  logQueryRetryWait,
  logQueryStart,
  logQuerySuccess,
} from './debug';
import { useQueryCache } from './QueryCacheProvider';

import type { QueryKey, QueryState } from '@bslt/client-engine';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for useQuery hook.
 */
export interface UseQueryOptions<TData = unknown, TError = Error> {
  /** Unique key for the query */
  queryKey: QueryKey;
  /** Function that fetches the data */
  queryFn: () => Promise<TData>;
  /** Whether the query is enabled */
  enabled?: boolean;
  /** Time in ms before data is considered stale */
  staleTime?: number;
  /** Time in ms before unused queries are garbage collected */
  gcTime?: number;
  /** Number of retries on failure */
  retry?: number | boolean;
  /** Delay between retries in ms */
  retryDelay?: number;
  /** Refetch on window focus */
  refetchOnWindowFocus?: boolean;
  /** Refetch on reconnect */
  refetchOnReconnect?: boolean;
  /** Initial data to use before fetch completes */
  initialData?: TData;
  /** Placeholder data while loading */
  placeholderData?: TData;
  /** Callback when query succeeds */
  onSuccess?: (data: TData) => void;
  /** Callback when query fails */
  onError?: (error: TError) => void;
  /** Callback when query settles (success or error) */
  onSettled?: (data: TData | undefined, error: TError | null) => void;
}

/**
 * Result of useQuery hook.
 */
export interface UseQueryResult<TData = unknown, TError = Error> {
  /** The query data if available */
  data: TData | undefined;
  /** Error if the query failed */
  error: TError | null;
  /** Whether the initial fetch is in progress */
  isLoading: boolean;
  /** Whether any fetch is in progress */
  isFetching: boolean;
  /** Whether the query failed */
  isError: boolean;
  /** Whether the query succeeded */
  isSuccess: boolean;
  /** Whether the query is pending (never fetched) */
  isPending: boolean;
  /** Whether the data is stale */
  isStale: boolean;
  /** Refetch the query */
  refetch: () => Promise<void>;
  /** The current query status */
  status: QueryState['status'];
  /** The current fetch status */
  fetchStatus: QueryState['fetchStatus'];
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_RETRY = 3;
const DEFAULT_RETRY_DELAY = MS_PER_SECOND;

const waitForRetryDelay = (delayMs: number, signal: AbortSignal): Promise<void> => {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const timeoutId = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);

    const onAbort = (): void => {
      clearTimeout(timeoutId);
      signal.removeEventListener('abort', onAbort);
      resolve();
    };

    signal.addEventListener('abort', onAbort, { once: true });
  });
};

const getHttpStatus = (error: unknown): number | null => {
  const status = (error as { status?: unknown }).status;
  if (typeof status === 'number') return status;

  const statusCode = (error as { statusCode?: unknown }).statusCode;
  if (typeof statusCode === 'number') return statusCode;

  return null;
};

const shouldRetryError = (error: unknown): boolean => {
  const status = getHttpStatus(error);
  if (status === null) return true;
  if (status === 0) return true;
  if (status === 429 || status === 408) return true;
  if (status >= 500) return true;
  if (status >= 400 && status < 500) return false;
  return true;
};

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for fetching and caching data.
 *
 * @example
 * ```tsx
 * function UserProfile({ userId }: { userId: string }) {
 *   const { data, isLoading, error } = useQuery({
 *     queryKey: ['user', userId],
 *     queryFn: () => fetchUser(userId),
 *   });
 *
 *   if (isLoading) return <Spinner />;
 *   if (error) return <Error message={error.message} />;
 *   return <div>{data.name}</div>;
 * }
 * ```
 */
export function useQuery<TData = unknown, TError = Error>(
  options: UseQueryOptions<TData, TError>,
): UseQueryResult<TData, TError> {
  const {
    queryKey,
    queryFn,
    enabled = true,
    staleTime,
    retry = DEFAULT_RETRY,
    retryDelay = DEFAULT_RETRY_DELAY,
    initialData,
    placeholderData,
    onSuccess,
    onError,
    onSettled,
  } = options;

  const cache = useQueryCache();

  // Track if we've done initial fetch
  const hasInitiatedFetch = useRef(false);
  const abortController = useRef<AbortController | null>(null);

  // Subscribe to cache changes
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      return cache.subscribe(queryKey, onStoreChange);
    },
    [cache, queryKey],
  );

  // Get current state snapshot
  const getSnapshot = useCallback((): QueryState<TData, TError> | undefined => {
    return cache.getQueryState<TData, TError>(queryKey);
  }, [cache, queryKey]);

  // Use sync external store for React integration
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // Everything `fetchData` closes over that a caller hands us fresh on every
  // render: `queryKey` is an array literal, `queryFn` is an inline arrow, and
  // the callbacks are inline too. Listing them as deps therefore rebuilt
  // `fetchData` — and so `refetch` — on EVERY render.
  //
  // That is not merely wasteful, it silently breaks consumers. `useNotifications`
  // arms a 60s `setInterval` in a `useEffect` keyed on `[enabled, refetch]`; a
  // `refetch` with a new identity each render cleared and re-armed the timer each
  // render, so in an actively-rendering app the countdown never completed and the
  // unread badge never refreshed. The effect's own comment says it exists to keep
  // the badge live.
  //
  // Reading these through a ref keeps `fetchData`/`refetch` referentially stable
  // while still seeing the current values — in fact more correctly, since they
  // are now read when the fetch RUNS rather than when the callback was built.
  const latest = useRef({
    enabled,
    queryKey,
    queryFn,
    retry,
    retryDelay,
    staleTime,
    onSuccess,
    onError,
    onSettled,
  });

  // Refreshed in an effect, never during render. React may render a component and
  // then throw the render away — a concurrent render that loses to a higher-priority
  // update, StrictMode's double invoke — and a ref written during render would
  // publish values from a render that was never committed. It also runs before the
  // fetch effect below, which is declared after it, so a fetch in the same commit
  // always reads this commit's values.
  //
  // No dependency array on purpose: every commit refreshes it. That is the point,
  // and it costs one assignment. What must NOT change every render is `fetchData` —
  // see the note above.
  useEffect(() => {
    latest.current = {
      enabled,
      queryKey,
      queryFn,
      retry,
      retryDelay,
      staleTime,
      onSuccess,
      onError,
      onSettled,
    };
  });

  // Fetch function with retry logic
  const fetchData = useCallback(
    async (force = false): Promise<void> => {
      const {
        enabled,
        queryKey,
        queryFn,
        retry,
        retryDelay,
        staleTime,
        onSuccess,
        onError,
        onSettled,
      } = latest.current;

      // Don't fetch if disabled. Read at call time, so a `refetch()` issued after
      // the query was disabled still no-ops.
      if (!enabled) return;

      const currentState = cache.getQueryState<TData, TError>(queryKey);

      // Another subscriber for the same key may already be fetching. Let that
      // in-flight request hydrate the shared cache instead of issuing a duplicate.
      if (!force && currentState?.fetchStatus === 'fetching') return;

      // Check if data is fresh (use explicit undefined check to allow null values)
      if (!force && !cache.isStale(queryKey) && currentState?.data !== undefined) return;

      // Abort any in-progress fetch
      abortController.current?.abort();
      const currentController = new AbortController();
      abortController.current = currentController;

      cache.setFetchStatus(queryKey, 'fetching');

      const maxRetries = typeof retry === 'boolean' ? (retry ? DEFAULT_RETRY : 0) : retry;
      const startedAt = logQueryStart(queryKey);
      let attempts = 0;
      let lastError: TError | null = null;
      const resetFetchStatusForAbort = (): void => {
        if (abortController.current === currentController) {
          cache.setFetchStatus(queryKey, 'idle');
          return;
        }

        if (abortController.current === null) {
          cache.setFetchStatus(queryKey, 'idle');
          cache.invalidateQuery(queryKey);
        }
      };

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (currentController.signal.aborted) {
          resetFetchStatusForAbort();
          return;
        }

        try {
          attempts = attempt + 1;
          const data = await queryFn();
          if (abortController.current !== currentController) {
            resetFetchStatusForAbort();
            return;
          }

          cache.setQueryData(queryKey, data, staleTime !== undefined ? { staleTime } : {});
          logQuerySuccess(queryKey, startedAt, attempts);
          onSuccess?.(data);
          onSettled?.(data, null);
          return;
        } catch (err) {
          if (abortController.current !== currentController) {
            resetFetchStatusForAbort();
            return;
          }

          lastError = err as TError;

          // Don't retry or emit errors for aborts.
          if (err instanceof DOMException && err.name === 'AbortError') {
            resetFetchStatusForAbort();
            return;
          }

          // Stop retries for deterministic non-retryable errors (e.g., 401/403/404/422).
          const status = getHttpStatus(err);
          const retryable = shouldRetryError(err);
          logQueryRetryDecision(queryKey, attempt, maxRetries, {
            retryable,
            status,
            reason: retryable ? 'transient-or-unknown' : 'non-retryable-http-status',
          });
          if (!retryable) {
            break;
          }

          // Wait before retry (except on last attempt)
          if (attempt < maxRetries) {
            const delayMs = retryDelay * Math.pow(2, attempt);
            logQueryRetryWait(queryKey, delayMs);
            await waitForRetryDelay(delayMs, currentController.signal);
          }
        }
      }

      // All retries failed
      if (lastError !== null) {
        cache.setQueryError(queryKey, lastError as Error);
        logQueryFailure(queryKey, startedAt, attempts, lastError);
        onError?.(lastError);
        onSettled?.(undefined, lastError);
      }
    },
    // `cache` is the only genuinely stable dependency; everything else is read
    // from `latest` above.
    [cache],
  );

  // Manual refetch function. Stable across renders — consumers arm timers on it.
  const refetch = useCallback(async (): Promise<void> => {
    cache.invalidateQuery(latest.current.queryKey);
    await fetchData(true);
  }, [cache, fetchData]);

  // Initial fetch effect
  useEffect(() => {
    if (!enabled) {
      hasInitiatedFetch.current = false;
      return;
    }

    let shouldForceInitialFetch = false;

    // Set initial data if provided and no data exists
    if (initialData !== undefined && state?.data === undefined) {
      cache.setQueryData(queryKey, initialData, staleTime !== undefined ? { staleTime } : {});
      shouldForceInitialFetch = true;
    }

    // Auto-fetch only for the first pending attempt, explicit invalidation,
    // or stale successful data. This avoids infinite loops after aborts/errors.
    const shouldAutoFetch =
      state?.fetchStatus !== 'fetching' &&
      (state === undefined ||
        (state.status === 'pending' && !hasInitiatedFetch.current) ||
        state.isInvalidated ||
        (state.data !== undefined && cache.isStale(queryKey) && !hasInitiatedFetch.current) ||
        shouldForceInitialFetch);

    if (shouldAutoFetch) {
      hasInitiatedFetch.current = true;
      void fetchData(shouldForceInitialFetch);
    }
  }, [
    enabled,
    initialData,
    state,
    state?.data,
    state?.fetchStatus,
    cache,
    queryKey,
    staleTime,
    fetchData,
  ]);

  useEffect(() => {
    return (): void => {
      abortController.current?.abort();
      abortController.current = null;
    };
  }, []);

  // Derive computed values
  // Use explicit undefined check to allow null values from queryFn
  // Only fall back to placeholderData when data is undefined, not when it's null
  const resolvedData = state?.data;
  const data = resolvedData ?? placeholderData;
  const dataWithNull = (resolvedData === null ? null : data) as TData | undefined;
  const error = (state?.error as TError | null) ?? null;
  const status = state?.status ?? 'pending';
  const fetchStatus = state?.fetchStatus ?? 'idle';

  const isLoading = status === 'pending' && fetchStatus === 'fetching';
  const isFetching = fetchStatus === 'fetching';
  const isError = status === 'error';
  const isSuccess = status === 'success';
  const isPending = status === 'pending';
  const isStale = cache.isStale(queryKey);

  return {
    data: dataWithNull,
    error,
    isLoading,
    isFetching,
    isError,
    isSuccess,
    isPending,
    isStale,
    refetch,
    status,
    fetchStatus,
  };
}
