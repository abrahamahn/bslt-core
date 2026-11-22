// main/modules/compliance/web/hooks.test.tsx
import '@testing-library/jest-dom/vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QueryCache, type Transport } from '@bslt/client-engine';
import { QueryCacheProvider, TransportProvider } from '@bslt/react';

import {
  useAcceptTos,
  useConsent,
  useCurrentLegal,
  useDataExport,
  usePublishLegal,
  useTosStatus,
  useUpdateConsent,
  useUserAgreements,
} from './hooks';

import type { ReactNode } from 'react';

function createWrapper(requestImpl: Transport['request']) {
  const queryCache = new QueryCache();
  const transport: Transport = { request: requestImpl };
  const Wrapper = ({ children }: { readonly children: ReactNode }) => (
    <QueryCacheProvider cache={queryCache}>
      <TransportProvider transport={transport}>{children}</TransportProvider>
    </QueryCacheProvider>
  );
  return { Wrapper, queryCache };
}

describe('compliance web hooks', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('surfaces transport errors across legal, agreements, publish, and consent hooks', async () => {
    const failingRequest = vi.fn().mockRejectedValue(new Error('compliance endpoint down'));
    const { Wrapper } = createWrapper(failingRequest);

    const legal = renderHook(() => useCurrentLegal(), { wrapper: Wrapper });
    await waitFor(() => {
      expect(legal.result.current.error?.message).toBe('compliance endpoint down');
    });
    expect(legal.result.current.documents).toEqual([]);

    const agreements = renderHook(() => useUserAgreements(), { wrapper: Wrapper });
    await waitFor(() => {
      expect(agreements.result.current.error?.message).toBe('compliance endpoint down');
    });
    expect(agreements.result.current.agreements).toEqual([]);

    const consent = renderHook(() => useConsent(), { wrapper: Wrapper });
    await waitFor(() => {
      expect(consent.result.current.error?.message).toBe('compliance endpoint down');
    });
    expect(consent.result.current.preferences).toBeNull();

    const publish = renderHook(() => usePublishLegal(), { wrapper: Wrapper });
    await expect(
      act(async () => {
        await publish.result.current.publish({
          type: 'terms_of_service',
          title: 'Terms',
          content: 'Body',
          effectiveAt: '2026-11-19T00:00:00.000Z',
        });
      }),
    ).rejects.toThrow('compliance endpoint down');

    const updateConsent = renderHook(() => useUpdateConsent(), { wrapper: Wrapper });
    await expect(
      act(async () => {
        await updateConsent.result.current.updateConsent({ analytics: true });
      }),
    ).rejects.toThrow('compliance endpoint down');

    const tosStatus = renderHook(() => useTosStatus(), { wrapper: Wrapper });
    await waitFor(() => {
      expect(tosStatus.result.current.error?.message).toBe('compliance endpoint down');
    });
    expect(tosStatus.result.current.status).toBeNull();

    const acceptTos = renderHook(() => useAcceptTos(), { wrapper: Wrapper });
    await expect(
      act(async () => {
        await acceptTos.result.current.acceptTos('doc-1');
      }),
    ).rejects.toThrow('compliance endpoint down');
  });

  it('clears stale localStorage export id on 404, marks expired exports, and downloads CSV/JSON exports', async () => {
    window.localStorage.setItem('dataExportRequestId', 'stale-id');
    let statusChecks = 0;
    const requestImpl = vi.fn().mockImplementation(async (path: string) => {
      if (path === '/api/users/me/export/stale-id/status') {
        const notFound = Object.assign(new Error('Not found'), { statusCode: 404 });
        throw notFound;
      }
      if (path === '/api/users/me/export') {
        return {
          exportRequest: {
            id: 'exp-csv',
            userId: 'u-1',
            type: 'export',
            status: 'completed',
            format: 'csv',
            downloadUrl: null,
            expiresAt: '2020-01-01T00:00:00.000Z',
            completedAt: '2026-11-19T00:00:00.000Z',
            errorMessage: null,
            createdAt: '2026-11-19T00:00:00.000Z',
          },
        };
      }
      if (path === '/api/users/me/export/exp-csv/status') {
        statusChecks += 1;
        return {
          exportRequest: {
            id: 'exp-csv',
            userId: 'u-1',
            type: 'export',
            status: 'completed',
            format: 'csv',
            downloadUrl: null,
            expiresAt: statusChecks === 1 ? '2020-01-01T00:00:00.000Z' : '2099-01-01T00:00:00.000Z',
            completedAt: '2026-11-19T00:00:00.000Z',
            errorMessage: null,
            createdAt: '2026-11-19T00:00:00.000Z',
          },
        };
      }
      if (path === '/api/users/me/export/exp-csv/download') {
        return {
          status: 200 as const,
          wire: '# profile\nid\nu-1\n',
          headers: { 'content-type': 'text/csv; charset=utf-8' },
        };
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    const createUrlSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:http://localhost/export');
    const revokeUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const { Wrapper } = createWrapper(requestImpl);
    const hook = renderHook(() => useDataExport(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(hook.result.current.isLoading).toBe(false);
    });
    expect(hook.result.current.exportInfo).toBeNull();
    expect(hook.result.current.error).toBeNull();

    await act(async () => {
      await hook.result.current.requestExport('csv');
    });
    expect(hook.result.current.exportInfo?.status).toBe('expired');

    await act(async () => {
      await hook.result.current.refetch();
    });
    expect(hook.result.current.exportInfo?.status).toBe('ready');

    await act(async () => {
      await hook.result.current.downloadExport();
    });
    expect(createUrlSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeUrlSpy).toHaveBeenCalledWith('blob:http://localhost/export');

    createUrlSpy.mockRestore();
    revokeUrlSpy.mockRestore();
    clickSpy.mockRestore();
  });
});
