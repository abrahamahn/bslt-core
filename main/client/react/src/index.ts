// main/client/react/src/index.ts
// React interface logic, hooks, and context

// ============================================================================
// Hooks
// ============================================================================

export {
  useMediaQuery,
  useIsMobile,
  useIsTouch,
  useBreakpoint,
  useBreakpointUp,
  useBreakpointDown,
  BREAKPOINT_ORDER,
  useDisclosure,
  useKeyboardShortcuts,
  useKeyboardShortcut,
  useKeyBindings,
  parseKeyBinding,
  formatKeyBinding,
  useClickOutside,
  useControllableState,
  useDebounce,
  useFormState,
  useLocalStorage,
  useLocalStorageValue,
  useResendCooldown,
  useWindowSize,
  useOnScreen,
  usePanelConfig,
  useThemeMode,
  useDensity,
  useContrast,
  useCopyToClipboard,
  useHistoryNav,
  HistoryProvider,
  useDelayedFlag,
  useVirtualScroll,
  VirtualScrollList,
  usePaginatedQuery,
  useOffsetPaginatedQuery,
  useAuthModeNavigation,
  useSidePeek,
  useFocusReturn,
  useRouteFocusAnnounce,
} from './hooks';
export type {
  ActiveBreakpoint,
  BreakpointKey,
  KeyModifiers,
  KeyboardShortcutOptions,
  ParsedKeyBinding,
  FormState,
  UseResendCooldownReturn,
  UseDensityReturn,
  UseContrastReturn,
  HistoryContextValue,
  VirtualScrollOptions,
  VirtualScrollItem,
  VirtualScrollResult,
  VirtualScrollListProps,
  UsePaginatedQueryOptions,
  UsePaginatedQueryResult,
  UseOffsetPaginatedQueryOptions,
  UseOffsetPaginatedQueryResult,
  AuthMode,
  AuthModeNavigation,
  AuthModeNavigationOptions,
  UseSidePeekResult,
  UseFocusReturnOptions,
  UseFocusReturnResult,
  UseRouteFocusAnnounceOptions,
} from './hooks';

// ============================================================================
// Router
// ============================================================================

export {
  MemoryRouter,
  Router,
  Router as BrowserRouter,
  RouterContext,
  useHistory,
  useNavigationType,
  useLocation,
  useNavigate,
  useSearchParams,
  Link,
  Navigate,
  Outlet,
  OutletProvider,
  Route,
  Routes,
  useParams,
} from './router';
export type {
  History,
  MemoryRouterProps,
  NavigateFunction,
  NavigateOptions,
  NavigationType,
  RouterContextValue,
  RouterLocation,
  RouterProps,
  RouterState,
  LinkProps,
  NavigateProps,
  OutletProviderProps,
  RouteProps,
  RoutesProps,
} from './router';

// ============================================================================
// Stores
// ============================================================================

export { createStore, toastStore } from './stores';
export type { StoreApi, UseBoundStore, ToastMessage, ToastTone } from './stores';

// ============================================================================
// Components
// ============================================================================

export { LiveRegion, useAnnounce } from './components';
export type { AnnouncePoliteness, LiveRegionProps, UseAnnounceResult } from './components';

// ============================================================================
// Utils
// ============================================================================

export { createFormHandler } from './utils';
export type { FormHandlerOptions } from './utils';

// ============================================================================
// Forms (schema-driven)
// ============================================================================

export { useSchemaForm } from './forms';
export type {
  FieldProps,
  FieldSchemas,
  FormValues,
  SchemaForm,
  UseSchemaFormOptions,
} from './forms';

// ============================================================================
// Query
// ============================================================================

export {
  QueryCacheProvider,
  useQueryCache,
  useQuery,
  useMutation,
  useInfiniteQuery,
} from './query';
export type {
  QueryCacheProviderProps,
  UseQueryOptions,
  UseQueryResult,
  MutationStatus,
  UseMutationOptions,
  UseMutationResult,
  InfiniteData,
  InfinitePageParam,
  UseInfiniteQueryOptions,
  UseInfiniteQueryResult,
} from './query';

// ============================================================================
// Devices
// ============================================================================

export { devicesQueryKeys, useDevices } from './devices';
export type { DevicesState, UseDevicesOptions } from './devices';

// ============================================================================
// Phone
// ============================================================================

export { usePhone } from './phone';
export type { PhoneState, UsePhoneOptions } from './phone';

// ============================================================================
// OAuth
// ============================================================================

export {
  getOAuthLoginUrl,
  oauthQueryKeys,
  useEnabledAuthStrategies,
  useEnabledOAuthProviders,
  useOAuthConnections,
} from './oauth';
export type {
  EnabledAuthStrategiesState,
  EnabledOAuthProvidersState,
  OAuthClientConfig,
  OAuthConnectionsState,
} from './oauth';

// ============================================================================
// Legal
// ============================================================================

export { legalQueryKeys, useCurrentLegal, usePublishLegal, useUserAgreements } from './legal';
export type {
  CurrentLegalState,
  PublishLegalState,
  UseCurrentLegalOptions,
  UsePublishLegalOptions,
  UseUserAgreementsOptions,
  UserAgreementsState,
} from './legal';

// ============================================================================
// Version
// ============================================================================

export const REACT_LAYER_VERSION = '1.0.0';
