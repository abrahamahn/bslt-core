// main/modules/identity/web/useImpersonation.ts
import { useCallback, useMemo } from 'react';

import { useAuth } from './authService';

export interface UseImpersonationResult {
  readonly isImpersonating: boolean;
  readonly targetEmail: string | null;
  readonly endImpersonation: () => Promise<void>;
  readonly startImpersonation: (userId: string) => Promise<void>;
}

export function useImpersonation(): UseImpersonationResult {
  const {
    endImpersonation: endAuthImpersonation,
    impersonation,
    startImpersonation: startAuthImpersonation,
    user,
  } = useAuth();

  const isImpersonating = useMemo(() => impersonation !== null, [impersonation]);

  const targetEmail = useMemo(() => {
    if (impersonation !== null) {
      return impersonation.targetEmail;
    }
    if (!isImpersonating || user === null) {
      return null;
    }
    return user.email;
  }, [impersonation, isImpersonating, user]);

  const endImpersonation = useCallback(async (): Promise<void> => {
    try {
      await endAuthImpersonation();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to end impersonation: ${message}`);
    }
  }, [endAuthImpersonation]);

  const startImpersonation = useCallback(
    async (userId: string): Promise<void> => {
      try {
        await startAuthImpersonation(userId);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`Failed to start impersonation: ${message}`);
      }
    },
    [startAuthImpersonation],
  );

  return {
    isImpersonating,
    targetEmail,
    endImpersonation,
    startImpersonation,
  };
}
