// main/apps/server/src/bootstrap/context.test.ts
import { BadRequestError, ForbiddenError } from '@bslt/contract';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { contextualizeRequest } from './context';

import type { AppContext } from './context';
import type { HttpServerReply, HttpServerRequest } from '@bslt/server-system/http';

const mockResolveActingOrg = vi.hoisted(() => vi.fn());

vi.mock('../generated/modules', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../generated/modules')>();
  return {
    ...actual,
    resolveActingOrg: mockResolveActingOrg,
  };
});

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

interface TestRequestOptions {
  readonly headers?: Record<string, string>;
  readonly actingOrg?: { readonly orgId: string; readonly permissions: bigint } | null;
  readonly userTenantId?: string;
}

function createContextualizedRequest(options: TestRequestOptions = {}): {
  readonly contextualize: ReturnType<typeof vi.fn>;
  readonly request: HttpServerRequest & { context: AppContext };
  readonly tenantContext: AppContext;
  readonly userContext: AppContext;
} {
  mockResolveActingOrg.mockResolvedValue(options.actingOrg ?? null);
  const contextualize = vi.fn();

  const userContext = {
    contextualize,
    db: {},
  } as unknown as AppContext;

  const tenantContext = {
    contextualize,
    db: {},
  } as unknown as AppContext;

  contextualize.mockImplementation((session: { orgId?: string }) =>
    session.orgId !== undefined ? tenantContext : userContext,
  );

  const rootContext = {
    contextualize,
  } as unknown as AppContext;

  const user = {
    userId: USER_ID,
    email: 'user@example.com',
    role: 'user',
    ...(options.userTenantId !== undefined ? { tenantId: options.userTenantId } : {}),
  };

  const request = {
    headers: options.headers ?? {},
    user,
    context: rootContext,
  } as unknown as HttpServerRequest & { context: AppContext };

  return { contextualize, request, tenantContext, userContext };
}

describe('contextualizeRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scopes authenticated requests by user when no tenant is requested', async () => {
    const { contextualize, request, userContext } = createContextualizedRequest();

    await contextualizeRequest(request, {} as HttpServerReply);

    expect(contextualize).toHaveBeenCalledTimes(1);
    expect(contextualize).toHaveBeenCalledWith({ userId: USER_ID, role: 'user' });
    expect(mockResolveActingOrg).not.toHaveBeenCalled();
    expect(request.context).toBe(userContext);
    expect((request as { actingOrg?: unknown }).actingOrg).toBeUndefined();
  });

  it('validates org membership before adding orgId scope and populating actingOrg permission bitmask', async () => {
    const { contextualize, request, tenantContext, userContext } = createContextualizedRequest({
      headers: { 'x-tenant-id': TENANT_ID },
      actingOrg: { orgId: TENANT_ID, permissions: 63n },
    });

    await contextualizeRequest(request, {} as HttpServerReply);

    expect(mockResolveActingOrg).toHaveBeenCalledTimes(1);
    expect(mockResolveActingOrg).toHaveBeenCalledWith(userContext.db, TENANT_ID, USER_ID);
    expect(contextualize).toHaveBeenNthCalledWith(1, { userId: USER_ID, role: 'user' });
    expect(contextualize).toHaveBeenNthCalledWith(2, {
      userId: USER_ID,
      role: 'user',
      orgId: TENANT_ID,
    });
    expect(request.context).toBe(tenantContext);
    expect((request as { actingOrg?: unknown }).actingOrg).toEqual({
      orgId: TENANT_ID,
      permissions: 63n,
    });
  });

  it('rejects forged tenant headers before org scope or actingOrg is added', async () => {
    const { contextualize, request } = createContextualizedRequest({
      headers: { 'x-tenant-id': TENANT_ID },
      actingOrg: null,
    });

    await expect(contextualizeRequest(request, {} as HttpServerReply)).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    expect(mockResolveActingOrg).toHaveBeenCalledTimes(1);
    expect(contextualize).toHaveBeenCalledTimes(1);
    expect(contextualize).toHaveBeenCalledWith({ userId: USER_ID, role: 'user' });
    expect((request as { actingOrg?: unknown }).actingOrg).toBeUndefined();
  });

  it('rejects mismatched x-tenant-id header vs token tenantId before querying org membership', async () => {
    const { contextualize, request } = createContextualizedRequest({
      headers: { 'x-tenant-id': TENANT_ID },
      userTenantId: '99999999-9999-4999-8999-999999999999',
    });

    await expect(contextualizeRequest(request, {} as HttpServerReply)).rejects.toBeInstanceOf(
      BadRequestError,
    );
    expect(mockResolveActingOrg).not.toHaveBeenCalled();
    expect(contextualize).not.toHaveBeenCalled();
  });
});
