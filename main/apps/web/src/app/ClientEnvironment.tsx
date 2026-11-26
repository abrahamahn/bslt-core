// main/apps/web/src/app/ClientEnvironment.tsx
/**
 * ClientEnvironment - Single context for all client-side services.
 *
 * Inspired by chet-stack pattern. Benefits:
 * - Single provider instead of nested providers
 * - Explicit dependencies in function signatures
 * - Easy to test (mock one object)
 *
 * This file contains:
 * - ClientEnvironment type definition
 * - ClientEnvironmentProvider component
 * - useClientEnvironment hook
 */

import { createTransport } from '@bslt/client-engine';
import { IdentityAuthProvider, type AuthService } from '@bslt/identity/web';
import { TransportProvider } from '@bslt/react';
import { CapabilityProvider, EMPTY_CAPABILITY_CONTEXT } from '@bslt/web-platform';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { getAccessToken } from './authToken';

import type { ClientConfig } from '#app/config';
import type { QueryCache, Transport } from '@bslt/client-engine';
import type { CapabilityContext } from '@bslt/contract';
import type { ReactElement, ReactNode } from 'react';

// ============================================================================
// Types
// ============================================================================

export type ClientEnvironment = {
  /** Application configuration */
  config: ClientConfig;

  /** Query cache for data fetching/caching */
  queryCache: QueryCache;

  /** Authentication service */
  auth: AuthService;

  /** Shared HTTP transport for contract-inferred module clients and app calls */
  transport?: Transport | undefined;

  /** Pre-resolved capability context (SSR prerendering and deterministic tests) */
  initialCapabilities?: CapabilityContext | undefined;
};

// ============================================================================
// Context
// ============================================================================

const ClientEnvironmentContext = createContext<ClientEnvironment | undefined>(undefined);

// ============================================================================
// Provider
// ============================================================================

interface AuthViewerSource {
  readonly getState?: () => {
    readonly user?: { readonly id?: string } | null;
    readonly isLoading?: boolean;
  };
}

/** The viewer the capability context is fetched for, and whether another is on its way. */
interface AuthViewer {
  readonly key: string | null;
  readonly pending: boolean;
}

const NO_VIEWER: AuthViewer = { key: null, pending: false };

/**
 * The viewer the capability context is fetched for, given the one held now.
 *
 * Login names the user before the token refresh has returned the access token.
 * A context fetched at that moment is the anonymous one, and nothing would
 * fetch it again, because the viewer id does not change afterwards. So a new
 * viewer is adopted only once its session has hydrated. The same viewer
 * reloading its user keeps its context.
 *
 * The same rule decides when the context can be trusted. While auth is still
 * loading a user it has not named, or one the key does not name yet, the
 * viewer is pending: the context held is not that viewer's, so the provider
 * reports it as loading. Returns `current` when nothing changed, so React bails out.
 */
function nextAuthViewer(auth: AuthViewerSource | undefined, current: AuthViewer): AuthViewer {
  if (typeof auth?.getState !== 'function') return NO_VIEWER;
  const { user, isLoading } = auth.getState();
  const id = user?.id ?? null;
  const key = id !== current.key && isLoading === true ? null : id;
  const pending = isLoading === true && (id === null || id !== key);
  return key === current.key && pending === current.pending ? current : { key, pending };
}

function subscribeAuthViewer(
  auth: { readonly subscribe?: (listener: () => void) => () => void } | undefined,
  listener: () => void,
): (() => void) | undefined {
  if (typeof auth?.subscribe !== 'function') return undefined;
  return auth.subscribe(listener);
}

function isTestOrUnsetMode(config: { readonly mode?: string }): boolean {
  return config.mode === 'test' || config.mode === undefined;
}

/**
 * Low-level provider for the ClientEnvironment.
 *
 * In production, use AppProvider which wraps this with other providers.
 * Use this directly in tests for fine-grained control.
 */
export const ClientEnvironmentProvider = ({
  value,
  children,
}: {
  value: ClientEnvironment;
  children?: ReactNode;
}): ReactElement => {
  const resolvedTransport = useMemo(
    () =>
      value.transport ??
      createTransport({
        baseUrl: value.config.apiUrl,
        getToken: getAccessToken,
      }),
    [value.transport, value.config.apiUrl],
  );
  const resolvedEnvironment = useMemo(
    () => (value.transport === undefined ? { ...value, transport: resolvedTransport } : value),
    [value, resolvedTransport],
  );
  const [viewer, setViewer] = useState<AuthViewer>(() => nextAuthViewer(value.auth, NO_VIEWER));

  useEffect(() => {
    const syncViewer = (): void => {
      setViewer((current) => nextAuthViewer(value.auth, current));
    };
    syncViewer();
    return subscribeAuthViewer(value.auth, syncViewer);
  }, [value.auth]);

  const initialCapabilities =
    value.initialCapabilities ??
    (isTestOrUnsetMode(value.config) ? EMPTY_CAPABILITY_CONTEXT : undefined);

  return (
    <ClientEnvironmentContext.Provider value={resolvedEnvironment}>
      <TransportProvider transport={resolvedTransport}>
        <IdentityAuthProvider auth={resolvedEnvironment.auth}>
          <CapabilityProvider
            transport={resolvedTransport}
            viewerKey={viewer.key}
            viewerPending={viewer.pending}
            initialContext={initialCapabilities}
          >
            {children}
          </CapabilityProvider>
        </IdentityAuthProvider>
      </TransportProvider>
    </ClientEnvironmentContext.Provider>
  );
};

// ============================================================================
// Hook
// ============================================================================

/**
 * Access the ClientEnvironment from any component.
 * Must be used within ClientEnvironmentProvider (or AppProvider).
 */
export function useClientEnvironment(): ClientEnvironment {
  const env = useContext(ClientEnvironmentContext);
  if (env === undefined) {
    throw new Error('useClientEnvironment must be used within ClientEnvironmentProvider');
  }
  return env;
}

/**
 * Optional variant of `useClientEnvironment` for shared widgets rendered both
 * inside full app providers and standalone unit tests.
 */
export function useOptionalClientEnvironment(): ClientEnvironment | undefined {
  return useContext(ClientEnvironmentContext);
}
