// main/apps/web/src/app/App.test.tsx
/**
 * Unit tests for App component.
 *
 * These tests verify the App component renders correctly.
 * Tests focus on structural elements that can be reliably tested.
 *
 * Uses the test utilities from __tests__/utils.tsx which properly
 * handle providers without vi.mock deadlocks.
 *
 * @complexity O(1) - All tests are unit tests with mocked dependencies
 */

import { serializeCapabilityContext } from '@bslt/contract';
import { BrowserRouter } from '@bslt/react/router';
import { EMPTY_CAPABILITY_CONTEXT } from '@bslt/web-platform';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockEnvironment, mockUser } from '../__tests__/utils';
import { App, RouteLoadingFallback } from '../app/App'; // Import App component
import { ROUTE_PENDING_ATTRIBUTE } from '../bootstrap/splash';
import { hasBillingModule, hasOrgsModule } from '../generated/modules';
import { reportError } from '../lib/errorReporter';

import type { ClientEnvironment } from './ClientEnvironment';
import type { User } from '@bslt/identity/contract';

// A render fault injected through a real child of the root ErrorBoundary.
const renderFault = vi.hoisted(() => ({ error: null as Error | null }));

vi.mock('../lib/errorReporter', () => ({ reportError: vi.fn(() => true) }));

vi.mock('./components', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./components')>();
  const { createElement } = await import('react');
  return {
    ...actual,
    NetworkStatus: (): ReturnType<typeof actual.NetworkStatus> => {
      if (renderFault.error !== null) throw renderFault.error;
      return createElement(actual.NetworkStatus);
    },
  };
});

// ============================================================================
// Tests
// ============================================================================

describe('App', () => {
  let mockEnvironment: ClientEnvironment;

  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
    mockEnvironment = createMockEnvironment();
  });

  describe('Basic Rendering', () => {
    it('should render without crashing', async () => {
      expect(() => {
        render(<App environment={mockEnvironment} />);
      }).not.toThrow();

      // Wait for async effects to settle
      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
      });
    });

    it('should render the page content', async () => {
      render(<App environment={mockEnvironment} />);

      await waitFor(() => {
        // HomePage renders the configured app name heading
        expect(screen.getAllByText('Your App').length).toBeGreaterThanOrEqual(1);
      });
    });

    it('should render navigation links', async () => {
      render(<App environment={mockEnvironment} />);

      await waitFor(() => {
        // Left menu renders public navigation links when unauthenticated
        expect(document.querySelector('a[href="/"]')).toBeInTheDocument();
        expect(document.querySelector('a[href="/clean?doc=readme"]')).toBeInTheDocument();
        expect(document.querySelector('a[href="/pricing"]')).not.toBeInTheDocument();
        expect(document.querySelector('a[href="/ui-library"]')).toBeInTheDocument();
        expect(document.querySelector('a[href="/developer/api-routes"]')).toBeInTheDocument();
      });
    });
  });

  describe('Render errors', () => {
    afterEach(() => {
      renderFault.error = null;
    });

    it('hands a render error to the reporter once and shows the root fallback', async () => {
      const boom = new Error('render exploded');
      renderFault.error = boom;
      // React logs every error a boundary catches.
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        render(<App environment={mockEnvironment} />);

        expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
        expect(reportError).toHaveBeenCalledTimes(1);
        expect(reportError).toHaveBeenCalledWith(boom, 'render');
      } finally {
        consoleError.mockRestore();
      }
    });
  });

  describe('Route Loading Fallback', () => {
    it('carries the attribute the boot splash waits on', () => {
      // The splash holds until the first route's chunk is on screen, and it decides
      // that by looking for this attribute (src/bootstrap/splash.ts). If the marker
      // is dropped from the fallback, the splash reveals onto this spinner instead
      // of onto the app — it hands off to another loading state. Nothing else in the
      // app reads it, so only this test can catch that.
      const { container } = render(<RouteLoadingFallback />);

      expect(container.querySelector(`[${ROUTE_PENDING_ATTRIBUTE}]`)).toBeInTheDocument();
    });
  });

  describe('Route Rendering', () => {
    it('should render content on root route', async () => {
      window.history.replaceState({}, '', '/');
      render(<App environment={mockEnvironment} />);

      // Verify the app renders content - the HomePage renders the configured app name heading
      await waitFor(() => {
        expect(screen.getAllByText('Your App').length).toBeGreaterThanOrEqual(1);
      });
    });

    it('should render auth buttons in top bar', async () => {
      render(<App environment={mockEnvironment} />);

      await waitFor(() => {
        // HomePage top bar renders Login and Register buttons when not authenticated
        expect(screen.getByRole('button', { name: 'Login' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Register' })).toBeInTheDocument();
      });
    });
  });

  describe('Query Persistence', () => {
    it('should render immediately without blocking', async () => {
      render(<App environment={mockEnvironment} />);

      // App renders immediately without waiting for cache restoration
      await waitFor(() => {
        expect(screen.getAllByText('Your App').length).toBeGreaterThanOrEqual(1);
      });
    });

    it('should have query cache available', async () => {
      render(<App environment={mockEnvironment} />);

      await waitFor(() => {
        expect(screen.getAllByText('Your App').length).toBeGreaterThanOrEqual(1);
      });

      // Verify queryCache is available in environment
      expect(mockEnvironment.queryCache).toBeDefined();
      expect(mockEnvironment.queryCache.getAll).toBeDefined();
    });
  });

  describe('Command Palette Auth Gate', () => {
    it('keeps the command palette hidden when signed out even on Ctrl+K', async () => {
      render(<App environment={mockEnvironment} />);

      await waitFor(() => {
        expect(screen.getAllByText('Your App').length).toBeGreaterThanOrEqual(1);
      });

      fireEvent.keyDown(window, { key: 'K', ctrlKey: true });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  describe('flag-gated deep links', () => {
    interface AuthSnapshot {
      readonly user: User | null;
      readonly isLoading: boolean;
    }

    const signedOut: AuthSnapshot = { user: null, isLoading: false };
    const hydrating: AuthSnapshot = { user: mockUser, isLoading: true };
    const hydrated: AuthSnapshot = { user: mockUser, isLoading: false };

    afterEach(async () => {
      // These tests navigate, and LiveRegion sets the route announcement 50 ms
      // later without clearing that timer on unmount. Let it fire while the
      // test environment is still up, so a file that ends right after a
      // navigation cannot set state once jsdom is gone.
      await act(() => new Promise((resolve) => setTimeout(resolve, 60)));
    });

    /**
     * The app in a live mode at `url`, with an auth service the test moves and a
     * transport that answers `/api/platform/context` only when the test says so.
     */
    function renderLiveApp(
      url: string,
      initial: AuthSnapshot,
    ): {
      readonly setAuth: (next: AuthSnapshot) => void;
      readonly answerContext: (
        flags: Record<string, boolean>,
        viewer: User | null,
      ) => Promise<void>;
      readonly failContext: () => Promise<void>;
    } {
      let state = initial;
      const listeners = new Set<() => void>();
      const waiting: Array<{
        readonly resolve: (value: unknown) => void;
        readonly reject: (reason: Error) => void;
      }> = [];
      const base = createMockEnvironment({ config: { mode: 'development' } });
      const request = vi.fn((path: string) =>
        path === '/api/platform/context'
          ? new Promise((resolve, reject) => {
              waiting.push({ resolve, reject });
            })
          : Promise.reject(new Error(`No answer for ${path}`)),
      );
      const nextRequest = (): (typeof waiting)[number] => {
        const next = waiting.shift();
        if (next === undefined) throw new Error('No context request is waiting');
        return next;
      };
      const environment: ClientEnvironment = {
        ...base,
        auth: {
          ...base.auth,
          getState: () => ({
            ...base.auth.getState(),
            user: state.user,
            isLoading: state.isLoading,
            isAuthenticated: state.user !== null,
          }),
          subscribe: (listener: () => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        },
        transport: { request } as unknown as NonNullable<ClientEnvironment['transport']>,
      };

      // The router keeps its location in a singleton that follows the URL only
      // while a router is mounted, so move it there first.
      const { unmount } = render(<BrowserRouter />);
      act(() => {
        window.history.replaceState({}, '', url);
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      unmount();
      render(<App environment={environment} />);

      return {
        setAuth: (next) => {
          state = next;
          act(() => {
            listeners.forEach((listener) => {
              listener();
            });
          });
        },
        answerContext: async (flags, viewer) => {
          const { resolve } = nextRequest();
          await act(async () => {
            resolve(
              serializeCapabilityContext({
                ...EMPTY_CAPABILITY_CONTEXT,
                flags,
                viewer: viewer === null ? null : { userId: viewer.id, role: viewer.role },
              }),
            );
          });
        },
        failContext: async () => {
          const { reject } = nextRequest();
          await act(async () => {
            reject(new Error('Context unavailable'));
          });
        },
      };
    }

    const isHeld = (): boolean =>
      document.querySelector(`[${ROUTE_PENDING_ATTRIBUTE}]`) !== null &&
      screen.queryByText('Page not found') === null;

    const waitForBillingPage = async (): Promise<void> => {
      // The page's chunk loads lazily once the route resolves.
      expect(
        await screen.findByRole('heading', { name: 'Billing Settings' }, { timeout: 5_000 }),
      ).toBeInTheDocument();
      expect(document.querySelector(`[${ROUTE_PENDING_ATTRIBUTE}]`)).toBeNull();
    };

    it('holds flag-gated Core route /settings/accounts while context loads and shows NotFound when advanced auth is off', async () => {
      const app = renderLiveApp('/settings/accounts', signedOut);
      expect(isHeld()).toBe(true);

      await app.answerContext({}, null);
      await waitFor(() => {
        expect(`${window.location.pathname}${window.location.search}`).toBe(
          '/login?returnTo=%2Fsettings%2Faccounts',
        );
      });
    });

    it.runIf(hasBillingModule)(
      "keeps /settings/billing while the signed-in viewer's session hydrates",
      async () => {
        const app = renderLiveApp('/settings/billing', hydrating);

        // The anonymous context is not the hydrating user's: billing off says nothing.
        await app.answerContext({ 'flags.billing': false }, null);
        expect(window.location.pathname).toBe('/settings/billing');
        expect(isHeld()).toBe(true);

        app.setAuth(hydrated);
        await app.answerContext({ 'flags.billing': true }, mockUser);
        await waitForBillingPage();
        expect(window.location.pathname).toBe('/settings/billing');
      },
    );

    it.runIf(hasBillingModule)(
      'sends /settings/billing to /settings once the viewer settles with billing off',
      async () => {
        const app = renderLiveApp('/settings/billing', hydrating);
        // Billing is on for everyone, and off for this user (an org override).
        await app.answerContext({ 'flags.billing': true }, null);

        app.setAuth(hydrated);
        await app.answerContext({ 'flags.billing': false }, mockUser);

        await waitFor(() => {
          expect(window.location.pathname).toBe('/settings');
        });
      },
    );

    it.runIf(hasBillingModule)('lands on returnTo=/settings/billing after sign-in', async () => {
      const app = renderLiveApp('/login?returnTo=%2Fsettings%2Fbilling', signedOut);
      await app.answerContext({ 'flags.billing': false }, null);

      // Password login names the user before its session has hydrated, and the
      // login route sends it to returnTo in that same render.
      app.setAuth(hydrating);
      expect(window.location.pathname).toBe('/settings/billing');
      expect(isHeld()).toBe(true);

      app.setAuth(hydrated);
      await app.answerContext({ 'flags.billing': true }, mockUser);
      await waitForBillingPage();
      expect(window.location.pathname).toBe('/settings/billing');
    });

    it.runIf(hasOrgsModule)(
      'a signed-out visitor at /organization waits for the context',
      async () => {
        const app = renderLiveApp('/organization', signedOut);
        expect(isHeld()).toBe(true);

        await app.answerContext({ 'orgs.teams': false }, null);
        expect(await screen.findByText('Page not found')).toBeInTheDocument();
        expect(window.location.pathname).toBe('/organization');
      },
    );

    it.runIf(hasOrgsModule)(
      'sends a signed-out visitor at /organization to the login once teams are on',
      async () => {
        const app = renderLiveApp('/organization', signedOut);
        expect(isHeld()).toBe(true);

        await app.answerContext({ 'orgs.teams': true }, null);
        await waitFor(() => {
          expect(`${window.location.pathname}${window.location.search}`).toBe(
            '/login?returnTo=%2Forganization',
          );
        });
      },
    );

    it.runIf(hasBillingModule)(
      "sends /settings/billing to /settings once the signed-in viewer's context has failed",
      async () => {
        const app = renderLiveApp('/settings/billing', hydrated);
        expect(isHeld()).toBe(true);

        // Both attempts fail: 'error' is settled, and its EMPTY context denies.
        await app.failContext();
        await app.failContext();
        await waitFor(() => {
          expect(window.location.pathname).toBe('/settings');
        });
      },
    );

    it.runIf(hasOrgsModule)(
      'shows NotFound at /organization once the context has failed',
      async () => {
        const app = renderLiveApp('/organization', signedOut);
        expect(isHeld()).toBe(true);

        await app.failContext();
        await app.failContext();
        expect(await screen.findByText('Page not found')).toBeInTheDocument();
        expect(document.querySelector(`[${ROUTE_PENDING_ATTRIBUTE}]`)).toBeNull();
        expect(window.location.pathname).toBe('/organization');
      },
    );

    it('does not hold the landing page while the context loads', async () => {
      renderLiveApp('/', signedOut);

      expect(await screen.findByText(/A small, production-ready SaaS shell/u)).toBeInTheDocument();
      expect(document.querySelector(`[${ROUTE_PENDING_ATTRIBUTE}]`)).toBeNull();
    });

    it('posts CLEAR_CACHE to the active Service Worker controller when signing out', async () => {
      const postMessage = vi.fn();
      const originalDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'serviceWorker');
      Object.defineProperty(window.navigator, 'serviceWorker', {
        configurable: true,
        value: { controller: { postMessage } },
      });

      try {
        const app = renderLiveApp('/', hydrated);
        await app.answerContext({}, mockUser);
        expect(postMessage).not.toHaveBeenCalled();

        // Transition from signed-in user to signed-out must purge SW caches
        app.setAuth(signedOut);
        await app.answerContext({}, null);

        expect(postMessage).toHaveBeenCalledWith({ type: 'CLEAR_CACHE' });
      } finally {
        if (originalDescriptor !== undefined) {
          Object.defineProperty(window.navigator, 'serviceWorker', originalDescriptor);
        } else {
          delete (window.navigator as { serviceWorker?: unknown }).serviceWorker;
        }
      }
    });
  });
});
