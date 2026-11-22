// main/modules/audit/web/hooks.ts
import { useCallback, useMemo, useState } from 'react';

import { createEndpointClient } from '@bslt/client-engine';
import {
  endpointQueryKey,
  useEndpoint,
  useEndpointMutation,
  useQueryCache,
  useTransport,
} from '@bslt/react';

import {
  type ActivityEntry,
  type ExportSecurityEventsResponse,
  type ListAuditEventsQuery,
  type ListAuditEventsResponse,
  type ListSecurityEventsResponse,
  type SecurityEventEntry,
  type SecurityEventsFilter,
  type SecurityMetricsPeriod,
  type SecurityMetricsResponse,
} from '../contract';
import { auditModule } from '../module';

function useAuditEndpointClient() {
  const transport = useTransport();
  return useMemo(() => createEndpointClient(auditModule, transport), [transport]);
}

interface UseActivitiesOptions {
  readonly limit?: number | undefined;
  readonly resourceType?: string | undefined;
  readonly action?: string | undefined;
  readonly enabled?: boolean | undefined;
}

interface UseActivitiesResult {
  readonly activities: readonly ActivityEntry[];
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly error: Error | null;
  readonly refetch: () => Promise<void>;
}

export function useActivities(options: UseActivitiesOptions = {}): UseActivitiesResult {
  const queryCache = useQueryCache();
  const client = useAuditEndpointClient();
  const input = useMemo(
    () => ({
      query: {
        ...(options.limit !== undefined ? { limit: options.limit } : {}),
        ...(options.resourceType !== undefined ? { resourceType: options.resourceType } : {}),
        ...(options.action !== undefined ? { action: options.action } : {}),
      },
    }),
    [options.limit, options.resourceType, options.action],
  );
  const key = useMemo(() => endpointQueryKey(client.listActivities, input), [client, input]);
  const query = useEndpoint(client.listActivities, input, {
    enabled: options.enabled !== false,
  });

  return {
    activities: query.data?.activities ?? [],
    isLoading: query.status === 'pending' && options.enabled !== false,
    isError: query.status === 'error',
    error: query.error ?? null,
    refetch: (): Promise<void> => {
      queryCache.invalidateQuery(key);
      return Promise.resolve();
    },
  };
}

interface UseAuditEventsOptions {
  readonly enabled?: boolean | undefined;
  readonly filter?: ListAuditEventsQuery | undefined;
}

interface UseAuditEventsResult {
  readonly data: ListAuditEventsResponse | undefined;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly error: Error | null;
  readonly refetch: () => Promise<void>;
}

export function useAuditEvents(options: UseAuditEventsOptions = {}): UseAuditEventsResult {
  const queryCache = useQueryCache();
  const client = useAuditEndpointClient();
  const input = useMemo(() => ({ query: options.filter ?? {} }), [options.filter]);
  const key = useMemo(() => endpointQueryKey(client.listAuditEvents, input), [client, input]);
  const query = useEndpoint(client.listAuditEvents, input, {
    enabled: options.enabled !== false,
    staleTime: 30_000,
  });

  return {
    data: query.data,
    isLoading: query.status === 'pending' && options.enabled !== false,
    isError: query.status === 'error',
    error: query.error ?? null,
    refetch: (): Promise<void> => {
      queryCache.invalidateQuery(key);
      return Promise.resolve();
    },
  };
}

interface SecurityPaginationOptions {
  readonly page: number;
  readonly limit: number;
  readonly sortBy?: string | undefined;
  readonly sortOrder?: 'asc' | 'desc' | undefined;
}

interface UseSecurityEventsOptions {
  readonly filter?: SecurityEventsFilter | undefined;
  readonly pagination?: Partial<SecurityPaginationOptions> | undefined;
  readonly enabled?: boolean | undefined;
}

interface UseSecurityEventsResult {
  readonly data: ListSecurityEventsResponse | undefined;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly error: Error | null;
  readonly refetch: () => Promise<void>;
  readonly setFilter: (filter: SecurityEventsFilter) => void;
  readonly setPage: (page: number) => void;
  readonly filter: SecurityEventsFilter;
  readonly pagination: SecurityPaginationOptions;
}

export function useSecurityEvents(options: UseSecurityEventsOptions = {}): UseSecurityEventsResult {
  const queryCache = useQueryCache();
  const client = useAuditEndpointClient();
  const [filter, setFilter] = useState<SecurityEventsFilter>(options.filter ?? {});
  const [pagination, setPagination] = useState<SecurityPaginationOptions>({
    page: options.pagination?.page ?? 1,
    limit: options.pagination?.limit ?? 50,
    sortBy: options.pagination?.sortBy ?? 'createdAt',
    sortOrder: options.pagination?.sortOrder ?? 'desc',
  });

  const input = useMemo(
    () => ({
      body: {
        page: pagination.page,
        limit: pagination.limit,
        ...(pagination.sortBy !== undefined ? { sortBy: pagination.sortBy } : {}),
        ...(pagination.sortOrder !== undefined ? { sortOrder: pagination.sortOrder } : {}),
        filter,
      },
    }),
    [pagination, filter],
  );
  const key = useMemo(() => endpointQueryKey(client.listSecurityEvents, input), [client, input]);
  const query = useEndpoint(client.listSecurityEvents, input, {
    enabled: options.enabled !== false,
  });

  const setPage = useCallback((page: number) => {
    setPagination((prev) => ({ ...prev, page }));
  }, []);

  const handleSetFilter = useCallback((nextFilter: SecurityEventsFilter) => {
    setFilter(nextFilter);
    setPagination((prev) => ({ ...prev, page: 1 }));
  }, []);

  return {
    data: query.data,
    isLoading: query.status === 'pending' && options.enabled !== false,
    isError: query.status === 'error',
    error: query.error ?? null,
    refetch: (): Promise<void> => {
      queryCache.invalidateQuery(key);
      return Promise.resolve();
    },
    setFilter: handleSetFilter,
    setPage,
    filter,
    pagination,
  };
}

interface UseSecurityEventOptions {
  readonly enabled?: boolean | undefined;
}

interface UseSecurityEventResult {
  readonly data: SecurityEventEntry | undefined;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly error: Error | null;
  readonly refetch: () => Promise<void>;
}

export function useSecurityEvent(
  id: string | undefined,
  options: UseSecurityEventOptions = {},
): UseSecurityEventResult {
  const queryCache = useQueryCache();
  const client = useAuditEndpointClient();
  const validId = id !== undefined && id.trim().length > 0;
  const input = useMemo(() => ({ params: { id: id ?? '' } }), [id]);
  const key = useMemo(() => endpointQueryKey(client.getSecurityEvent, input), [client, input]);
  const isEnabled = validId && options.enabled !== false;
  const query = useEndpoint(client.getSecurityEvent, input, {
    enabled: isEnabled,
  });

  return {
    data: query.data,
    isLoading: query.status === 'pending' && isEnabled,
    isError: query.status === 'error',
    error: query.error ?? null,
    refetch: (): Promise<void> => {
      queryCache.invalidateQuery(key);
      return Promise.resolve();
    },
  };
}

interface UseSecurityMetricsOptions {
  readonly period?: SecurityMetricsPeriod | undefined;
  readonly enabled?: boolean | undefined;
}

interface UseSecurityMetricsResult {
  readonly data: SecurityMetricsResponse | undefined;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly error: Error | null;
  readonly refetch: () => Promise<void>;
  readonly period: SecurityMetricsPeriod;
  readonly setPeriod: (period: SecurityMetricsPeriod) => void;
}

export function useSecurityMetrics(
  options: UseSecurityMetricsOptions = {},
): UseSecurityMetricsResult {
  const queryCache = useQueryCache();
  const client = useAuditEndpointClient();
  const [period, setPeriodState] = useState<SecurityMetricsPeriod>(options.period ?? 'day');
  const input = useMemo(() => ({ query: { period } }), [period]);
  const key = useMemo(() => endpointQueryKey(client.getSecurityMetrics, input), [client, input]);
  const query = useEndpoint(client.getSecurityMetrics, input, {
    enabled: options.enabled !== false,
  });

  const setPeriod = useCallback((nextPeriod: SecurityMetricsPeriod) => {
    setPeriodState(nextPeriod);
  }, []);

  return {
    data: query.data,
    isLoading: query.status === 'pending' && options.enabled !== false,
    isError: query.status === 'error',
    error: query.error ?? null,
    refetch: (): Promise<void> => {
      queryCache.invalidateQuery(key);
      return Promise.resolve();
    },
    period,
    setPeriod,
  };
}

interface UseExportEventsResult {
  readonly exportEvents: (format: 'csv' | 'json', filter?: SecurityEventsFilter) => void;
  readonly downloadExport: (format: 'csv' | 'json', filter?: SecurityEventsFilter) => void;
  readonly isExporting: boolean;
  readonly isError: boolean;
  readonly error: Error | null;
  readonly data: ExportSecurityEventsResponse | null;
}

export function useExportEvents(): UseExportEventsResult {
  const client = useAuditEndpointClient();
  const mutation = useEndpointMutation(client.exportSecurityEvents);

  const exportEvents = useCallback(
    (format: 'csv' | 'json', filter?: SecurityEventsFilter) => {
      mutation.mutate({
        body: {
          format,
          ...(filter !== undefined ? { filter } : {}),
        },
      });
    },
    [mutation],
  );

  const downloadExport = useCallback(
    (format: 'csv' | 'json', filter?: SecurityEventsFilter) => {
      void mutation
        .mutateAsync({
          body: {
            format,
            ...(filter !== undefined ? { filter } : {}),
          },
        })
        .then(
          (response) => {
            const blob = new Blob([response.data], { type: response.contentType });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = response.filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            return true;
          },
          () => false,
        );
    },
    [mutation],
  );

  return {
    exportEvents,
    downloadExport,
    isExporting: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error ?? null,
    data: mutation.data ?? null,
  };
}
