// main/kernel/client/src/index.ts

// Query Cache Persistence
export {
  clearQueryCache,
  createPersistedClientFromQueryCache,
  createQueryPersister,
  restorePersistedQueryCache,
  type PersistedClient,
  type PersistedClientState,
  type PersistedQuery,
  type Persister,
  type QueryPersisterOptions,
} from './storage';
export { clear, createStore, del, get, keys, set, type IDBStore } from './storage';
export { idbStorage, localStorageQueue, type StorageAdapter } from './storage';
// Per-user client storage isolation (clear-on-switch + per-user namespacing)
export {
  USER_SCOPED_LOCAL_KEYS,
  clearUserScopedLocalStorage,
  createUserScopedStorage,
  registerUserScopedReset,
  runUserScopedResets,
  userScopedKey,
  type UserScopedStorage,
} from './storage';

// Query Cache
export { hashQueryKey, QueryCache, queryKeysEqual } from './query';
export type {
  FetchStatus,
  QueryCacheOptions,
  QueryKey,
  QueryState,
  QueryStatus,
  SetQueryDataOptions,
} from './query';

// Theme
export {
  DEFAULT_CONTRAST_MODE,
  DEFAULT_DENSITY,
  THEME_STORAGE_KEYS,
  densityMultipliers,
  getContrastCssVariables,
  getDensityCssVariables,
  getSpacingForDensity,
  highContrastDarkOverrides,
  highContrastLightOverrides,
  type ContrastMode,
  type Density,
} from './theme';

// Transport & Contract Endpoint Client
export {
  addAuthHeader,
  ApiError,
  clearCsrfTokenCache,
  createApiError,
  createTokenStore,
  clearRequirementHandlers,
  createEndpointClient,
  createPersistAllowlist,
  createTransport,
  getTransportCsrfToken,
  getErrorMessage,
  isApiError,
  isAuthenticationError,
  isHttpStatusError,
  isNetworkError,
  isTimeoutError,
  NetworkError,
  registerRequirementHandler,
  requestRealtimeTicket,
  setDefaultOnUnauthorized,
  setDefaultTenantIdGetter,
  TimeoutError,
  tokenStore,
  type EndpointCall,
  type EndpointCallMeta,
  type EndpointClient,
  type EndpointClientInput,
  type RequirementInterceptor,
  type RequirementInterceptorHandler,
  type Transport,
  type TransportConfig,
  type TransportErrorBody,
  type TokenStore,
  type TransportRequestOptions,
} from './transport';

// Resumable Upload Client
export {
  ResumableUploadError,
  uploadFileResumable,
  type PartUploadTarget,
  type ResumableUploadOptions,
  type ResumableUploadProgress,
  type UploadedPartRef,
  type UploadSessionDescriptor,
} from './upload/resumable-upload';

// UI / Keyboard
export {
  formatKeyBinding,
  isEditableElement,
  isMac,
  matchesAnyBinding,
  matchesKeyBinding,
  matchesModifiers,
  parseKeyBinding,
  type KeyModifiers,
  type ParsedKeyBinding,
} from './ui';
