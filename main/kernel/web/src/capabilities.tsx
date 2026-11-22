// main/kernel/web/src/capabilities.tsx
import {
  deserializeCapabilityContext,
  evaluateAuth,
  evaluateRequirement,
  type Auth,
  type CapabilityContext,
  type Requirement,
} from '@bslt/contract';
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

import type { Transport } from '@bslt/client-engine';

const EMPTY_MODULES: ReadonlySet<string> = new Set<string>();
const EMPTY_FLAGS: Readonly<Record<string, boolean>> = Object.freeze({});
const EMPTY_ENTITLEMENTS: ReadonlySet<string> = new Set<string>();
const EMPTY_ELIGIBILITY: CapabilityContext['eligibility'] = Object.freeze({
  tosAccepted: false,
  emailVerified: false,
  ageVerifiedFor: null,
  jurisdiction: null,
});
const EMPTY_ACTING_AS: CapabilityContext['actingAs'] = Object.freeze({ kind: 'user' });
const EMPTY_AUTH_STRATEGIES: readonly string[] = Object.freeze([]);

/**
 * Anonymous, fail-closed capability snapshot used before `/api/platform/context`
 * resolves, during viewer transitions, on fetch/parse failures, and during SSR.
 */
export const EMPTY_CAPABILITY_CONTEXT: CapabilityContext = Object.freeze({
  modules: EMPTY_MODULES,
  flags: EMPTY_FLAGS,
  entitlements: EMPTY_ENTITLEMENTS,
  eligibility: EMPTY_ELIGIBILITY,
  viewer: null,
  actingAs: EMPTY_ACTING_AS,
  maxAudience: 0,
  authStrategies: EMPTY_AUTH_STRATEGIES,
});

/**
 * - `'loading'`: the context is not yet the current viewer's (a request in
 *   flight, or the host's viewer still pending). It is EMPTY, and nothing may be
 *   decided from it: a guard that has to know waits.
 * - `'ready'`: the current viewer's context.
 * - `'error'`: the request failed; the context is EMPTY, which denies. Settled.
 * - `'idle'`: no provider or no transport. Settled.
 */
export type CapabilityLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Same budget as the boot's session restore and splash failsafe. */
const CONTEXT_REQUEST_TIMEOUT_MS = 5_000;

export interface CapabilityTarget {
  readonly auth?: Auth | undefined;
  readonly requires?: readonly Requirement[] | undefined;
}

/**
 * Isomorphic client guard evaluation delegating to `@bslt/contract`'s
 * `evaluateAuth` + `evaluateRequirement` (identical to the server module host).
 */
export function canAccessCapability(
  target: CapabilityTarget,
  ctx: CapabilityContext,
  orgBitLookup?: (permission: string) => number | undefined,
): boolean {
  const authResult = evaluateAuth(target.auth ?? 'public', ctx.viewer, orgBitLookup);
  if (!authResult.ok) {
    return false;
  }
  if (target.requires !== undefined) {
    for (const req of target.requires) {
      if (!evaluateRequirement(req, ctx).ok) {
        return false;
      }
    }
  }
  return true;
}

export interface CapabilitiesValue {
  readonly context: CapabilityContext;
  readonly status: CapabilityLoadStatus;
  readonly hasModule: (moduleId: string) => boolean;
  readonly isFlagEnabled: (flagKey: string) => boolean;
  readonly hasAuthStrategy: (strategy: string) => boolean;
  readonly canAccess: (target: CapabilityTarget) => boolean;
  /**
   * Refetches the current viewer's context. It drops to EMPTY/`'loading'`
   * meanwhile, which unmounts gated pages: before it gets a caller, it must keep
   * the snapshot while it refetches.
   */
  readonly refresh: () => Promise<void>;
}

const DEFAULT_CAPABILITIES_VALUE: CapabilitiesValue = Object.freeze({
  context: EMPTY_CAPABILITY_CONTEXT,
  status: 'idle',
  hasModule: () => false,
  isFlagEnabled: () => false,
  hasAuthStrategy: () => false,
  canAccess: (target: CapabilityTarget) => canAccessCapability(target, EMPTY_CAPABILITY_CONTEXT),
  refresh: () => Promise.resolve(),
});

const CapabilitiesReactContext = createContext<CapabilitiesValue>(DEFAULT_CAPABILITIES_VALUE);

export interface CapabilityProviderProps {
  readonly transport?: Transport | undefined;
  /** The viewer's user id, null when anonymous. A context for another viewer is refused. */
  readonly viewerKey?: string | null | undefined;
  /**
   * True while the host knows a viewer is on its way that `viewerKey` does not
   * name yet (a session initialising or hydrating). The provider then reports
   * EMPTY/`'loading'`, keeping its snapshot and without refetching.
   */
  readonly viewerPending?: boolean | undefined;
  readonly initialContext?: CapabilityContext | undefined;
  readonly orgBitLookup?: ((permission: string) => number | undefined) | undefined;
  readonly children?: ReactNode;
}

interface SnapshotState {
  readonly forViewerKey: string | null;
  readonly context: CapabilityContext;
  readonly status: CapabilityLoadStatus;
}

/**
 * One `/api/platform/context` request for `viewerKey`, aborted when it does not
 * answer in time. An answer for another viewer is an error, not that viewer's
 * context: a session whose token refresh failed asks anonymously while the host
 * already names the user.
 */
async function requestContext(
  transport: Transport,
  viewerKey: string | null,
): Promise<CapabilityContext> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, CONTEXT_REQUEST_TIMEOUT_MS);
  try {
    const context = deserializeCapabilityContext(
      await transport.request('/api/platform/context', {
        method: 'GET',
        rawApiPath: true,
        signal: controller.signal,
      }),
    );
    if ((context.viewer?.userId ?? null) !== viewerKey) {
      throw new Error('The capability context answered for another viewer');
    }
    return context;
  } finally {
    clearTimeout(timeout);
  }
}

export function CapabilityProvider({
  transport,
  viewerKey,
  viewerPending,
  initialContext,
  orgBitLookup,
  children,
}: CapabilityProviderProps): ReactElement {
  const normalizedViewerKey = viewerKey ?? null;
  const initialViewerKeyRef = useRef<string | null>(normalizedViewerKey);
  const skipFirstFetchRef = useRef<boolean>(initialContext !== undefined);
  const requestIdRef = useRef<number>(0);
  const mountedRef = useRef<boolean>(true);

  const [snapshot, setSnapshot] = useState<SnapshotState>(() => {
    if (initialContext !== undefined) {
      return {
        forViewerKey: normalizedViewerKey,
        context: initialContext,
        status: 'ready',
      };
    }
    return {
      forViewerKey: normalizedViewerKey,
      context: EMPTY_CAPABILITY_CONTEXT,
      status: transport !== undefined ? 'loading' : 'idle',
    };
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, []);

  const fetchContext = useCallback(
    async (targetViewerKey: string | null): Promise<void> => {
      if (transport === undefined) {
        return;
      }
      requestIdRef.current += 1;
      const reqId = requestIdRef.current;

      setSnapshot((prev) =>
        prev.forViewerKey === targetViewerKey && prev.status === 'loading'
          ? prev
          : {
              forViewerKey: targetViewerKey,
              context: EMPTY_CAPABILITY_CONTEXT,
              status: 'loading',
            },
      );

      try {
        // One retry: 'error' lasts until the viewer changes, so a single dropped
        // request would otherwise cost the whole session its context.
        const attempt = (): Promise<CapabilityContext> =>
          requestContext(transport, targetViewerKey);
        const parsed = await attempt().catch(attempt);
        if (!mountedRef.current || requestIdRef.current !== reqId) {
          return;
        }
        setSnapshot({
          forViewerKey: targetViewerKey,
          context: parsed,
          status: 'ready',
        });
      } catch {
        if (!mountedRef.current || requestIdRef.current !== reqId) {
          return;
        }
        setSnapshot({
          forViewerKey: targetViewerKey,
          context: EMPTY_CAPABILITY_CONTEXT,
          status: 'error',
        });
      }
    },
    [transport],
  );

  useEffect(() => {
    if (transport === undefined) {
      return;
    }
    if (skipFirstFetchRef.current && normalizedViewerKey === initialViewerKeyRef.current) {
      skipFirstFetchRef.current = false;
      return;
    }
    skipFirstFetchRef.current = false;
    void fetchContext(normalizedViewerKey);
  }, [transport, normalizedViewerKey, fetchContext]);

  const isStaleViewer = viewerPending === true || snapshot.forViewerKey !== normalizedViewerKey;
  const activeContext = isStaleViewer ? EMPTY_CAPABILITY_CONTEXT : snapshot.context;
  const activeStatus: CapabilityLoadStatus = isStaleViewer
    ? transport !== undefined
      ? 'loading'
      : 'idle'
    : snapshot.status;

  const refresh = useCallback(async (): Promise<void> => {
    await fetchContext(normalizedViewerKey);
  }, [fetchContext, normalizedViewerKey]);

  const value = useMemo<CapabilitiesValue>(
    () => ({
      context: activeContext,
      status: activeStatus,
      hasModule: (moduleId: string) => activeContext.modules.has(moduleId),
      isFlagEnabled: (flagKey: string) => activeContext.flags[flagKey] === true,
      hasAuthStrategy: (strategy: string) => activeContext.authStrategies.includes(strategy),
      canAccess: (target: CapabilityTarget) =>
        canAccessCapability(target, activeContext, orgBitLookup),
      refresh,
    }),
    [activeContext, activeStatus, orgBitLookup, refresh],
  );

  return createElement(CapabilitiesReactContext.Provider, { value }, children);
}

export function useCapabilities(): CapabilitiesValue {
  return useContext(CapabilitiesReactContext);
}
