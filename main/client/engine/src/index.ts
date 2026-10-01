// main/client/engine/src/index.ts

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
  densityMultipliers,
  getContrastCssVariables,
  getDensityCssVariables,
  getSpacingForDensity,
  highContrastDarkOverrides,
  highContrastLightOverrides,
  type ContrastMode,
  type Density,
} from './theme';

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
