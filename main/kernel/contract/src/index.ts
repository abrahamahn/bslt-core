// main/kernel/contract/src/index.ts

export {
  ACCESS_TOKEN_COOKIE_NAME,
  API_PREFIX,
  AUTH_CONSTANTS,
  AUTH_STRATEGIES,
  AUTH_VALIDATION,
  CSRF_COOKIE_NAME,
  CSRF_EXEMPT_PATHS,
  DEFAULT_LOCALE,
  DEFAULT_PAGE_LIMIT,
  DEFAULT_SORT_BY,
  DEFAULT_SORT_ORDER,
  LIMITS,
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  MS_PER_SECOND,
  PAGINATION_ERROR_TYPES,
  REFRESH_TOKEN_COOKIE_NAME,
  S3_DEFAULTS,
  SAFE_METHODS,
  SECONDS_PER_DAY,
  SECONDS_PER_MINUTE,
  SUPPORTED_LOCALES,
  type Locale,
} from './constants';

export {
  deserializeCapabilityContext,
  endpoint,
  evaluateAuth,
  evaluateRequirement,
  INTERSTITIAL_REQUIREMENT_CODES,
  isInterstitialRequirementCode,
  mergeCapabilityContributions,
  serializeCapabilityContext,
  serializedCapabilityContextSchema,
  type Auth,
  type CapabilityContext,
  type CapabilityContribution,
  type Endpoint,
  type HttpMethod,
  type InputOf,
  type InterstitialRequirementCode,
  type MergeCapabilityOptions,
  type OutputOf,
  type Requirement,
  type RequirementCode,
  type SerializedCapabilityContext,
  type Viewer,
} from './endpoint';

export { emptyBodySchema, errorResponseSchema, type ErrorWire } from './envelope';

export {
  ERROR_REPORT_LIMITS,
  ERROR_REPORT_SOURCES,
  errorReportBatchSchema,
  maskErrorText,
  sanitizeErrorReport,
  type ErrorReport,
  type ErrorReportSource,
} from './error-report';

export {
  defineErrors,
  ERROR_KINDS,
  kindForStatus,
  lookupErrorCode,
  type ErrorKind,
  type ErrorStatusCode,
  type RegisteredError,
} from './errors';

export { event, type EventDef, type NotifyMeta } from './event';

export {
  AppError,
  AUTH_SUCCESS_MESSAGES,
  AuthenticationError,
  BadRequestError,
  ConflictError,
  ERROR_CODES,
  ERROR_MESSAGES,
  ForbiddenError,
  getKindForStatusCode,
  getStatusCodeForKind,
  HTTP_ERROR_MESSAGES,
  HTTP_STATUS,
  InternalError,
  isAppError,
  normalizeUnknownError,
  NotFoundError,
  RequestSchemaError,
  toErrorWire,
  TooManyRequestsError,
  UnavailableError,
  UnprocessableError,
} from './http-errors';

export { job, type JobDef } from './job';

export {
  defineConfig,
  defineModule,
  mergeModuleCspNeeds,
  PROJECTION_MODULE_IDS,
  validateModule,
  validateModules,
  type BsltConfig,
  type CspNeeds,
  type FlagDef,
  type ModuleDefinition,
  type ModuleId,
} from './module';

export { ASSET_EXPONENTS, assetCodeSchema, moneySchema, type AssetCode, type Money } from './money';

export {
  createOrgBitLookup,
  parsePermissionLockfile,
  validatePermissionLockfile,
  type PermissionLockfile,
} from './permissions';

export {
  SubKeys,
  type AuthenticatedUser,
  type BaseContext,
  type CursorPaginatedResult,
  type CursorPaginationOptions,
  type EmailConfig,
  type EmailOptions,
  type EmailService,
  type ErrorTracker,
  type LocalStorageConfig,
  type NotificationService,
  type PaginatedResult,
  type PaginationOptions,
  type ReadableStreamLike,
  type RequestContext,
  type RequestInfo,
  type S3StorageConfig,
  type SendResult,
  type ServerMessage,
  type SortOrder,
  type StorageClient,
  type StorageConfig,
  type SubscriptionKey,
  type SystemPort,
} from './ports';

export { composeRouter, moduleEndpointsToContract, type ComposedEndpointShape } from './router';

export {
  camelizeKeys,
  camelToSnake,
  canonicalizeEmail,
  capitalize,
  delay,
  escapeHtml,
  generateSecureId,
  snakeifyKeys,
  snakeToCamel,
  trimTrailingSlashes,
} from './strings';
