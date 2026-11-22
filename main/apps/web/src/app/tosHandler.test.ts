// main/apps/web/src/app/tosHandler.test.ts
import { clearRequirementHandlers, createTransport } from '@bslt/client-engine';
import { ForbiddenError } from '@bslt/contract';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { onTosRequired, setTosHandler } from './tosHandler';

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => Promise.resolve(body),
  } as unknown as Response;
}

afterEach(() => {
  clearRequirementHandlers();
});

describe('tosHandler', () => {
  it('rejects onTosRequired when no UI handler is registered or when user dismisses the modal', async () => {
    await expect(onTosRequired({ documentId: 'doc-1', requiredVersion: 2 })).rejects.toThrow(
      'Terms of Service acceptance required',
    );

    const cleanup = setTosHandler(async () => Promise.resolve(false));
    await expect(onTosRequired({ documentId: 'doc-1', requiredVersion: 2 })).rejects.toThrow(
      'Terms of Service acceptance dismissed',
    );
    cleanup();
  });

  it('refuses transport retry when documentId is missing, handler returns false, or handler was cleaned up', async () => {
    const uiHandler = vi.fn(async () => Promise.resolve(false));
    const cleanup = setTosHandler(uiHandler);

    // Missing documentId in 403 details -> does not invoke UI handler, surfaces ForbiddenError
    const missingDocFetch = vi.fn().mockResolvedValue(
      mockResponse(403, {
        code: 'TOS_ACCEPTANCE_REQUIRED',
        message: 'Accept ToS',
        details: { requiredVersion: 1 },
      }),
    );
    const missingDocTransport = createTransport({
      baseUrl: 'https://api.example.com',
      fetchImpl: missingDocFetch,
    });
    await expect(missingDocTransport.request('/tasks')).rejects.toBeInstanceOf(ForbiddenError);
    expect(uiHandler).not.toHaveBeenCalled();

    // Dismissed modal (returns false) -> does not retry, surfaces ForbiddenError
    const dismissedFetch = vi.fn().mockResolvedValue(
      mockResponse(403, {
        code: 'TOS_ACCEPTANCE_REQUIRED',
        message: 'Accept ToS',
        details: { documentId: 'doc-2', requiredVersion: 3 },
      }),
    );
    const dismissedTransport = createTransport({
      baseUrl: 'https://api.example.com',
      fetchImpl: dismissedFetch,
    });
    await expect(dismissedTransport.request('/tasks')).rejects.toBeInstanceOf(ForbiddenError);
    expect(uiHandler).toHaveBeenCalledWith({ documentId: 'doc-2', requiredVersion: 3 });
    expect(dismissedFetch).toHaveBeenCalledTimes(1);

    // Cleaned up handler -> no longer intercepts
    cleanup();
    await expect(dismissedTransport.request('/tasks')).rejects.toBeInstanceOf(ForbiddenError);
    expect(uiHandler).toHaveBeenCalledTimes(1);
  });

  it('bridges both transport 403 TOS_ACCEPTANCE_REQUIRED retry and legacy onTosRequired when accepted', async () => {
    const uiHandler = vi.fn(async () => Promise.resolve(true));
    const cleanup = setTosHandler(uiHandler);

    await expect(
      onTosRequired({ documentId: 'doc-legacy', requiredVersion: 1 }),
    ).resolves.toBeUndefined();
    expect(uiHandler).toHaveBeenCalledWith({ documentId: 'doc-legacy', requiredVersion: 1 });

    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse(403, {
          code: 'TOS_ACCEPTANCE_REQUIRED',
          message: 'Accept ToS',
          details: { requirement: 'tos.accepted', documentId: 'doc-sdk', requiredVersion: 4 },
        }),
      )
      .mockResolvedValueOnce(mockResponse(200, { tasks: [] }));

    const transport = createTransport({
      baseUrl: 'https://api.example.com',
      fetchImpl,
    });
    await expect(transport.request('/tasks')).resolves.toEqual({ tasks: [] });
    expect(uiHandler).toHaveBeenLastCalledWith({ documentId: 'doc-sdk', requiredVersion: 4 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    cleanup();
  });
});
