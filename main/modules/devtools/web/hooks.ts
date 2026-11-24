// main/modules/devtools/web/hooks.ts
import { useCallback, useEffect, useMemo, useState } from 'react';

import { createEndpointClient } from '@bslt/client-engine';
import { useEndpointMutation, useQuery, useQueryCache, useTransport } from '@bslt/react';
import { useIsMobile, useLocalStorage } from '@bslt/react/hooks';

import { devtoolsModule } from '../module';

import type { DevEmailInboxResponse, DevEmailItem, RouteManifestResponse } from '../contract';
import type { UILibraryPaneConfig } from './catalog';
import type { DocKey } from './docsMeta';

const MS_PER_MINUTE = 60_000;

export interface UseRouteManifestOptions {
  enabled?: boolean;
}

export interface UseRouteManifestResult {
  data: RouteManifestResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useRouteManifest(options: UseRouteManifestOptions = {}): UseRouteManifestResult {
  const transport = useTransport();
  const client = useMemo(() => createEndpointClient(devtoolsModule, transport), [transport]);

  const queryResult = useQuery<RouteManifestResponse>({
    queryKey: ['routeManifest'],
    queryFn: () => client.getRouteManifest(),
    enabled: options.enabled !== false,
    staleTime: MS_PER_MINUTE,
  });

  return {
    data: queryResult.data,
    isLoading: queryResult.isLoading,
    isError: queryResult.isError,
    error: queryResult.error,
    refetch: queryResult.refetch,
  };
}

export interface UseDocContentResult {
  content: string | null;
  isLoading: boolean;
}

export function useDocContent(key: DocKey): UseDocContentResult {
  const [content, setContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [cache] = useState<Map<DocKey, string>>(() => new Map());

  useEffect(() => {
    const cached = cache.get(key);
    if (cached !== undefined) {
      queueMicrotask(() => {
        setContent(cached);
        setIsLoading(false);
      });
      return;
    }

    queueMicrotask(() => {
      setIsLoading(true);
    });
    void import('./docsMeta')
      .then(({ loadDocContent }) => loadDocContent(key))
      .then((loaded) => {
        cache.set(key, loaded);
        setContent(loaded);
      })
      .catch(() => {
        setContent('Failed to load documentation.');
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [key, cache]);

  return { content, isLoading };
}

const DEFAULT_PANE_CONFIG: UILibraryPaneConfig = {
  top: { visible: true, size: 6 },
  left: { visible: true, size: 18 },
  right: { visible: true, size: 25 },
  bottom: { visible: true, size: 8 },
};

const MOBILE_PANE_CONFIG: UILibraryPaneConfig = {
  top: { visible: true, size: 6 },
  left: { visible: false, size: 18 },
  right: { visible: false, size: 25 },
  bottom: { visible: true, size: 8 },
};

export interface UseUILibraryPanesResult {
  paneConfig: UILibraryPaneConfig;
  togglePane: (pane: keyof UILibraryPaneConfig) => void;
  handlePaneResize: (pane: keyof UILibraryPaneConfig, size: number) => void;
  resetLayout: () => void;
}

export function useUILibraryPanes(storageKey = 'demo-pane-config'): UseUILibraryPanesResult {
  const isMobile = useIsMobile();
  const [paneConfig, setPaneConfig] = useLocalStorage<UILibraryPaneConfig>(
    storageKey,
    DEFAULT_PANE_CONFIG,
  );
  const [hasInitialized, setHasInitialized] = useState(false);

  useEffect(() => {
    if (!hasInitialized && isMobile) {
      setPaneConfig(MOBILE_PANE_CONFIG);
    }
    queueMicrotask(() => {
      setHasInitialized(true);
    });
  }, [isMobile, hasInitialized, setPaneConfig]);

  const togglePane = useCallback(
    (pane: keyof UILibraryPaneConfig): void => {
      setPaneConfig((prev: UILibraryPaneConfig) => ({
        ...prev,
        [pane]: { ...prev[pane], visible: !prev[pane].visible },
      }));
    },
    [setPaneConfig],
  );

  const handlePaneResize = useCallback(
    (pane: keyof UILibraryPaneConfig, size: number): void => {
      setPaneConfig((prev: UILibraryPaneConfig) => ({
        ...prev,
        [pane]: { ...prev[pane], size },
      }));
    },
    [setPaneConfig],
  );

  const resetLayout = useCallback((): void => {
    setPaneConfig(isMobile ? MOBILE_PANE_CONFIG : DEFAULT_PANE_CONFIG);
  }, [isMobile, setPaneConfig]);

  return {
    paneConfig,
    togglePane,
    handlePaneResize,
    resetLayout,
  };
}

interface UseDevEmailsResult {
  readonly emails: readonly DevEmailItem[];
  readonly count: number;
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly isClearing: boolean;
  readonly refresh: () => Promise<void>;
  readonly clearInbox: () => void;
}

export function useDevEmails(): UseDevEmailsResult {
  const transport = useTransport();
  const queryCache = useQueryCache();
  const client = useMemo(() => createEndpointClient(devtoolsModule, transport), [transport]);
  const query = useQuery<DevEmailInboxResponse>({
    queryKey: ['devtools', 'emails'],
    queryFn: () => client.listDevEmails(),
    staleTime: 0,
  });
  const clearMutation = useEndpointMutation(client.clearDevEmails, {
    onSuccess: () => {
      queryCache.invalidateQuery(['devtools', 'emails']);
    },
  });

  return {
    emails: query.data?.emails ?? [],
    count: query.data?.count ?? 0,
    isLoading: query.isLoading,
    error: query.error ?? clearMutation.error,
    isClearing: clearMutation.isLoading,
    refresh: query.refetch,
    clearInbox: () => {
      clearMutation.mutate({ body: {} });
    },
  };
}
