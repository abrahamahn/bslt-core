// main/apps/web/src/app/ClientEnvironment.test.tsx
import { useTransport } from '@bslt/react';
import { useCapabilities } from '@bslt/web-platform';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ClientEnvironmentProvider, useClientEnvironment } from './ClientEnvironment';

import type { ClientEnvironment } from './ClientEnvironment';
import type { JSX } from 'react';

// ============================================================================
// Test Helpers
// ============================================================================

function createMockClientEnvironment(): ClientEnvironment {
  return {
    config: {
      apiUrl: 'http://test-api.example.com',
      tokenRefreshInterval: 60000,
    } as ClientEnvironment['config'],
    queryCache: {
      getQueryData: vi.fn(),
      setQueryData: vi.fn(),
      getQueryState: vi.fn(),
      invalidateQueries: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
      getAll: vi.fn(() => []),
    } as unknown as ClientEnvironment['queryCache'],
    auth: {
      getState: vi.fn(() => ({
        user: null,
        isLoading: false,
        isAuthenticated: false,
      })),
      subscribe: vi.fn(() => () => {}),
      login: vi.fn(),
      logout: vi.fn(),
      destroy: vi.fn(),
    } as unknown as ClientEnvironment['auth'],
  };
}

// Test component that uses the hook
const TestConsumer = (): JSX.Element => {
  const env = useClientEnvironment();
  return (
    <div>
      <span data-testid="api-url">{env.config.apiUrl}</span>
      <span data-testid="has-auth">{'yes'}</span>
      <span data-testid="has-query-cache">{'yes'}</span>
    </div>
  );
};

// ============================================================================
// Tests
// ============================================================================

describe('ClientEnvironment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ClientEnvironmentProvider', () => {
    it('should provide environment to children', () => {
      const mockEnv = createMockClientEnvironment();

      render(
        <ClientEnvironmentProvider value={mockEnv}>
          <TestConsumer />
        </ClientEnvironmentProvider>,
      );

      expect(screen.getByTestId('api-url')).toHaveTextContent('http://test-api.example.com');
      expect(screen.getByTestId('has-auth')).toHaveTextContent('yes');
      expect(screen.getByTestId('has-query-cache')).toHaveTextContent('yes');
    });

    it('should allow accessing config properties', () => {
      const mockEnv = createMockClientEnvironment();

      render(
        <ClientEnvironmentProvider value={mockEnv}>
          <TestConsumer />
        </ClientEnvironmentProvider>,
      );

      expect(screen.getByTestId('api-url')).toBeInTheDocument();
    });

    it('should render children correctly', () => {
      const mockEnv = createMockClientEnvironment();

      render(
        <ClientEnvironmentProvider value={mockEnv}>
          <div data-testid="child">Child Content</div>
        </ClientEnvironmentProvider>,
      );

      expect(screen.getByTestId('child')).toHaveTextContent('Child Content');
    });
  });

  describe('useClientEnvironment', () => {
    it('should return environment when inside provider', () => {
      const mockEnv = createMockClientEnvironment();

      render(
        <ClientEnvironmentProvider value={mockEnv}>
          <TestConsumer />
        </ClientEnvironmentProvider>,
      );

      // If we get here without throwing, the hook worked
      expect(screen.getByTestId('api-url')).toBeInTheDocument();
    });

    it('should throw when used outside provider', () => {
      // Suppress console.error for this test
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        render(<TestConsumer />);
      }).toThrow('useClientEnvironment must be used within ClientEnvironmentProvider');

      consoleSpy.mockRestore();
    });

    it('should provide access to auth service', () => {
      const mockEnv = createMockClientEnvironment();

      const AuthConsumer = (): JSX.Element => {
        const env = useClientEnvironment();
        return (
          <span data-testid="auth-state">
            {env.auth.getState().isAuthenticated ? 'auth' : 'anon'}
          </span>
        );
      };

      render(
        <ClientEnvironmentProvider value={mockEnv}>
          <AuthConsumer />
        </ClientEnvironmentProvider>,
      );

      expect(screen.getByTestId('auth-state')).toHaveTextContent('anon');
    });

    it('should provide access to query cache', () => {
      const mockEnv = createMockClientEnvironment();

      const QueryCacheConsumer = (): JSX.Element => {
        const env = useClientEnvironment();
        const hasQueryCache = typeof env.queryCache.getQueryData === 'function';
        return <span data-testid="has-methods">{hasQueryCache ? 'yes' : 'no'}</span>;
      };

      render(
        <ClientEnvironmentProvider value={mockEnv}>
          <QueryCacheConsumer />
        </ClientEnvironmentProvider>,
      );

      expect(screen.getByTestId('has-methods')).toHaveTextContent('yes');
    });
  });

  describe('ClientEnvironment type', () => {
    it('should have all required properties', () => {
      const mockEnv = createMockClientEnvironment();

      // Type check - environment should have these properties
      expect(mockEnv.config).toBeDefined();
      expect(mockEnv.queryCache).toBeDefined();
      expect(mockEnv.auth).toBeDefined();
    });

    it('should have correct config shape', () => {
      const mockEnv = createMockClientEnvironment();

      expect(mockEnv.config.apiUrl).toBeDefined();
      expect(typeof mockEnv.config.apiUrl).toBe('string');
    });
  });

  describe('TransportProvider integration', () => {
    it('provides a Transport instance to descendants via useTransport and throws outside provider', () => {
      const TransportConsumer = (): JSX.Element => {
        const transport = useTransport();
        return <span data-testid="has-transport">{typeof transport.request}</span>;
      };

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(() => {
        render(<TransportConsumer />);
      }).toThrow('useTransport must be used within TransportProvider');
      consoleSpy.mockRestore();

      const mockEnv = createMockClientEnvironment();
      render(
        <ClientEnvironmentProvider value={mockEnv}>
          <TransportConsumer />
        </ClientEnvironmentProvider>,
      );

      expect(screen.getByTestId('has-transport')).toHaveTextContent('function');
    });
  });

  describe('CapabilityProvider integration', () => {
    it('fails closed when /api/platform/context fetch rejects in live mode', async () => {
      const CapsConsumer = (): JSX.Element => {
        const caps = useCapabilities();
        return (
          <span data-testid="caps-state">
            {`${caps.status}:${String(caps.isFlagEnabled('flags.billing'))}`}
          </span>
        );
      };

      const failingTransport = {
        request: vi.fn().mockRejectedValue(new Error('network unavailable')),
      };
      const liveEnv: ClientEnvironment = {
        ...createMockClientEnvironment(),
        config: {
          ...createMockClientEnvironment().config,
          mode: 'development',
        },
        transport: failingTransport as unknown as NonNullable<ClientEnvironment['transport']>,
      };

      render(
        <ClientEnvironmentProvider value={liveEnv}>
          <CapsConsumer />
        </ClientEnvironmentProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('caps-state')).toHaveTextContent('error:false');
      });
      expect(failingTransport.request).toHaveBeenCalledWith('/api/platform/context', {
        method: 'GET',
        rawApiPath: true,
        signal: expect.any(AbortSignal),
      });
      // One retry before the provider settles on the error.
      expect(failingTransport.request).toHaveBeenCalledTimes(2);
    });

    describe('the viewer the context is fetched for', () => {
      interface AuthSnapshot {
        readonly user: { readonly id: string } | null;
        readonly isLoading: boolean;
        readonly isAuthenticated: boolean;
      }

      /** The wire context the server answers, for the viewer whose id is given. */
      const wireContext = (
        billing: boolean,
        userId: string | null = null,
      ): Record<string, unknown> => ({
        modules: [],
        flags: { 'flags.billing': billing },
        entitlements: [],
        eligibility: {
          tosAccepted: false,
          emailVerified: false,
          ageVerifiedFor: null,
          jurisdiction: null,
        },
        viewer: userId === null ? null : { userId, role: 'user' },
        actingAs: { kind: 'user' },
        maxAudience: 0,
        authStrategies: [],
      });

      const CapsConsumer = (): JSX.Element => {
        const caps = useCapabilities();
        return (
          <span data-testid="caps-state">
            {`${caps.status}:${String(caps.isFlagEnabled('flags.billing'))}`}
          </span>
        );
      };

      const signedOut: AuthSnapshot = { user: null, isLoading: false, isAuthenticated: false };

      /** An auth service whose state the test moves, as login and hydration do. */
      function renderWithAuth(
        request: ReturnType<typeof vi.fn>,
        initial: AuthSnapshot = signedOut,
      ): (next: AuthSnapshot) => void {
        let state = initial;
        const listeners = new Set<() => void>();
        const base = createMockClientEnvironment();
        const env: ClientEnvironment = {
          ...base,
          config: { ...base.config, mode: 'development' },
          auth: {
            getState: () => state,
            subscribe: (listener: () => void) => {
              listeners.add(listener);
              return () => listeners.delete(listener);
            },
          } as unknown as ClientEnvironment['auth'],
          transport: { request } as unknown as NonNullable<ClientEnvironment['transport']>,
        };

        render(
          <ClientEnvironmentProvider value={env}>
            <CapsConsumer />
          </ClientEnvironmentProvider>,
        );

        return (next) => {
          state = next;
          act(() => {
            listeners.forEach((listener) => {
              listener();
            });
          });
        };
      }

      const hydrating: AuthSnapshot = {
        user: { id: 'u1' },
        isLoading: true,
        isAuthenticated: true,
      };
      const hydrated: AuthSnapshot = { ...hydrating, isLoading: false };

      it('waits for the session to hydrate, so the request carries the access token', async () => {
        const request = vi
          .fn()
          .mockResolvedValueOnce(wireContext(false))
          .mockResolvedValueOnce(wireContext(true, 'u1'));
        const setAuth = renderWithAuth(request);

        await waitFor(() => {
          expect(screen.getByTestId('caps-state')).toHaveTextContent('ready:false');
        });
        expect(request).toHaveBeenCalledTimes(1);

        // Login names the user before the token refresh has given the access
        // token: a context fetched now is the anonymous one, and stays.
        setAuth(hydrating);
        expect(request).toHaveBeenCalledTimes(1);

        setAuth(hydrated);
        await waitFor(() => {
          expect(screen.getByTestId('caps-state')).toHaveTextContent('ready:true');
        });
        expect(request).toHaveBeenCalledTimes(2);
      });

      it('reports loading, not the anonymous context, while a signing-in viewer hydrates', async () => {
        const request = vi
          .fn()
          .mockResolvedValueOnce(wireContext(false))
          .mockResolvedValueOnce(wireContext(true, 'u1'));
        const setAuth = renderWithAuth(request);
        await waitFor(() => {
          expect(screen.getByTestId('caps-state')).toHaveTextContent('ready:false');
        });

        // The anonymous context is not the signing-in user's: a route decided
        // from it now would be decided for the wrong viewer.
        setAuth(hydrating);
        expect(screen.getByTestId('caps-state')).toHaveTextContent('loading:false');
        expect(request).toHaveBeenCalledTimes(1);

        setAuth(hydrated);
        await waitFor(() => {
          expect(screen.getByTestId('caps-state')).toHaveTextContent('ready:true');
        });
        expect(request).toHaveBeenCalledTimes(2);
      });

      it('reports loading while the session initializes with no user, even after the anonymous context arrived', async () => {
        let answer!: (value: unknown) => void;
        const request = vi.fn(
          () =>
            new Promise((resolve) => {
              answer = resolve;
            }),
        );
        const setAuth = renderWithAuth(request, { ...signedOut, isLoading: true });

        // Auth has not said yet whether anyone is signed in.
        await act(async () => {
          answer(wireContext(false));
        });
        expect(screen.getByTestId('caps-state')).toHaveTextContent('loading:false');

        setAuth(signedOut);
        expect(screen.getByTestId('caps-state')).toHaveTextContent('ready:false');
        expect(request).toHaveBeenCalledTimes(1);
      });

      it('keeps the signed-in context while the same viewer reloads its user', async () => {
        const request = vi
          .fn()
          .mockResolvedValueOnce(wireContext(false))
          .mockResolvedValueOnce(wireContext(true, 'u1'));
        const setAuth = renderWithAuth(request);
        setAuth(hydrated);
        await waitFor(() => {
          expect(screen.getByTestId('caps-state')).toHaveTextContent('ready:true');
        });

        setAuth(hydrating);

        expect(screen.getByTestId('caps-state')).toHaveTextContent('ready:true');
        expect(request).toHaveBeenCalledTimes(2);
      });

      it('drops to the empty, loading context at once when another viewer starts to hydrate', async () => {
        let answerAnonymous!: (value: unknown) => void;
        const request = vi
          .fn()
          .mockResolvedValueOnce(wireContext(false))
          .mockResolvedValueOnce(wireContext(true, 'u1'))
          .mockImplementation(
            () =>
              new Promise((resolve) => {
                answerAnonymous = resolve;
              }),
          );
        const setAuth = renderWithAuth(request);
        setAuth(hydrated);
        await waitFor(() => {
          expect(screen.getByTestId('caps-state')).toHaveTextContent('ready:true');
        });

        setAuth({ user: { id: 'u2' }, isLoading: true, isAuthenticated: true });
        expect(screen.getByTestId('caps-state')).toHaveTextContent('loading:false');

        // The anonymous answer that arrives meanwhile is not u2's context either.
        await act(async () => {
          answerAnonymous(wireContext(false));
        });
        expect(screen.getByTestId('caps-state')).toHaveTextContent('loading:false');
        expect(request).toHaveBeenCalledTimes(3);
      });
    });
  });
});
