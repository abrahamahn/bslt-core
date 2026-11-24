// main/modules/identity/web/hooks.ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createEndpointClient } from '@bslt/client-engine';
import {
  endpointQueryKey,
  useEndpoint,
  useEndpointMutation,
  useMutation,
  useQueryCache,
  useTransport,
} from '@bslt/react';

import { AUTH_STRATEGIES } from '../contract';
import { identityModule } from '../module';

import { createPasskey, type PasskeyCreationOptionsJSON } from './webauthn';

import type {
  AccountLifecycleResponse,
  AdminActionResponse,
  AdminCreateUserRequest,
  AdminDeleteUserRequest,
  AdminForceLogoutResponse,
  AdminHardBanRequest,
  AdminHardBanResponse,
  AdminLockUserRequest,
  AdminLockUserResponse,
  AdminUpdateUserRequest,
  AdminUpdateUserResponse,
  AdminUser,
  AdminUserListFilters,
  ApiKey,
  ApiKeysListResponse,
  AuthStrategy,
  BackupCodesRegenerateResponse,
  BackupCodesStatusResponse,
  ChangeEmailRequest,
  ChangeEmailResponse,
  ChangePasswordRequest,
  ChangePasswordResponse,
  ConfirmEmailChangeRequest,
  ConfirmEmailChangeResponse,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  DeactivateAccountRequest,
  DeleteAccountRequest,
  DeviceItem,
  ForgotPasswordRequest,
  ForgotPasswordResponse,
  OAuthConnectionItem,
  OAuthProvider,
  PasskeyListItem,
  ProfileCompletenessResponse,
  RevertEmailChangeRequest,
  RevertEmailChangeResponse,
  RevokeAllSessionsResponse,
  RevokeSessionResponse,
  Session,
  SetPasswordRequest,
  SetPasswordResponse,
  SudoRequest,
  SudoResponse,
  TotpSetupResponse,
  UpdateProfileRequest,
  UpdateUsernameRequest,
  UpdateUsernameResponse,
  User,
  VerifyPhoneResponse,
  WebauthnRegisterVerifyRequest,
} from '../contract';

const MS_PER_MINUTE = 60 * 1000;
const ADMIN_DEFAULT_LIMIT = 20;

export const identityMeQueryKey = ['identity', 'me'] as const;
export const identityProfileCompletenessQueryKey = ['identity', 'getProfileCompleteness'] as const;

function useIdentityClient() {
  const transport = useTransport();
  return useMemo(() => createEndpointClient(identityModule, transport), [transport]);
}

// ============================================================================
// 1. API Key Hooks
// ============================================================================

export interface UseApiKeysResult {
  readonly data: readonly ApiKey[];
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly error: Error | null;
  readonly refetch: () => void;
}

export function useApiKeys(): UseApiKeysResult {
  const client = useIdentityClient();
  const queryCache = useQueryCache();
  const listKey = useMemo(() => endpointQueryKey(client.listApiKeys), [client]);
  const query = useEndpoint(client.listApiKeys, undefined, { retry: 0 });

  const refetch = useCallback((): void => {
    queryCache.invalidateQuery(listKey);
  }, [queryCache, listKey]);

  return {
    data: query.data?.keys ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch,
  };
}

export interface UseCreateApiKeyResult {
  readonly create: (input: CreateApiKeyRequest) => void;
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly error: Error | null;
}

export function useCreateApiKey(options?: {
  readonly onSuccess?: (response: CreateApiKeyResponse) => void;
}): UseCreateApiKeyResult {
  const client = useIdentityClient();
  const onSuccessRef = useRef(options?.onSuccess);
  onSuccessRef.current = options?.onSuccess;

  const mutation = useEndpointMutation(client.createApiKey, {
    onSuccess: (response) => {
      onSuccessRef.current?.(response);
    },
  });

  const create = useCallback(
    (input: CreateApiKeyRequest): void => {
      mutation.mutate({ body: input });
    },
    [mutation],
  );

  return {
    create,
    isPending: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error,
  };
}

export interface UseDeleteApiKeyResult {
  readonly revoke: (id: string) => void;
  readonly revokeAsync: (id: string) => Promise<string>;
  readonly isPending: boolean;
  readonly error: Error | null;
}

export function useDeleteApiKey(): UseDeleteApiKeyResult {
  const client = useIdentityClient();
  const queryCache = useQueryCache();
  const listKey = useMemo(() => endpointQueryKey(client.listApiKeys), [client]);

  const mutation = useMutation<string, Error, string, { previous?: ApiKeysListResponse }>({
    mutationFn: async (id: string) => {
      await client.deleteApiKey({ params: { id }, body: {} });
      return id;
    },
    onMutate: (id) => {
      const previous = queryCache.getQueryData(listKey) as ApiKeysListResponse | undefined;
      if (previous !== undefined) {
        queryCache.setQueryData(listKey, {
          ...previous,
          keys: previous.keys.filter((key) => key.id !== id),
        });
      }
      return previous !== undefined ? { previous } : {};
    },
    onError: (_error, _id, context) => {
      if (context?.previous !== undefined) {
        queryCache.setQueryData(listKey, context.previous);
      }
    },
    onSettled: () => {
      queryCache.invalidateQuery(listKey);
    },
  });

  const revoke = useCallback(
    (id: string): void => {
      mutation.mutate(id);
    },
    [mutation],
  );

  return {
    revoke,
    revokeAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error ?? null,
  };
}

// ============================================================================
// 2. Self-Service Profile, Username, Password, Sessions & Lifecycle Hooks
// ============================================================================

export interface UseProfileUpdateOptions {
  onSuccess?: (user: User) => void;
  onError?: (error: Error) => void;
}

export interface UseProfileUpdateResult {
  updateProfile: (data: UpdateProfileRequest) => void;
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: Error | null;
  reset: () => void;
}

export function useProfileUpdate(options?: UseProfileUpdateOptions): UseProfileUpdateResult {
  const client = useIdentityClient();
  const mutation = useEndpointMutation(client.updateProfile, {
    onSuccess: (user) => {
      options?.onSuccess?.(user);
    },
    onError: (error) => {
      options?.onError?.(error);
    },
  });

  const updateProfile = useCallback(
    (data: UpdateProfileRequest): void => {
      mutation.mutate({ body: data });
    },
    [mutation],
  );

  return {
    updateProfile,
    isLoading: mutation.status === 'pending',
    isSuccess: mutation.status === 'success',
    isError: mutation.status === 'error',
    error: mutation.error,
    reset: mutation.reset,
  };
}

export interface UseProfileCompletenessResult {
  data: ProfileCompletenessResponse | null;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useProfileCompleteness(): UseProfileCompletenessResult {
  const client = useIdentityClient();
  const queryCache = useQueryCache();
  const completenessKey = useMemo(() => endpointQueryKey(client.getProfileCompleteness), [client]);
  const query = useEndpoint(client.getProfileCompleteness, undefined, {
    staleTime: MS_PER_MINUTE,
    retry: 0,
  });

  const refetch = useCallback((): void => {
    queryCache.invalidateQuery(completenessKey);
  }, [queryCache, completenessKey]);

  return {
    data: query.data ?? null,
    isLoading: query.status === 'pending',
    isError: query.status === 'error',
    error: query.error ?? null,
    refetch,
  };
}

export interface UseUsernameUpdateOptions {
  onSuccess?: (response: UpdateUsernameResponse) => void;
  onError?: (error: Error) => void;
}

export interface UseUsernameUpdateResult {
  updateUsername: (data: UpdateUsernameRequest) => void;
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: Error | null;
  data: UpdateUsernameResponse | null;
  reset: () => void;
}

export function useUsernameUpdate(options?: UseUsernameUpdateOptions): UseUsernameUpdateResult {
  const client = useIdentityClient();
  const mutation = useEndpointMutation(client.updateUsername, {
    onSuccess: (response) => {
      options?.onSuccess?.(response);
    },
    onError: (error) => {
      options?.onError?.(error);
    },
  });

  const updateUsername = useCallback(
    (data: UpdateUsernameRequest): void => {
      mutation.mutate({ body: data });
    },
    [mutation],
  );

  return {
    updateUsername,
    isLoading: mutation.status === 'pending',
    isSuccess: mutation.status === 'success',
    isError: mutation.status === 'error',
    error: mutation.error,
    data: mutation.data ?? null,
    reset: mutation.reset,
  };
}

export interface UsePasswordChangeOptions {
  onSuccess?: (response: ChangePasswordResponse) => void;
  onError?: (error: Error) => void;
}

export interface UsePasswordChangeResult {
  changePassword: (data: ChangePasswordRequest) => void;
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: Error | null;
  reset: () => void;
}

export function usePasswordChange(options?: UsePasswordChangeOptions): UsePasswordChangeResult {
  const client = useIdentityClient();
  const mutation = useEndpointMutation(client.changePassword, {
    onSuccess: (response) => {
      options?.onSuccess?.(response);
    },
    onError: (error) => {
      options?.onError?.(error);
    },
  });

  const changePassword = useCallback(
    (data: ChangePasswordRequest): void => {
      mutation.mutate({ body: data });
    },
    [mutation],
  );

  return {
    changePassword,
    isLoading: mutation.status === 'pending',
    isSuccess: mutation.status === 'success',
    isError: mutation.status === 'error',
    error: mutation.error,
    reset: mutation.reset,
  };
}

export interface UseSessionsResult {
  sessions: Session[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useSessions(): UseSessionsResult {
  const client = useIdentityClient();
  const query = useEndpoint(client.listSessions, undefined, { retry: 0 });

  return {
    sessions: query.data?.sessions ?? [],
    isLoading: query.status === 'pending',
    isError: query.status === 'error',
    error: query.error,
    refetch: (): void => {
      void query.refetch();
    },
  };
}

export interface UseRevokeSessionOptions {
  onSuccess?: (response: RevokeSessionResponse) => void;
  onError?: (error: Error) => void;
}

export interface UseRevokeSessionResult {
  revokeSession: (sessionId: string) => void;
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: Error | null;
  reset: () => void;
}

export function useRevokeSession(options?: UseRevokeSessionOptions): UseRevokeSessionResult {
  const client = useIdentityClient();
  const mutation = useEndpointMutation(client.revokeSession, {
    onSuccess: (response) => {
      options?.onSuccess?.(response);
    },
    onError: (error) => {
      options?.onError?.(error);
    },
  });

  const revokeSession = useCallback(
    (sessionId: string): void => {
      mutation.mutate({ params: { id: sessionId }, body: {} });
    },
    [mutation],
  );

  return {
    revokeSession,
    isLoading: mutation.status === 'pending',
    isSuccess: mutation.status === 'success',
    isError: mutation.status === 'error',
    error: mutation.error,
    reset: mutation.reset,
  };
}

export interface UseRevokeAllSessionsOptions {
  onSuccess?: (response: RevokeAllSessionsResponse) => void;
  onError?: (error: Error) => void;
}

export interface UseRevokeAllSessionsResult {
  revokeAllSessions: () => void;
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: Error | null;
  revokedCount: number | null;
  reset: () => void;
}

export function useRevokeAllSessions(
  options?: UseRevokeAllSessionsOptions,
): UseRevokeAllSessionsResult {
  const client = useIdentityClient();
  const mutation = useEndpointMutation(client.revokeAllSessions, {
    onSuccess: (response) => {
      options?.onSuccess?.(response);
    },
    onError: (error) => {
      options?.onError?.(error);
    },
  });

  const revokeAllSessions = useCallback((): void => {
    mutation.mutate({ body: {} });
  }, [mutation]);

  return {
    revokeAllSessions,
    isLoading: mutation.status === 'pending',
    isSuccess: mutation.status === 'success',
    isError: mutation.status === 'error',
    error: mutation.error,
    revokedCount: mutation.data?.revokedCount ?? null,
    reset: mutation.reset,
  };
}

export interface UseDeactivateAccountOptions {
  onSuccess?: (response: AccountLifecycleResponse) => void;
  onError?: (error: Error) => void;
}

export interface UseDeactivateAccountResult {
  deactivate: (data: DeactivateAccountRequest, sudoToken: string) => void;
  isLoading: boolean;
  error: Error | null;
  reset: () => void;
}

export function useDeactivateAccount(
  options?: UseDeactivateAccountOptions,
): UseDeactivateAccountResult {
  const client = useIdentityClient();
  const queryCache = useQueryCache();
  const meKey = useMemo(() => endpointQueryKey(client.me), [client]);

  const mutation = useMutation<
    AccountLifecycleResponse,
    Error,
    { data: DeactivateAccountRequest; sudoToken: string }
  >({
    mutationFn: ({ data, sudoToken }) =>
      client.deactivateAccount({ body: data }, { headers: { 'x-sudo-token': sudoToken } }),
    onSuccess: (response) => {
      queryCache.invalidateQuery(meKey);
      options?.onSuccess?.(response);
    },
    onError: (error) => {
      options?.onError?.(error);
    },
  });

  return {
    deactivate: (data: DeactivateAccountRequest, sudoToken: string): void => {
      mutation.mutate({ data, sudoToken });
    },
    isLoading: mutation.status === 'pending',
    error: mutation.error,
    reset: mutation.reset,
  };
}

export interface UseDeleteAccountOptions {
  onSuccess?: (response: AccountLifecycleResponse) => void;
  onError?: (error: Error) => void;
}

export interface UseDeleteAccountResult {
  requestDeletion: (data: DeleteAccountRequest, sudoToken: string) => void;
  isLoading: boolean;
  error: Error | null;
  reset: () => void;
}

export function useDeleteAccount(options?: UseDeleteAccountOptions): UseDeleteAccountResult {
  const client = useIdentityClient();
  const queryCache = useQueryCache();
  const meKey = useMemo(() => endpointQueryKey(client.me), [client]);

  const mutation = useMutation<
    AccountLifecycleResponse,
    Error,
    { data: DeleteAccountRequest; sudoToken: string }
  >({
    mutationFn: ({ data, sudoToken }) =>
      client.deleteAccount({ body: data }, { headers: { 'x-sudo-token': sudoToken } }),
    onSuccess: (response) => {
      queryCache.invalidateQuery(meKey);
      options?.onSuccess?.(response);
    },
    onError: (error) => {
      options?.onError?.(error);
    },
  });

  return {
    requestDeletion: (data: DeleteAccountRequest, sudoToken: string): void => {
      mutation.mutate({ data, sudoToken });
    },
    isLoading: mutation.status === 'pending',
    error: mutation.error,
    reset: mutation.reset,
  };
}

export interface UseReactivateAccountOptions {
  onSuccess?: (response: AccountLifecycleResponse) => void;
  onError?: (error: Error) => void;
}

export interface UseReactivateAccountResult {
  reactivate: () => void;
  isLoading: boolean;
  error: Error | null;
  reset: () => void;
}

export function useReactivateAccount(
  options?: UseReactivateAccountOptions,
): UseReactivateAccountResult {
  const client = useIdentityClient();
  const mutation = useEndpointMutation(client.reactivateAccount, {
    onSuccess: (response) => {
      options?.onSuccess?.(response);
    },
    onError: (error) => {
      options?.onError?.(error);
    },
  });

  return {
    reactivate: (): void => {
      mutation.mutate({ body: {} });
    },
    isLoading: mutation.status === 'pending',
    error: mutation.error,
    reset: mutation.reset,
  };
}

// ============================================================================
// 3. Administrative User Hooks
// ============================================================================

export interface UseAdminUsersState {
  users: AdminUser[];
  total: number;
  page: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
  isLoading: boolean;
  error: string | null;
}

export interface UseAdminUsersActions {
  setFilters: (filters: AdminUserListFilters) => void;
  setPage: (page: number) => void;
  refresh: () => Promise<void>;
}

export interface UseAdminUsersResult extends UseAdminUsersState, UseAdminUsersActions {
  filters: AdminUserListFilters;
}

export function useAdminUsers(initialFilters: AdminUserListFilters = {}): UseAdminUsersResult {
  const client = useIdentityClient();
  const [filters, setFiltersState] = useState<AdminUserListFilters>({
    page: 1,
    limit: ADMIN_DEFAULT_LIMIT,
    sortBy: 'createdAt',
    sortOrder: 'desc',
    ...initialFilters,
  });

  const [state, setState] = useState<UseAdminUsersState>({
    users: [],
    total: 0,
    page: 1,
    totalPages: 0,
    hasNext: false,
    hasPrev: false,
    isLoading: true,
    error: null,
  });

  const fetchUsers = useCallback(
    async (currentFilters: AdminUserListFilters) => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));
      try {
        const trimmedSearch = currentFilters.search?.trim() ?? '';
        const useDedicatedSearch =
          trimmedSearch.length > 0 &&
          currentFilters.role === undefined &&
          currentFilters.status === undefined;
        if (useDedicatedSearch) {
          const limit = currentFilters.limit ?? ADMIN_DEFAULT_LIMIT;
          const page = currentFilters.page ?? 1;
          const offset = Math.max(0, (page - 1) * limit);
          const searched = await client.adminSearchUsers({
            query: { q: trimmedSearch, limit, offset },
          });
          const totalPages = Math.max(1, Math.ceil(searched.total / limit));
          setState({
            users: searched.users,
            total: searched.total,
            page,
            totalPages,
            hasNext: offset + searched.users.length < searched.total,
            hasPrev: page > 1,
            isLoading: false,
            error: null,
          });
          return;
        }
        const result = await client.adminListUsers({ query: currentFilters });
        setState({
          users: result.data,
          total: result.total,
          page: result.page,
          totalPages: result.totalPages,
          hasNext: result.hasNext,
          hasPrev: result.hasPrev,
          isLoading: false,
          error: null,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to load users';
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: errorMessage,
        }));
      }
    },
    [client],
  );

  useEffect(() => {
    queueMicrotask(() => {
      void fetchUsers(filters);
    });
  }, [filters, fetchUsers]);

  const setFilters = useCallback((newFilters: AdminUserListFilters) => {
    setFiltersState((prev) => ({
      ...prev,
      ...newFilters,
      page: 1,
    }));
  }, []);

  const setPage = useCallback((page: number) => {
    setFiltersState((prev) => ({ ...prev, page }));
  }, []);

  const refresh = useCallback(async () => {
    await fetchUsers(filters);
  }, [filters, fetchUsers]);

  return {
    ...state,
    filters,
    setFilters,
    setPage,
    refresh,
  };
}

export interface UseAdminUserState {
  user: AdminUser | null;
  isLoading: boolean;
  error: string | null;
}

export interface UseAdminUserResult extends UseAdminUserState {
  refresh: () => Promise<void>;
  setUser: (user: AdminUser | null) => void;
}

export function useAdminUser(userId: string | null): UseAdminUserResult {
  const client = useIdentityClient();
  const [state, setState] = useState<UseAdminUserState>({
    user: null,
    isLoading: false,
    error: null,
  });

  const fetchUser = useCallback(
    async (id: string) => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));
      try {
        const result = await client.adminGetUser({ params: { id } });
        setState({
          user: result,
          isLoading: false,
          error: null,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to load user';
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: errorMessage,
        }));
      }
    },
    [client],
  );

  useEffect(() => {
    if (userId !== null && userId !== '') {
      queueMicrotask(() => {
        void fetchUser(userId);
      });
    } else {
      queueMicrotask(() => {
        setState({ user: null, isLoading: false, error: null });
      });
    }
  }, [userId, fetchUser]);

  const refresh = useCallback(async () => {
    if (userId !== null && userId !== '') {
      await fetchUser(userId);
    }
  }, [userId, fetchUser]);

  const setUser = useCallback((user: AdminUser | null) => {
    setState((prev) => ({ ...prev, user }));
  }, []);

  return {
    ...state,
    refresh,
    setUser,
  };
}

export interface UseUserActionsState {
  isUpdating: boolean;
  isLocking: boolean;
  isUnlocking: boolean;
  isForcingLogout: boolean;
  isHardBanning: boolean;
  isDeleting: boolean;
  isCreating: boolean;
  isResettingPassword: boolean;
  error: string | null;
  lastAction:
    | 'update'
    | 'lock'
    | 'unlock'
    | 'forceLogout'
    | 'hardBan'
    | 'delete'
    | 'create'
    | 'resetPassword'
    | null;
}

export interface UseUserActionsResult extends UseUserActionsState {
  updateUserAction: (
    userId: string,
    data: AdminUpdateUserRequest,
  ) => Promise<AdminUpdateUserResponse | null>;
  lockUserAction: (
    userId: string,
    data: AdminLockUserRequest,
  ) => Promise<AdminLockUserResponse | null>;
  unlockUserAction: (userId: string, reason: string) => Promise<AdminLockUserResponse | null>;
  forceLogoutUserAction: (
    userId: string,
    reason: string,
  ) => Promise<AdminForceLogoutResponse | null>;
  hardBanUserAction: (
    userId: string,
    data: AdminHardBanRequest,
    sudoToken: string,
  ) => Promise<AdminHardBanResponse | null>;
  deleteUserAction: (
    userId: string,
    data: AdminDeleteUserRequest,
    sudoToken: string,
  ) => Promise<AdminActionResponse | null>;
  createUserAction: (data: AdminCreateUserRequest) => Promise<AdminActionResponse | null>;
  resetPasswordAction: (userId: string, reason: string) => Promise<AdminActionResponse | null>;
  clearError: () => void;
}

export function useUserActions(): UseUserActionsResult {
  const client = useIdentityClient();
  const [state, setState] = useState<UseUserActionsState>({
    isUpdating: false,
    isLocking: false,
    isUnlocking: false,
    isForcingLogout: false,
    isHardBanning: false,
    isDeleting: false,
    isCreating: false,
    isResettingPassword: false,
    error: null,
    lastAction: null,
  });

  const updateUserAction = useCallback(
    async (
      userId: string,
      data: AdminUpdateUserRequest,
    ): Promise<AdminUpdateUserResponse | null> => {
      setState((prev) => ({ ...prev, isUpdating: true, error: null }));
      try {
        const result = await client.adminUpdateUser({ params: { id: userId }, body: data });
        setState((prev) => ({ ...prev, isUpdating: false, lastAction: 'update' }));
        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to update user';
        setState((prev) => ({ ...prev, isUpdating: false, error: errorMessage }));
        return null;
      }
    },
    [client],
  );

  const lockUserAction = useCallback(
    async (userId: string, data: AdminLockUserRequest): Promise<AdminLockUserResponse | null> => {
      setState((prev) => ({ ...prev, isLocking: true, error: null }));
      try {
        const result = await client.adminLockUser({ params: { id: userId }, body: data });
        setState((prev) => ({ ...prev, isLocking: false, lastAction: 'lock' }));
        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to lock user';
        setState((prev) => ({ ...prev, isLocking: false, error: errorMessage }));
        return null;
      }
    },
    [client],
  );

  const unlockUserAction = useCallback(
    async (userId: string, reason: string): Promise<AdminLockUserResponse | null> => {
      setState((prev) => ({ ...prev, isUnlocking: true, error: null }));
      try {
        const result = await client.adminUnlockUser({ params: { id: userId }, body: { reason } });
        setState((prev) => ({ ...prev, isUnlocking: false, lastAction: 'unlock' }));
        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to unlock user';
        setState((prev) => ({ ...prev, isUnlocking: false, error: errorMessage }));
        return null;
      }
    },
    [client],
  );

  const forceLogoutUserAction = useCallback(
    async (userId: string, reason: string): Promise<AdminForceLogoutResponse | null> => {
      setState((prev) => ({ ...prev, isForcingLogout: true, error: null }));
      try {
        const result = await client.adminForceLogoutUser({
          params: { id: userId },
          body: { reason },
        });
        setState((prev) => ({ ...prev, isForcingLogout: false, lastAction: 'forceLogout' }));
        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to force-logout user';
        setState((prev) => ({ ...prev, isForcingLogout: false, error: errorMessage }));
        return null;
      }
    },
    [client],
  );

  const hardBanUserAction = useCallback(
    async (
      userId: string,
      data: AdminHardBanRequest,
      sudoToken: string,
    ): Promise<AdminHardBanResponse | null> => {
      setState((prev) => ({ ...prev, isHardBanning: true, error: null }));
      try {
        const result = await client.adminHardBanUser(
          { params: { id: userId }, body: data },
          { headers: { 'x-sudo-token': sudoToken } },
        );
        setState((prev) => ({ ...prev, isHardBanning: false, lastAction: 'hardBan' }));
        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to hard ban user';
        setState((prev) => ({ ...prev, isHardBanning: false, error: errorMessage }));
        return null;
      }
    },
    [client],
  );

  const deleteUserAction = useCallback(
    async (
      userId: string,
      data: AdminDeleteUserRequest,
      sudoToken: string,
    ): Promise<AdminActionResponse | null> => {
      setState((prev) => ({ ...prev, isDeleting: true, error: null }));
      try {
        const result = await client.adminDeleteUser(
          { params: { id: userId }, body: data },
          { headers: { 'x-sudo-token': sudoToken } },
        );
        setState((prev) => ({ ...prev, isDeleting: false, lastAction: 'delete' }));
        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to delete user';
        setState((prev) => ({ ...prev, isDeleting: false, error: errorMessage }));
        return null;
      }
    },
    [client],
  );

  const createUserAction = useCallback(
    async (data: AdminCreateUserRequest): Promise<AdminActionResponse | null> => {
      setState((prev) => ({ ...prev, isCreating: true, error: null }));
      try {
        const result = await client.adminCreateUser({ body: data });
        setState((prev) => ({ ...prev, isCreating: false, lastAction: 'create' }));
        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to create user';
        setState((prev) => ({ ...prev, isCreating: false, error: errorMessage }));
        return null;
      }
    },
    [client],
  );

  const resetPasswordAction = useCallback(
    async (userId: string, reason: string): Promise<AdminActionResponse | null> => {
      setState((prev) => ({ ...prev, isResettingPassword: true, error: null }));
      try {
        const result = await client.adminResetUserPassword({
          params: { id: userId },
          body: { reason },
        });
        setState((prev) => ({
          ...prev,
          isResettingPassword: false,
          lastAction: 'resetPassword',
        }));
        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to reset user password';
        setState((prev) => ({ ...prev, isResettingPassword: false, error: errorMessage }));
        return null;
      }
    },
    [client],
  );

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  return {
    ...state,
    updateUserAction,
    lockUserAction,
    unlockUserAction,
    forceLogoutUserAction,
    hardBanUserAction,
    deleteUserAction,
    createUserAction,
    resetPasswordAction,
    clearError,
  };
}

// ============================================================================
// 4. Sudo, Devices, Phone, TOTP, Backup Codes & Passkey Hooks
// ============================================================================

export interface UseSudoOptions {
  onSuccess?: (response: SudoResponse) => void;
  onError?: (error: Error) => void;
}

export interface UseSudoResult {
  sudo: (data: SudoRequest) => void;
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: Error | null;
  data: SudoResponse | null;
  reset: () => void;
}

export function useSudo(options?: UseSudoOptions): UseSudoResult {
  const client = useIdentityClient();
  const mutation = useEndpointMutation(client.sudo, {
    onSuccess: (response) => {
      options?.onSuccess?.(response);
    },
    onError: (error) => {
      options?.onError?.(error);
    },
  });

  const sudo = useCallback(
    (data: SudoRequest): void => {
      mutation.mutate({ body: data });
    },
    [mutation],
  );

  return {
    sudo,
    isLoading: mutation.status === 'pending',
    isSuccess: mutation.status === 'success',
    isError: mutation.status === 'error',
    error: mutation.error,
    data: mutation.data ?? null,
    reset: mutation.reset,
  };
}

export interface UseDevicesOptions {
  autoFetch?: boolean;
}

export interface DevicesState {
  devices: DeviceItem[];
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  trustDevice: (deviceId: string) => Promise<{ device: DeviceItem }>;
  revokeDevice: (deviceId: string) => Promise<{ message: string }>;
  invalidateSessions: () => Promise<{ message: string }>;
}

export function useDevices(options?: UseDevicesOptions): DevicesState {
  const autoFetch = options?.autoFetch ?? true;
  const client = useIdentityClient();
  const listKey = useMemo(() => endpointQueryKey(client.listDevices), [client]);
  const query = useEndpoint(client.listDevices, undefined, {
    enabled: autoFetch,
    retry: 0,
  });

  const trustMutation = useMutation<{ device: DeviceItem }, Error, string>({
    mutationFn: (deviceId: string) => client.trustDevice({ params: { id: deviceId }, body: {} }),
    invalidateOnSuccess: [listKey],
  });

  const revokeMutation = useMutation<{ message: string }, Error, string>({
    mutationFn: (deviceId: string) => client.revokeDevice({ params: { id: deviceId }, body: {} }),
    invalidateOnSuccess: [listKey],
  });

  const invalidateSessionsMutation = useMutation<{ message: string }, Error, undefined>({
    mutationFn: () => client.invalidateSessions({ body: {} }),
  });

  return {
    devices: query.data?.devices ?? [],
    isLoading: query.isLoading,
    error:
      query.error ??
      trustMutation.error ??
      revokeMutation.error ??
      invalidateSessionsMutation.error ??
      null,
    refresh: query.refetch,
    trustDevice: trustMutation.mutateAsync,
    revokeDevice: revokeMutation.mutateAsync,
    invalidateSessions: () => invalidateSessionsMutation.mutateAsync(undefined),
  };
}

export interface PhoneState {
  isLoading: boolean;
  error: Error | null;
  setPhone: (phone: string) => Promise<{ message: string }>;
  verifyPhone: (code: string) => Promise<VerifyPhoneResponse>;
  removePhone: () => Promise<void>;
}

export function usePhone(): PhoneState {
  const client = useIdentityClient();

  const setPhoneMutation = useMutation<{ message: string }, Error, string>({
    mutationFn: (phone: string) => client.setPhone({ body: { phone } }),
  });

  const verifyPhoneMutation = useMutation<VerifyPhoneResponse, Error, string>({
    mutationFn: (code: string) => client.verifyPhone({ body: { code } }),
  });

  const removePhoneMutation = useMutation<{ message: string }, Error, undefined>({
    mutationFn: () => client.removePhone({ body: {} }),
  });

  return {
    isLoading:
      setPhoneMutation.isPending || verifyPhoneMutation.isPending || removePhoneMutation.isPending,
    error: setPhoneMutation.error ?? verifyPhoneMutation.error ?? removePhoneMutation.error ?? null,
    setPhone: setPhoneMutation.mutateAsync,
    verifyPhone: verifyPhoneMutation.mutateAsync,
    removePhone: async (): Promise<void> => {
      await removePhoneMutation.mutateAsync(undefined);
    },
  };
}

export type TotpState = 'loading' | 'enabled' | 'disabled' | 'setup-in-progress';

export interface UseTotpManagementResult {
  state: TotpState;
  error: string | null;
  isLoading: boolean;
  setupData: TotpSetupResponse | null;
  beginSetup: () => Promise<void>;
  enable: (code: string) => Promise<void>;
  disable: (code: string) => Promise<void>;
  refresh: () => Promise<void>;
  cancelSetup: () => void;
}

export function useTotpManagement(): UseTotpManagementResult {
  const client = useIdentityClient();
  const [state, setState] = useState<TotpState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [setupData, setSetupData] = useState<TotpSetupResponse | null>(null);

  const fetchStatus = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await client.totpStatus();
      setState(result.enabled ? 'enabled' : 'disabled');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to check 2FA status';
      setError(message);
      setState('disabled');
    } finally {
      setIsLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const beginSetup = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await client.totpSetup({ body: {} });
      setSetupData(result);
      setState('setup-in-progress');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start 2FA setup';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [client]);

  const enable = useCallback(
    async (code: string): Promise<void> => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await client.totpEnable({ body: { code } });
        if ('message' in result && typeof result.message === 'string') {
          setState('enabled');
          setSetupData(null);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to enable 2FA';
        setError(message);
      } finally {
        setIsLoading(false);
      }
    },
    [client],
  );

  const disable = useCallback(
    async (code: string): Promise<void> => {
      setIsLoading(true);
      setError(null);
      try {
        await client.totpDisable({ body: { code } });
        setState('disabled');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to disable 2FA';
        setError(message);
      } finally {
        setIsLoading(false);
      }
    },
    [client],
  );

  const cancelSetup = useCallback((): void => {
    setState('disabled');
    setSetupData(null);
    setError(null);
  }, []);

  return {
    state,
    error,
    isLoading,
    setupData,
    beginSetup,
    enable,
    disable,
    refresh: fetchStatus,
    cancelSetup,
  };
}

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
  const client = useIdentityClient();
  const [status, setStatus] = useState<BackupCodesStatusResponse | null>(null);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      setStatus(await client.backupCodesStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load backup code status');
    } finally {
      setIsLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const regenerate = useCallback(
    async (code: string): Promise<void> => {
      setIsRegenerating(true);
      setError(null);
      try {
        const result: BackupCodesRegenerateResponse = await client.backupCodesRegenerate({
          body: { code },
        });
        setNewCodes(result.backupCodes);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to regenerate backup codes');
      } finally {
        setIsRegenerating(false);
      }
    },
    [client, refresh],
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

export interface PasskeysState {
  passkeys: PasskeyListItem[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export function usePasskeys(): PasskeysState {
  const client = useIdentityClient();
  const [passkeys, setPasskeys] = useState<PasskeyListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await client.listPasskeys();
      setPasskeys(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load passkeys');
    } finally {
      setIsLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const rename = useCallback(
    async (id: string, name: string): Promise<void> => {
      await client.renamePasskey({ params: { id }, body: { name } });
      await refetch();
    },
    [client, refetch],
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      await client.deletePasskey({ params: { id }, body: {} });
      await refetch();
    },
    [client, refetch],
  );

  return { passkeys, isLoading, error, refetch, rename, remove };
}

export interface RegisterPasskeyState {
  register: (name?: string) => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

export function useRegisterPasskey(onSuccess?: () => void): RegisterPasskeyState {
  const client = useIdentityClient();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const register = useCallback(
    async (name?: string): Promise<void> => {
      setIsLoading(true);
      setError(null);
      try {
        const { options } = await client.webauthnRegisterOptions({ body: {} });
        const credential = (await createPasskey(
          options as unknown as PasskeyCreationOptionsJSON,
        )) as unknown as WebauthnRegisterVerifyRequest['credential'];
        await client.webauthnRegisterVerify({
          body: name !== undefined ? { credential, name } : { credential },
        });
        onSuccess?.();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Registration failed';
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [client, onSuccess],
  );

  return { register, isLoading, error };
}

// ============================================================================
// 5. OAuth & Auth Strategy Hooks
// ============================================================================

interface EnabledAuthStrategiesState {
  readonly isLoading: boolean;
  readonly enabled: AuthStrategy[];
  readonly disabled: AuthStrategy[];
  readonly error: Error | null;
  readonly refresh: () => Promise<void>;
}

function isAuthStrategy(value: string): value is AuthStrategy {
  return (AUTH_STRATEGIES as readonly string[]).includes(value);
}

export function useEnabledAuthStrategies(): EnabledAuthStrategiesState {
  const client = useIdentityClient();
  const query = useEndpoint(client.authStrategies, undefined, { retry: 0 });

  return {
    enabled: query.data?.enabled ? query.data.enabled.filter(isAuthStrategy) : [],
    disabled: query.data?.disabled ? query.data.disabled.filter(isAuthStrategy) : [],
    isLoading: query.isLoading,
    error: query.error,
    refresh: query.refetch,
  };
}

interface EnabledOAuthProvidersState {
  readonly isLoading: boolean;
  readonly providers: OAuthProvider[];
  readonly error: Error | null;
  readonly refresh: () => Promise<void>;
}

export function useEnabledOAuthProviders(): EnabledOAuthProvidersState {
  const client = useIdentityClient();
  const query = useEndpoint(client.getEnabledProviders, undefined, { retry: 0 });

  return {
    providers: query.data?.providers ? [...query.data.providers] : [],
    isLoading: query.isLoading,
    error: query.error,
    refresh: query.refetch,
  };
}

interface OAuthConnectionsState {
  readonly isLoading: boolean;
  readonly isActing: boolean;
  readonly connections: OAuthConnectionItem[];
  readonly error: Error | null;
  readonly unlink: (provider: OAuthProvider) => Promise<void>;
  readonly link: (provider: OAuthProvider) => Promise<string>;
  readonly getLinkUrl: (provider: OAuthProvider) => string;
  readonly refresh: () => Promise<void>;
}

export function useOAuthConnections(): OAuthConnectionsState {
  const client = useIdentityClient();
  const listKey = useMemo(() => endpointQueryKey(client.getConnections), [client]);
  const query = useEndpoint(client.getConnections, undefined, { retry: 0 });

  const linkMutation = useMutation<{ url: string }, Error, OAuthProvider>({
    mutationFn: (provider: OAuthProvider) => {
      switch (provider) {
        case 'google':
          return client.linkGoogle({ body: {} });
        case 'github':
          return client.linkGithub({ body: {} });
        case 'apple':
          return client.linkApple({ body: {} });
      }
    },
  });

  const unlinkMutation = useMutation<{ message: string }, Error, OAuthProvider>({
    mutationFn: (provider: OAuthProvider) => {
      switch (provider) {
        case 'google':
          return client.unlinkGoogle({ body: {} });
        case 'github':
          return client.unlinkGithub({ body: {} });
        case 'apple':
          return client.unlinkApple({ body: {} });
      }
    },
    invalidateOnSuccess: [listKey],
  });

  const unlink = useCallback(
    async (provider: OAuthProvider): Promise<void> => {
      await unlinkMutation.mutateAsync(provider);
    },
    [unlinkMutation],
  );

  const link = useCallback(
    async (provider: OAuthProvider): Promise<string> => {
      const response = await linkMutation.mutateAsync(provider);
      return response.url;
    },
    [linkMutation],
  );

  const getLinkUrl = useCallback(
    (provider: OAuthProvider): string => `/api/auth/oauth/${provider}/link`,
    [],
  );

  return {
    connections: query.data?.connections ? [...query.data.connections] : [],
    isLoading: query.isLoading,
    isActing: unlinkMutation.isPending || linkMutation.isPending,
    error: query.error ?? unlinkMutation.error ?? linkMutation.error ?? null,
    unlink,
    link,
    getLinkUrl,
    refresh: query.refetch,
  };
}

export function getOAuthLoginUrl(
  baseUrl: string,
  provider: OAuthProvider,
  eligibilityAttested = false,
): string {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const url = `${normalizedBase}/api/auth/oauth/${provider}`;
  return eligibilityAttested ? `${url}?attested=true&consented=true` : url;
}

// ============================================================================
// 6. Email Change, Password Setup/Forgot & Global Logout Hooks
// ============================================================================

export function useLogoutAll(): () => Promise<{ message: string }> {
  const client = useIdentityClient();
  return useCallback(() => client.logoutAll({ body: {} }), [client]);
}

export function useChangeEmail(): (data: ChangeEmailRequest) => Promise<ChangeEmailResponse> {
  const client = useIdentityClient();
  return useCallback((data: ChangeEmailRequest) => client.changeEmail({ body: data }), [client]);
}

export function useConfirmEmailChange(): (
  data: ConfirmEmailChangeRequest,
) => Promise<ConfirmEmailChangeResponse> {
  const client = useIdentityClient();
  return useCallback(
    (data: ConfirmEmailChangeRequest) => client.confirmEmailChange({ body: data }),
    [client],
  );
}

export function useRevertEmailChange(): (
  data: RevertEmailChangeRequest,
) => Promise<RevertEmailChangeResponse> {
  const client = useIdentityClient();
  return useCallback(
    (data: RevertEmailChangeRequest) => client.revertEmailChange({ body: data }),
    [client],
  );
}

export function useSetPassword(): (data: SetPasswordRequest) => Promise<SetPasswordResponse> {
  const client = useIdentityClient();
  return useCallback((data: SetPasswordRequest) => client.setPassword({ body: data }), [client]);
}

export function useForgotPassword(): (
  data: ForgotPasswordRequest,
) => Promise<ForgotPasswordResponse> {
  const client = useIdentityClient();
  return useCallback(
    (data: ForgotPasswordRequest) => client.forgotPassword({ body: data }),
    [client],
  );
}
