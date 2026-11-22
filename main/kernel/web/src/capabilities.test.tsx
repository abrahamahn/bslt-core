// main/kernel/web/src/capabilities.test.tsx
import {
  mergeCapabilityContributions,
  serializeCapabilityContext,
  type CapabilityContext,
} from '@bslt/contract';
import { act, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  canAccessCapability,
  CapabilityProvider,
  EMPTY_CAPABILITY_CONTEXT,
  useCapabilities,
  type CapabilitiesValue,
  type CapabilityLoadStatus,
  type CapabilityProviderProps,
  type CapabilityTarget,
} from './index';

import type { Transport, TransportRequestOptions } from '@bslt/client-engine';

function buildContext(overrides?: {
  modules?: readonly string[];
  flags?: Readonly<Record<string, boolean>>;
  entitlements?: readonly string[];
  tosAccepted?: boolean;
  emailVerified?: boolean;
  ageVerifiedFor?: number | null;
  viewer?: CapabilityContext['viewer'];
  authStrategies?: readonly string[];
}): CapabilityContext {
  return mergeCapabilityContributions({
    modules: (overrides?.modules ?? ['flags', 'tasks']).map((id) => ({ id })),
    viewer: overrides?.viewer ?? null,
    contributions: [
      {
        flags: overrides?.flags ?? {},
        entitlements: overrides?.entitlements ?? [],
        eligibility: {
          tosAccepted: overrides?.tosAccepted ?? false,
          emailVerified: overrides?.emailVerified ?? false,
          ageVerifiedFor: overrides?.ageVerifiedFor ?? null,
          jurisdiction: null,
        },
        authStrategies: overrides?.authStrategies ?? ['password'],
      },
    ],
  });
}

function Probe(): ReactElement {
  const caps = useCapabilities();
  return createElement(
    'div',
    null,
    createElement('span', { 'data-testid': 'status' }, caps.status),
    createElement('span', { 'data-testid': 'viewer' }, caps.context.viewer?.userId ?? 'anon'),
    createElement('span', { 'data-testid': 'has-tasks' }, String(caps.hasModule('tasks'))),
    createElement(
      'span',
      { 'data-testid': 'flag-billing' },
      String(caps.isFlagEnabled('billing.enabled')),
    ),
    createElement('span', { 'data-testid': 'auth-magic' }, String(caps.hasAuthStrategy('magic'))),
    createElement(
      'span',
      { 'data-testid': 'can-admin' },
      String(caps.canAccess({ auth: 'admin' })),
    ),
    createElement(
      'span',
      { 'data-testid': 'can-org-manage' },
      String(caps.canAccess({ auth: { org: 'orgs.manage' } })),
    ),
  );
}

/** A transport request the test answers or fails by hand. */
interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: Error) => void;
}

describe('EMPTY_CAPABILITY_CONTEXT and canAccessCapability', () => {
  it('exposes typed CapabilityLoadStatus, CapabilityTarget, CapabilitiesValue, and CapabilityProviderProps contracts', () => {
    const idleStatus: CapabilityLoadStatus = 'idle';
    const target: CapabilityTarget = { auth: 'public' };
    const props: CapabilityProviderProps = { children: createElement('div') };
    let captured: CapabilitiesValue | null = null;
    function Probe(): ReactElement {
      captured = useCapabilities();
      return createElement('span', null, captured.status);
    }
    render(createElement(CapabilityProvider, props, createElement(Probe)));
    expect(idleStatus).toBe('idle');
    expect(canAccessCapability(target, EMPTY_CAPABILITY_CONTEXT)).toBe(true);
    expect(captured).not.toBeNull();
  });

  it('fails closed across protected auth levels and requirements on EMPTY_CAPABILITY_CONTEXT', () => {
    expect(EMPTY_CAPABILITY_CONTEXT.viewer).toBeNull();
    expect(EMPTY_CAPABILITY_CONTEXT.modules.size).toBe(0);
    expect(EMPTY_CAPABILITY_CONTEXT.authStrategies).toEqual([]);
    expect(canAccessCapability({ auth: 'user' }, EMPTY_CAPABILITY_CONTEXT)).toBe(false);
    expect(canAccessCapability({ auth: 'admin' }, EMPTY_CAPABILITY_CONTEXT)).toBe(false);
    expect(
      canAccessCapability({ auth: { org: 'orgs.manage' } }, EMPTY_CAPABILITY_CONTEXT, () => 0),
    ).toBe(false);
    expect(
      canAccessCapability({ auth: 'public', requires: ['tos.accepted'] }, EMPTY_CAPABILITY_CONTEXT),
    ).toBe(false);
    expect(
      canAccessCapability(
        { auth: 'public', requires: ['email.verified'] },
        EMPTY_CAPABILITY_CONTEXT,
      ),
    ).toBe(false);
    expect(
      canAccessCapability(
        { auth: 'public', requires: ['flag:billing.enabled'] },
        EMPTY_CAPABILITY_CONTEXT,
      ),
    ).toBe(false);
    expect(
      canAccessCapability(
        { auth: 'public', requires: ['entitlement:pro'] },
        EMPTY_CAPABILITY_CONTEXT,
      ),
    ).toBe(false);
    expect(
      canAccessCapability(
        { auth: 'public', requires: ['age.verified:18'] },
        EMPTY_CAPABILITY_CONTEXT,
      ),
    ).toBe(false);
  });

  it('denies access when auth passes but any single requirement fails, or when org permission bit is missing', () => {
    const ctx = buildContext({
      flags: { 'billing.enabled': true },
      entitlements: ['pro'],
      tosAccepted: true,
      emailVerified: false,
      ageVerifiedFor: 16,
      viewer: {
        userId: 'u-1',
        role: 'user',
        actingOrg: { orgId: 'org-1', permissions: 1n << 0n },
      },
    });
    const orgBits = (perm: string): number | undefined =>
      perm === 'orgs.read' ? 0 : perm === 'orgs.manage' ? 2 : undefined;

    expect(canAccessCapability({ auth: 'admin' }, ctx, orgBits)).toBe(false);
    expect(canAccessCapability({ auth: { org: 'orgs.manage' } }, ctx, orgBits)).toBe(false);
    expect(canAccessCapability({ auth: { org: 'orgs.unknown' } }, ctx, orgBits)).toBe(false);
    expect(
      canAccessCapability({ auth: 'user', requires: ['tos.accepted', 'email.verified'] }, ctx),
    ).toBe(false);
    expect(canAccessCapability({ auth: 'user', requires: ['age.verified:18'] }, ctx)).toBe(false);
    expect(canAccessCapability({ auth: 'user', requires: ['flag:missing'] }, ctx)).toBe(false);
    expect(canAccessCapability({ auth: 'user', requires: ['entitlement:enterprise'] }, ctx)).toBe(
      false,
    );

    expect(
      canAccessCapability(
        {
          auth: { org: 'orgs.read' },
          requires: ['tos.accepted', 'flag:billing.enabled', 'entitlement:pro', 'age.verified:16'],
        },
        ctx,
        orgBits,
      ),
    ).toBe(true);
  });
});

describe('CapabilityProvider and useCapabilities', () => {
  it('returns fail-closed EMPTY_CAPABILITY_CONTEXT when useCapabilities is called outside CapabilityProvider', () => {
    render(createElement(Probe));

    expect(screen.getByTestId('status')).toHaveTextContent('idle');
    expect(screen.getByTestId('viewer')).toHaveTextContent('anon');
    expect(screen.getByTestId('has-tasks')).toHaveTextContent('false');
    expect(screen.getByTestId('flag-billing')).toHaveTextContent('false');
    expect(screen.getByTestId('auth-magic')).toHaveTextContent('false');
    expect(screen.getByTestId('can-admin')).toHaveTextContent('false');
  });

  it('starts fail-closed while loading and hydrates /api/platform/context via transport', async () => {
    let resolveFetch!: (value: unknown) => void;
    const requestMock = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const transport: Transport = { request: requestMock as Transport['request'] };

    render(
      createElement(
        CapabilityProvider,
        {
          transport,
          viewerKey: 'u-admin',
          orgBitLookup: (perm) => (perm === 'orgs.manage' ? 3 : undefined),
        },
        createElement(Probe),
      ),
    );

    // Before resolve: strictly fail-closed
    expect(screen.getByTestId('status')).toHaveTextContent('loading');
    expect(screen.getByTestId('viewer')).toHaveTextContent('anon');
    expect(screen.getByTestId('can-admin')).toHaveTextContent('false');
    expect(screen.getByTestId('can-org-manage')).toHaveTextContent('false');
    expect(requestMock).toHaveBeenCalledWith('/api/platform/context', {
      method: 'GET',
      rawApiPath: true,
      signal: expect.any(AbortSignal),
    });

    const serverCtx = buildContext({
      modules: ['flags', 'tasks'],
      flags: { 'billing.enabled': true },
      authStrategies: ['password', 'magic'],
      viewer: {
        userId: 'u-admin',
        role: 'admin',
        actingOrg: { orgId: 'org-9', permissions: 1n << 3n },
      },
    });

    await act(async () => {
      resolveFetch(serializeCapabilityContext(serverCtx));
    });

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('ready');
    });
    expect(screen.getByTestId('viewer')).toHaveTextContent('u-admin');
    expect(screen.getByTestId('has-tasks')).toHaveTextContent('true');
    expect(screen.getByTestId('flag-billing')).toHaveTextContent('true');
    expect(screen.getByTestId('auth-magic')).toHaveTextContent('true');
    expect(screen.getByTestId('can-admin')).toHaveTextContent('true');
    expect(screen.getByTestId('can-org-manage')).toHaveTextContent('true');
  });

  it('synchronously resets to fail-closed EMPTY_CAPABILITY_CONTEXT when viewerKey changes before refetch resolves and ignores stale in-flight responses', async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    const requestMock = vi.fn(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const transport: Transport = { request: requestMock as Transport['request'] };

    const adminPayload = serializeCapabilityContext(
      buildContext({
        modules: ['tasks'],
        flags: { 'billing.enabled': true },
        authStrategies: ['password', 'magic'],
        viewer: { userId: 'u-admin', role: 'admin' },
      }),
    );

    const { rerender } = render(
      createElement(CapabilityProvider, { transport, viewerKey: 'u-admin' }, createElement(Probe)),
    );

    await act(async () => {
      resolvers[0]?.(adminPayload);
    });
    await waitFor(() => {
      expect(screen.getByTestId('can-admin')).toHaveTextContent('true');
    });

    // Switch viewerKey -> null (logout): must IMMEDIATELY wipe admin state before resolver[1] settles!
    rerender(
      createElement(CapabilityProvider, { transport, viewerKey: null }, createElement(Probe)),
    );

    expect(screen.getByTestId('status')).toHaveTextContent('loading');
    expect(screen.getByTestId('viewer')).toHaveTextContent('anon');
    expect(screen.getByTestId('can-admin')).toHaveTextContent('false');
    expect(screen.getByTestId('flag-billing')).toHaveTextContent('false');

    // Switch again to 'u-member' BEFORE logout request resolves, then resolve the stale logout request with adminPayload!
    rerender(
      createElement(CapabilityProvider, { transport, viewerKey: 'u-member' }, createElement(Probe)),
    );

    await act(async () => {
      // Stale response for viewerKey=null must be ignored. It is a valid answer
      // for that viewer, so only the request-id guard can drop it.
      resolvers[1]?.(
        serializeCapabilityContext(buildContext({ flags: { 'billing.enabled': true } })),
      );
    });
    expect(screen.getByTestId('status')).toHaveTextContent('loading');
    expect(screen.getByTestId('can-admin')).toHaveTextContent('false');
    expect(screen.getByTestId('viewer')).toHaveTextContent('anon');
    expect(screen.getByTestId('flag-billing')).toHaveTextContent('false');

    const memberPayload = serializeCapabilityContext(
      buildContext({
        modules: ['tasks'],
        flags: { 'billing.enabled': false },
        authStrategies: ['password'],
        viewer: { userId: 'u-member', role: 'user' },
      }),
    );
    await act(async () => {
      resolvers[2]?.(memberPayload);
    });
    await waitFor(() => {
      expect(screen.getByTestId('viewer')).toHaveTextContent('u-member');
    });
    expect(screen.getByTestId('can-admin')).toHaveTextContent('false');
    expect(screen.getByTestId('flag-billing')).toHaveTextContent('false');
    expect(requestMock).toHaveBeenCalledTimes(3);
  });

  it.each([
    {
      late: 'answers',
      settle: async (pending: readonly PendingRequest[]): Promise<void> => {
        await act(async () => {
          pending[0]?.resolve(
            serializeCapabilityContext(buildContext({ flags: { 'billing.enabled': true } })),
          );
        });
      },
      requests: 2,
    },
    {
      late: 'fails both attempts',
      settle: async (pending: readonly PendingRequest[]): Promise<void> => {
        await act(async () => {
          pending[0]?.reject(new Error('dropped'));
        });
        // Its retry went out after the current viewer's request.
        await act(async () => {
          pending[2]?.reject(new Error('dropped'));
        });
      },
      // The superseded request still spends its retry; the current viewer's is not resent.
      requests: 3,
    },
  ])(
    "keeps the current viewer's context when a superseded request $late after it",
    async ({ settle, requests }) => {
      const pending: PendingRequest[] = [];
      const requestMock = vi.fn(
        () =>
          new Promise((resolve, reject) => {
            pending.push({ resolve, reject });
          }),
      );
      const transport: Transport = { request: requestMock as Transport['request'] };

      // A signed-in cold load: the anonymous request is still out when the user's is sent.
      const { rerender } = render(
        createElement(CapabilityProvider, { transport, viewerKey: null }, createElement(Probe)),
      );
      rerender(
        createElement(CapabilityProvider, { transport, viewerKey: 'u-1' }, createElement(Probe)),
      );
      await act(async () => {
        pending[1]?.resolve(
          serializeCapabilityContext(buildContext({ viewer: { userId: 'u-1', role: 'user' } })),
        );
      });
      expect(screen.getByTestId('status')).toHaveTextContent('ready');

      await settle(pending);

      // A late write for the old viewer would leave the provider loading for good:
      // nothing refetches while the viewer key stays the same.
      expect(screen.getByTestId('status')).toHaveTextContent('ready');
      expect(screen.getByTestId('viewer')).toHaveTextContent('u-1');
      expect(screen.getByTestId('flag-billing')).toHaveTextContent('false');
      expect(requestMock).toHaveBeenCalledTimes(requests);
    },
  );

  it('stays fail-closed on transport rejection and malformed /api/platform/context payloads', async () => {
    const requestMock = vi.fn().mockRejectedValue(new Error('Network down'));
    const transport: Transport = { request: requestMock as Transport['request'] };

    const { rerender } = render(
      createElement(CapabilityProvider, { transport, viewerKey: 'u-1' }, createElement(Probe)),
    );

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('error');
    });
    expect(screen.getByTestId('viewer')).toHaveTextContent('anon');
    expect(screen.getByTestId('can-admin')).toHaveTextContent('false');
    expect(screen.getByTestId('has-tasks')).toHaveTextContent('false');

    // Trigger second fetch (malformed schema payload)
    requestMock.mockResolvedValue({ broken: 'not-a-valid-capability-context' });
    rerender(
      createElement(CapabilityProvider, { transport, viewerKey: 'u-2' }, createElement(Probe)),
    );

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('error');
    });
    expect(screen.getByTestId('viewer')).toHaveTextContent('anon');
    expect(screen.getByTestId('can-admin')).toHaveTextContent('false');
    expect(screen.getByTestId('flag-billing')).toHaveTextContent('false');
  });

  it('reports the fail-closed context as loading while the viewer is pending, without refetching', async () => {
    const requestMock = vi
      .fn()
      .mockResolvedValue(
        serializeCapabilityContext(buildContext({ flags: { 'billing.enabled': true } })),
      );
    const transport: Transport = { request: requestMock as Transport['request'] };
    const renderWith = (viewerPending: boolean): ReactElement =>
      createElement(
        CapabilityProvider,
        { transport, viewerKey: null, viewerPending },
        createElement(Probe),
      );

    const { rerender } = render(renderWith(false));
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('ready');
    });
    expect(screen.getByTestId('flag-billing')).toHaveTextContent('true');

    // The host knows a viewer is on its way (a session hydrating): the context
    // it holds is not that viewer's, so nothing may decide from it.
    rerender(renderWith(true));
    expect(screen.getByTestId('status')).toHaveTextContent('loading');
    expect(screen.getByTestId('flag-billing')).toHaveTextContent('false');
    expect(requestMock).toHaveBeenCalledTimes(1);

    rerender(renderWith(false));
    expect(screen.getByTestId('status')).toHaveTextContent('ready');
    expect(screen.getByTestId('flag-billing')).toHaveTextContent('true');
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('retries a failed request once before settling', async () => {
    const anonymous = serializeCapabilityContext(buildContext({ modules: ['tasks'] }));
    const flaky = vi.fn().mockRejectedValueOnce(new Error('dropped')).mockResolvedValue(anonymous);
    const first = render(
      createElement(
        CapabilityProvider,
        { transport: { request: flaky as Transport['request'] } },
        createElement(Probe),
      ),
    );
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('ready');
    });
    expect(screen.getByTestId('has-tasks')).toHaveTextContent('true');
    expect(flaky).toHaveBeenCalledTimes(2);
    first.unmount();

    const down = vi.fn().mockRejectedValue(new Error('down'));
    render(
      createElement(
        CapabilityProvider,
        { transport: { request: down as Transport['request'] } },
        createElement(Probe),
      ),
    );
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('error');
    });
    expect(down).toHaveBeenCalledTimes(2);
  });

  describe('a request that does not answer', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('aborts a request that does not answer and settles as error', async () => {
      vi.useFakeTimers();
      const requestMock = vi.fn(
        (_path: string, options?: TransportRequestOptions) =>
          new Promise((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () => {
              reject(new Error('aborted'));
            });
          }),
      );
      render(
        createElement(
          CapabilityProvider,
          { transport: { request: requestMock as Transport['request'] }, viewerKey: 'u-1' },
          createElement(Probe),
        ),
      );
      expect(requestMock).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(requestMock).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId('status')).toHaveTextContent('loading');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(screen.getByTestId('status')).toHaveTextContent('error');
      expect(requestMock).toHaveBeenCalledTimes(2);
    });
  });

  // A session whose token refresh failed asks anonymously while the host
  // already names the user: that answer is not the user's context. Nor is any
  // answer whose viewer is not the key, in either direction.
  it.each([
    { viewerKey: 'u-1', answeredFor: null },
    { viewerKey: 'u-1', answeredFor: 'u-2' },
    { viewerKey: null, answeredFor: 'u-1' },
  ])(
    'refuses a context answered for $answeredFor while the viewer is $viewerKey, after one retry',
    async ({ viewerKey, answeredFor }) => {
      const requestMock = vi.fn().mockResolvedValue(
        serializeCapabilityContext(
          buildContext({
            viewer: answeredFor === null ? null : { userId: answeredFor, role: 'user' },
          }),
        ),
      );
      render(
        createElement(
          CapabilityProvider,
          { transport: { request: requestMock as Transport['request'] }, viewerKey },
          createElement(Probe),
        ),
      );

      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('error');
      });
      expect(screen.getByTestId('viewer')).toHaveTextContent('anon');
      expect(screen.getByTestId('has-tasks')).toHaveTextContent('false');
      expect(requestMock).toHaveBeenCalledTimes(2);
    },
  );
});
