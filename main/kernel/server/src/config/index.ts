// main/kernel/server/src/config/index.ts

/**
 * 1. THE BRAIN
 * This is the only way the app should initialize the config.
 */
export { initEnv, load, loadConfig } from './factory';
export type { AppConfig } from './env/env.validation';

/**
 * 2. AUTHENTICATION & SECURITY
 */
export {
  AuthValidationError,
  DEFAULT_JWT_ROTATION_CONFIG,
  DEFAULT_RATE_LIMIT_CONFIG,
  loadAuthConfig,
  loadJwtRotationConfig,
  loadRateLimitConfig,
  validateAuthConfig,
} from './auth';

/**
 * 3. INFRASTRUCTURE
 */
export {
  buildConnectionString,
  buildListenConnectionString,
  buildWorkerConnectionString,
  DEFAULT_CACHE_CONFIG,
  DEFAULT_PACKAGE_MANAGER_CONFIG,
  DEFAULT_QUEUE_CONFIG,
  getSafeConnectionString,
  loadCacheConfig,
  loadDatabaseConfig,
  loadPackageManagerConfig,
  loadQueueConfig,
  loadServerConfig,
  loadStorageConfig,
  validateStorage,
} from './infra';

/**
 * 4. SERVICES
 */
export {
  DEFAULT_NOTIFICATION_CONFIG,
  DEFAULT_SMTP_CONFIG,
  DEFAULT_SQL_SEARCH_CONFIG,
  loadBillingConfig,
  loadEmailConfig,
  loadNotificationsConfig,
  loadSmtpConfig,
  loadSqlSearchConfig,
  validateBillingConfig,
  validateNotificationsConfig,
  validateSqlSearchConfig,
} from './services';
