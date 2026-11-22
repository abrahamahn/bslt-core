// main/modules/compliance/web/hooks.ts
import { useCallback, useEffect, useMemo, useState } from 'react';

import { createEndpointClient, isHttpStatusError } from '@bslt/client-engine';
import {
  endpointQueryKey,
  useEndpoint,
  useEndpointMutation,
  useQueryCache,
  useTransport,
} from '@bslt/react';
import { useLocalStorageValue } from '@bslt/react/hooks';

import { complianceModule } from '../module';

import type {
  AcceptTosResponse,
  AgeAssuranceCheckItem,
  AgeAssuranceStatusResponse,
  DataExportFormat,
  DataExportRequestItem,
  JurisdictionRuleItem,
  LegalDocumentItem,
  LegalHoldItem,
  ListLegalHoldsQuery,
  PlaceLegalHoldBody,
  PublishLegalDocumentBody,
  PublishLegalDocumentResponse,
  StartAgeAssuranceBody,
  TosStatusResponse,
  UpsertJurisdictionRuleBody,
  UserAgreementItem,
} from '../contract';

interface ConsentPreferences {
  readonly analytics: boolean | null;
  readonly marketing_email: boolean | null;
  readonly third_party_sharing: boolean | null;
  readonly profiling: boolean | null;
}

export interface UpdateConsentInput {
  readonly analytics?: boolean | undefined;
  readonly marketing_email?: boolean | undefined;
  readonly third_party_sharing?: boolean | undefined;
  readonly profiling?: boolean | undefined;
}

interface UpdateConsentResponse {
  readonly preferences: ConsentPreferences;
  readonly updated: number;
}

interface UseConsentResult {
  readonly preferences: ConsentPreferences | null;
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly refetch: () => Promise<void>;
}

interface UseUpdateConsentResult {
  readonly updateConsent: (input: UpdateConsentInput) => Promise<UpdateConsentResponse>;
  readonly isUpdating: boolean;
  readonly error: Error | null;
}

interface CurrentLegalState {
  readonly documents: readonly LegalDocumentItem[];
  readonly isLoading: boolean;
  readonly isPending: boolean;
  readonly error: Error | null;
  readonly refresh: () => Promise<void>;
}

interface UserAgreementsState {
  readonly agreements: readonly UserAgreementItem[];
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly refresh: () => Promise<void>;
}

interface PublishLegalState {
  readonly publish: (input: PublishLegalDocumentBody) => Promise<PublishLegalDocumentResponse>;
  readonly isPublishing: boolean;
  readonly error: Error | null;
}

export type ExportStatus = 'none' | 'pending' | 'ready' | 'expired';

interface DataExportInfo {
  readonly status: ExportStatus;
  readonly requestedAt: string | null;
  readonly estimatedReadyAt: string | null;
  readonly downloadUrl: string | null;
  readonly expiresAt: string | null;
}

export interface UseDataExportResult {
  readonly exportInfo: DataExportInfo | null;
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly requestExport: (format?: DataExportFormat) => Promise<void>;
  readonly isRequesting: boolean;
  readonly requestError: Error | null;
  readonly downloadExport: () => Promise<void>;
  readonly isDownloading: boolean;
  readonly refetch: () => Promise<void>;
}

const EXPORT_REQUEST_ID_KEY = 'dataExportRequestId';

function toConsentPreferences(preferences: Record<string, boolean | null>): ConsentPreferences {
  return {
    analytics: preferences['analytics'] ?? null,
    marketing_email: preferences['marketing_email'] ?? null,
    third_party_sharing: preferences['third_party_sharing'] ?? null,
    profiling: preferences['profiling'] ?? null,
  };
}

function mapExportStatus(rawStatus: string, expiresAt: string | null): ExportStatus {
  if (rawStatus === 'pending' || rawStatus === 'processing') {
    return 'pending';
  }
  if (rawStatus === 'completed') {
    if (expiresAt !== null && new Date(expiresAt).getTime() < Date.now()) {
      return 'expired';
    }
    return 'ready';
  }
  return 'none';
}

function toExportInfo(request: DataExportRequestItem): DataExportInfo {
  return {
    status: mapExportStatus(request.status, request.expiresAt),
    requestedAt: request.createdAt,
    estimatedReadyAt: null,
    downloadUrl: request.downloadUrl,
    expiresAt: request.expiresAt,
  };
}

export function useCurrentLegal(): CurrentLegalState {
  const transport = useTransport();
  const queryCache = useQueryCache();
  const client = useMemo(() => createEndpointClient(complianceModule, transport), [transport]);
  const queryKey = useMemo(() => endpointQueryKey(client.getCurrentLegal), [client]);
  const query = useEndpoint(client.getCurrentLegal, undefined, { retry: 0 });

  return {
    documents: query.data?.documents ?? [],
    isLoading: query.isLoading,
    isPending: query.status === 'pending' || (query.data === undefined && query.error === null),
    error: query.error,
    refresh: () => {
      queryCache.invalidateQuery(queryKey);
      return Promise.resolve();
    },
  };
}

export function useUserAgreements(): UserAgreementsState {
  const transport = useTransport();
  const queryCache = useQueryCache();
  const client = useMemo(() => createEndpointClient(complianceModule, transport), [transport]);
  const queryKey = useMemo(() => endpointQueryKey(client.getUserAgreements), [client]);
  const query = useEndpoint(client.getUserAgreements, undefined, { retry: 0 });

  return {
    agreements: query.data?.agreements ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refresh: () => {
      queryCache.invalidateQuery(queryKey);
      return Promise.resolve();
    },
  };
}

export function useTosStatus(): {
  readonly status: TosStatusResponse | null;
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly refresh: () => Promise<void>;
} {
  const transport = useTransport();
  const queryCache = useQueryCache();
  const client = useMemo(() => createEndpointClient(complianceModule, transport), [transport]);
  const queryKey = useMemo(() => endpointQueryKey(client.getTosStatus), [client]);
  const query = useEndpoint(client.getTosStatus, undefined, { retry: 0 });

  return {
    status: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    refresh: () => {
      queryCache.invalidateQuery(queryKey);
      return Promise.resolve();
    },
  };
}

export function useAcceptTos(): {
  readonly acceptTos: (documentId: string) => Promise<AcceptTosResponse>;
  readonly isAccepting: boolean;
  readonly error: Error | null;
} {
  const transport = useTransport();
  const client = useMemo(() => createEndpointClient(complianceModule, transport), [transport]);
  const mutation = useEndpointMutation(client.acceptTos);

  return {
    acceptTos: (documentId) => mutation.mutateAsync({ body: { documentId } }),
    isAccepting: mutation.isLoading,
    error: mutation.error,
  };
}

export function usePublishLegal(): PublishLegalState {
  const transport = useTransport();
  const client = useMemo(() => createEndpointClient(complianceModule, transport), [transport]);
  const mutation = useEndpointMutation(client.publishLegal);

  return {
    publish: (input) => mutation.mutateAsync({ body: input }),
    isPublishing: mutation.isLoading,
    error: mutation.error,
  };
}

export function useConsent(): UseConsentResult {
  const transport = useTransport();
  const queryCache = useQueryCache();
  const client = useMemo(() => createEndpointClient(complianceModule, transport), [transport]);
  const queryKey = useMemo(() => endpointQueryKey(client.getConsentPreferences), [client]);
  const query = useEndpoint(client.getConsentPreferences, undefined, { retry: 0 });

  return {
    preferences: query.data !== undefined ? toConsentPreferences(query.data.preferences) : null,
    isLoading: query.isLoading || (query.data === undefined && query.error === null),
    error: query.error,
    refetch: () => {
      queryCache.invalidateQuery(queryKey);
      return Promise.resolve();
    },
  };
}

export function useUpdateConsent(): UseUpdateConsentResult {
  const transport = useTransport();
  const client = useMemo(() => createEndpointClient(complianceModule, transport), [transport]);
  const mutation = useEndpointMutation(client.updateConsentPreferences);

  return {
    updateConsent: async (input) => {
      const res = await mutation.mutateAsync({ body: input });
      return {
        preferences: toConsentPreferences(res.preferences),
        updated: res.updated,
      };
    },
    isUpdating: mutation.isLoading,
    error: mutation.error,
  };
}

export function useDataExport(): UseDataExportResult {
  const transport = useTransport();
  const client = useMemo(() => createEndpointClient(complianceModule, transport), [transport]);
  const [exportInfo, setExportInfo] = useState<DataExportInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isRequesting, setIsRequesting] = useState(false);
  const [requestError, setRequestError] = useState<Error | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [exportRequestId, setExportRequestId] = useLocalStorageValue(EXPORT_REQUEST_ID_KEY);

  const fetchExportStatus = useCallback(async (): Promise<void> => {
    if (exportRequestId === null || exportRequestId.length === 0) {
      setExportInfo(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const data = await client.getDataExportStatus({ params: { id: exportRequestId } });
      setExportInfo(toExportInfo(data.exportRequest));
      if (data.exportRequest.id !== exportRequestId) {
        setExportRequestId(data.exportRequest.id);
      }
    } catch (err: unknown) {
      if (isHttpStatusError(err, 404)) {
        setExportInfo(null);
        setExportRequestId(null);
        return;
      }
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, [client, exportRequestId, setExportRequestId]);

  useEffect(() => {
    void fetchExportStatus();
  }, [fetchExportStatus]);

  const requestExport = useCallback(
    async (format: DataExportFormat = 'json'): Promise<void> => {
      setIsRequesting(true);
      setRequestError(null);
      try {
        const data = await client.requestDataExport({ body: { format } });
        setExportInfo(toExportInfo(data.exportRequest));
        setExportRequestId(data.exportRequest.id);
      } catch (err: unknown) {
        const errorObj = err instanceof Error ? err : new Error(String(err));
        setRequestError(errorObj);
        throw errorObj;
      } finally {
        setIsRequesting(false);
      }
    },
    [client, setExportRequestId],
  );

  const downloadExport = useCallback(async (): Promise<void> => {
    if (exportRequestId === null || exportRequestId.length === 0) return;
    setIsDownloading(true);
    setRequestError(null);
    try {
      const result = await client.downloadDataExport({ params: { id: exportRequestId } });
      const { content, mimeType, extension } =
        'wire' in result
          ? { content: result.wire, mimeType: 'text/csv;charset=utf-8', extension: 'csv' }
          : {
              content: JSON.stringify(result.export, null, 2),
              mimeType: 'application/json',
              extension: 'json',
            };

      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `data-export-${exportRequestId}.${extension}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      const errorObj = err instanceof Error ? err : new Error(String(err));
      setRequestError(errorObj);
      throw errorObj;
    } finally {
      setIsDownloading(false);
    }
  }, [client, exportRequestId]);

  return {
    exportInfo,
    isLoading,
    error,
    requestExport,
    isRequesting,
    requestError,
    downloadExport,
    isDownloading,
    refetch: fetchExportStatus,
  };
}

export function useAgeAssuranceStatus(): {
  readonly status: AgeAssuranceStatusResponse | null;
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly refresh: () => Promise<void>;
} {
  const transport = useTransport();
  const queryCache = useQueryCache();
  const client = useMemo(() => createEndpointClient(complianceModule, transport), [transport]);
  const queryKey = useMemo(() => endpointQueryKey(client.getAgeAssuranceStatus), [client]);
  const query = useEndpoint(client.getAgeAssuranceStatus, undefined, { retry: 0 });

  return {
    status: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    refresh: () => {
      queryCache.invalidateQuery(queryKey);
      return Promise.resolve();
    },
  };
}

export function useStartAgeAssurance(): {
  readonly startCheck: (body: StartAgeAssuranceBody) => Promise<{ check: AgeAssuranceCheckItem }>;
  readonly isSubmitting: boolean;
  readonly error: Error | null;
} {
  const transport = useTransport();
  const client = useMemo(() => createEndpointClient(complianceModule, transport), [transport]);
  const mutation = useEndpointMutation(client.startAgeAssurance);

  return {
    startCheck: (body) => mutation.mutateAsync({ body }),
    isSubmitting: mutation.isLoading,
    error: mutation.error,
  };
}

export function useLegalHolds(query: ListLegalHoldsQuery = {}): {
  readonly holds: readonly LegalHoldItem[];
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly refresh: () => Promise<void>;
} {
  const transport = useTransport();
  const queryCache = useQueryCache();
  const client = useMemo(() => createEndpointClient(complianceModule, transport), [transport]);
  const args = useMemo(() => ({ query }), [query]);
  const queryKey = useMemo(() => endpointQueryKey(client.listLegalHolds, args), [args, client]);
  const result = useEndpoint(client.listLegalHolds, args, { retry: 0 });

  return {
    holds: result.data?.holds ?? [],
    isLoading: result.isLoading,
    error: result.error,
    refresh: () => {
      queryCache.invalidateQuery(queryKey);
      return Promise.resolve();
    },
  };
}

export function usePlaceLegalHold(): {
  readonly placeHold: (body: PlaceLegalHoldBody) => Promise<{ hold: LegalHoldItem }>;
  readonly isPlacing: boolean;
  readonly error: Error | null;
} {
  const transport = useTransport();
  const client = useMemo(() => createEndpointClient(complianceModule, transport), [transport]);
  const mutation = useEndpointMutation(client.placeLegalHold);

  return {
    placeHold: (body) => mutation.mutateAsync({ body }),
    isPlacing: mutation.isLoading,
    error: mutation.error,
  };
}

export function useReleaseLegalHold(): {
  readonly releaseHold: (id: string) => Promise<{ hold: LegalHoldItem }>;
  readonly isReleasing: boolean;
  readonly error: Error | null;
} {
  const transport = useTransport();
  const client = useMemo(() => createEndpointClient(complianceModule, transport), [transport]);
  const mutation = useEndpointMutation(client.releaseLegalHold);

  return {
    releaseHold: (id) => mutation.mutateAsync({ params: { id }, body: {} }),
    isReleasing: mutation.isLoading,
    error: mutation.error,
  };
}

export function useUpsertJurisdictionRule(): {
  readonly upsertRule: (
    body: UpsertJurisdictionRuleBody,
  ) => Promise<{ rule: JurisdictionRuleItem }>;
  readonly isSaving: boolean;
  readonly error: Error | null;
} {
  const transport = useTransport();
  const client = useMemo(() => createEndpointClient(complianceModule, transport), [transport]);
  const mutation = useEndpointMutation(client.upsertJurisdictionRule);

  return {
    upsertRule: (body) => mutation.mutateAsync({ body }),
    isSaving: mutation.isLoading,
    error: mutation.error,
  };
}

export function useEraseUserData(): {
  readonly eraseUser: (
    userId: string,
  ) => Promise<{ userId: string; erasedModules: readonly string[] }>;
  readonly isErasing: boolean;
  readonly error: Error | null;
} {
  const transport = useTransport();
  const client = useMemo(() => createEndpointClient(complianceModule, transport), [transport]);
  const mutation = useEndpointMutation(client.eraseUserData);

  return {
    eraseUser: (userId) => mutation.mutateAsync({ params: { userId }, body: {} }),
    isErasing: mutation.isLoading,
    error: mutation.error,
  };
}
