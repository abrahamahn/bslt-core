// main/shared/src/modules/system/config/index.ts
/**
 * Configuration Schemas and Types
 *
 * This module provides unified environment variable validation and
 * type-safe configuration interfaces for all system services.
 *
 * @module Config
 */

export { AnalyticsEnvSchema } from './env.analytics';
export type { AnalyticsConfig, AnalyticsEnv } from './env.analytics';

export { AuthEnvSchema } from './env.auth';
export type {
  Argon2Config,
  AuthConfig,
  AuthEnv,
  AuthStrategy,
  JwtRotationConfig,
  OAuthProviderConfig,
} from './env.auth';

export { BaseEnvSchema, NODE_ENV_VALUES, trueFalseSchema } from './env.base';
export type { BaseEnv, NodeEnv } from './env.base';

export { BillingEnvSchema } from './env.billing';
export type {
  BillingConfig,
  BillingEnv,
  BillingPlansConfig,
  BillingProvider,
  BillingUrlsConfig,
  PayPalProviderConfig,
  StripeProviderConfig,
} from './env.billing';

export { CacheEnvSchema } from './env.cache';
export type { CacheConfig, CacheEnv } from './env.cache';

export { DatabaseEnvSchema } from './env.database';
export type { DatabaseConfig, DatabaseEnv, DatabaseProvider, PostgresConfig } from './env.database';

export { EmailEnvSchema } from './env.email';
export type { EmailConfig, EmailEnv, SmtpConfig } from './env.email';

export { FrontendEnvSchema } from './env.frontend';
export type { FrontendEnv } from './env.frontend';

export { getRawEnv } from './env.helpers';

export {
  BrazeSchema,
  CourierSchema,
  KnockSchema,
  NotificationConfigSchema,
  NotificationEnvSchema,
  NotificationProviderSchema,
  OneSignalSchema,
  SnsSchema,
} from './env.notification';
export type {
  BrazeConfig,
  CourierConfig,
  GenericNotificationConfig,
  KnockConfig,
  NotificationConfig,
  NotificationConfigValidated,
  NotificationEnv,
  NotificationProvider,
  NotificationProviderConfig,
  NotificationSchemaProvider,
  OneSignalConfig,
  SnsConfig,
} from './env.notification';

export { PackageManagerEnvSchema } from './env.package.manager';
export type {
  NpmConfig,
  PackageManagerConfig,
  PackageManagerEnv,
  PackageManagerProvider,
  PnpmConfig,
  YarnConfig,
} from './env.package.manager';

export { QueueEnvSchema } from './env.queue';
export type { QueueConfig, QueueEnv, QueueProvider } from './env.queue';

export { SearchEnvSchema } from './env.search';
export type {
  SearchConfig,
  SearchEnv,
  SqlColumnMapping,
  SqlSearchConfig,
  SqlSearchProviderConfig,
  SqlTableConfig,
} from './env.search';

export { RedisEnvSchema } from './env.redis';
export type { RedisEnv } from './env.redis';

export { ServerEnvSchema } from './env.server';
export type {
  LogLevel,
  LoggingConfig,
  RateLimitConfig,
  ServerConfig,
  ServerEnv,
} from './env.server';

export { StorageEnvSchema } from './env.storage';
export type {
  LocalStorageConfig,
  S3StorageConfig,
  StorageConfig,
  StorageConfigBase,
  StorageEnv,
  StorageProviderName,
} from './env.storage';

export { TENANCY_MODES, TenancyEnvSchema } from './env.tenancy';
export type { TenancyConfig, TenancyEnv, TenancyMode } from './env.tenancy';

export { WebhookEnvSchema } from './env.webhooks';
export type { WebhookConfig, WebhookEnv } from './env.webhooks';

export { EnvSchema, validateEnv } from './env.validation';
export type { AppConfig, AppIdentityConfig, FullEnv } from './env.validation';
