// main/apps/web/src/features/settings/hooks/useBackupCodes.ts
import { getAccessToken } from '@app/authToken';
import { getApiClient } from '@bslt/api';
import { clientConfig } from '@config';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  BackupCodesRegenerateResponse,
  BackupCodesStatusResponse,
} from '@bslt/shared/core/auth';

export type BackupCodesStatus = BackupCodesStatusResponse;

export interface UseBackupCodesResult {
  status: BackupCodesStatusResponse | null;
  isLoading: boolean;
  isRegenerating: boolean;
  newCodes: string[] | null;
  error: string | null;
  refresh: () => Promise<void>;
  regenerate: (code: string) => Promise<void>;
  dismissCodes: () => void;
}

export function useBackupCodes(): UseBackupCodesResult {
  const [status, setStatus] = useState<BackupCodesStatusResponse | null>(null);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const api = useMemo(
    () =>
      getApiClient({
        baseUrl: clientConfig.apiUrl,
        getToken: getAccessToken,
      }),
    [],
  );

  const refresh = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      setStatus(await api.backupCodesStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load backup code status');
    } finally {
      setIsLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const regenerate = useCallback(
    async (code: string): Promise<void> => {
      setIsRegenerating(true);
      setError(null);
      try {
        const result: BackupCodesRegenerateResponse = await api.regenerateBackupCodes({ code });
        setNewCodes(result.backupCodes);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to regenerate backup codes');
      } finally {
        setIsRegenerating(false);
      }
    },
    [api, refresh],
  );

  const dismissCodes = useCallback((): void => {
    setNewCodes(null);
  }, []);

  return {
    status,
    isLoading,
    isRegenerating,
    newCodes,
    error,
    refresh,
    regenerate,
    dismissCodes,
  };
}
