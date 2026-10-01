// main/shared/src/modules/system/config/env.validation.ts
/**
 * Environment Validation & Combined Schema
 *
 * FullEnv type, EnvSchema, validateEnv, validateProductionGuards, and AppConfig interface.
 *
 * @module config/env.validation
 */

import { createSchema, parseObject } from '../../../schema';

import { AnalyticsEnvSchema } from './env.analytics';
import { AuthEnvSchema } from './env.auth';
import { BaseEnvSchema } from './env.base';
import { BillingEnvSchema } from './env.billing';
import { CacheEnvSchema } from './env.cache';
import { DatabaseEnvSchema } from './env.database';
import { EmailEnvSchema } from './env.email';
import { FrontendEnvSchema } from './env.frontend';
import { getRawEnv } from './env.helpers';
import { NotificationEnvSchema } from './env.notification';
import { PackageManagerEnvSchema } from './env.package.manager';
import { QueueEnvSchema } from './env.queue';
import { RedisEnvSchema } from './env.redis';
import { SearchEnvSchema } from './env.search';
import { ServerEnvSchema } from './env.server';
import { StorageEnvSchema } from './env.storage';
import { TenancyEnvSchema } from './env.tenancy';
import { WebhookEnvSchema } from './env.webhooks';

import type { AnalyticsConfig, AnalyticsEnv } from './env.analytics';
import type { AuthConfig, AuthEnv } from './env.auth';
import type { BaseEnv } from './env.base';
import type { BillingConfig, BillingEnv } from './env.billing';
import type { CacheConfig, CacheEnv } from './env.cache';
import type { DatabaseConfig, DatabaseEnv } from './env.database';
import type { EmailConfig, EmailEnv } from './env.email';
import type { FrontendEnv } from './env.frontend';
import type { NotificationConfig, NotificationEnv } from './env.notification';
import type { PackageManagerConfig, PackageManagerEnv } from './env.package.manager';
import type { QueueConfig, QueueEnv } from './env.queue';
import type { RedisEnv } from './env.redis';
import type { SearchConfig, SearchEnv } from './env.search';
import type { ServerConfig, ServerEnv } from './env.server';
import type { StorageConfig, StorageEnv } from './env.storage';
import type { TenancyConfig, TenancyEnv } from './env.tenancy';
import type { WebhookConfig, WebhookEnv } from './env.webhooks';
import type { Schema } from '../../../schema';

// ============================================================================
// Combined Environment
// ============================================================================

/** Combined environment type containing all validated environment variables. */
export type FullEnv = BaseEnv &
  DatabaseEnv &
  AuthEnv &
  EmailEnv &
  StorageEnv &
  BillingEnv &
  CacheEnv &
  RedisEnv &
  QueueEnv &
  ServerEnv &
  SearchEnv &
  PackageManagerEnv &
  FrontendEnv &
  NotificationEnv &
  AnalyticsEnv &
  TenancyEnv &
  WebhookEnv;

function validateProductionGuards(env: FullEnv): void {
  const isProd = env.NODE_ENV === 'production';

  if (isProd) {
    const hasPostgres =
      (env.DATABASE_URL !== undefined && env.DATABASE_URL !== '') ||
      (env.POSTGRES_HOST !== undefined &&
        env.POSTGRES_USER !== undefined &&
        env.POSTGRES_PASSWORD !== undefined);

    if (!hasPostgres) {
      throw new Error('Production requires a valid database configuration (URL or host/user/pass)');
    }
  }

  if (isProd) {
    const weakPatterns = [
      'secret',
      'password',
      'changeme',
      'change_me',
      'jwt_secret',
      'dev',
      'prod',
      'test',
      'example',
      'placeholder',
    ];
    const lc = env.JWT_SECRET.toLowerCase();
    const isWeak =
      weakPatterns.some((p) => lc === p || lc.includes('change_me') || lc.includes('changeme')) ||
      env.JWT_SECRET.length < 32;
    if (isWeak) {
      throw new Error(
        'Security Risk: JWT_SECRET must be at least 32 characters and not a placeholder in production',
      );
    }
  }

  if (
    env.PUBLIC_API_URL !== undefined &&
    env.PUBLIC_API_URL !== '' &&
    env.VITE_API_URL !== undefined &&
    env.VITE_API_URL !== '' &&
    env.PUBLIC_API_URL !== env.VITE_API_URL
  ) {
    throw new Error(
      'Consistency Error: PUBLIC_API_URL and VITE_API_URL must match if both are provided',
    );
  }

  if (
    env.APP_NAME !== undefined &&
    env.APP_NAME !== '' &&
    env.VITE_APP_NAME !== undefined &&
    env.VITE_APP_NAME !== '' &&
    env.APP_NAME !== env.VITE_APP_NAME
  ) {
    throw new Error(
      'Consistency Error: APP_NAME and VITE_APP_NAME must match if both are provided',
    );
  }
}

function parseAllEnvFields(obj: Record<string, unknown>): FullEnv {
  const base = BaseEnvSchema.parse(obj);
  const database = DatabaseEnvSchema.parse(obj);
  const auth = AuthEnvSchema.parse(obj);
  const email = EmailEnvSchema.parse(obj);
  const storage = StorageEnvSchema.parse(obj);
  const billing = BillingEnvSchema.parse(obj);
  const cache = CacheEnvSchema.parse(obj);
  const redis = RedisEnvSchema.parse(obj);
  const queue = QueueEnvSchema.parse(obj);
  const server = ServerEnvSchema.parse(obj);
  const search = SearchEnvSchema.parse(obj);
  const packageManager = PackageManagerEnvSchema.parse(obj);
  const notifications = NotificationEnvSchema.parse(obj);
  const frontend = FrontendEnvSchema.parse(obj);
  const analytics = AnalyticsEnvSchema.parse(obj);
  const tenancy = TenancyEnvSchema.parse(obj);
  const webhooks = WebhookEnvSchema.parse(obj);

  return {
    ...base,
    ...database,
    ...auth,
    ...email,
    ...storage,
    ...billing,
    ...cache,
    ...redis,
    ...queue,
    ...server,
    ...search,
    ...packageManager,
    ...notifications,
    ...frontend,
    ...analytics,
    ...tenancy,
    ...webhooks,
  };
}

export const EnvSchema: Schema<FullEnv> = createSchema<FullEnv>((data: unknown) => {
  const obj = parseObject(data, 'Environment');
  const env = parseAllEnvFields(obj);
  validateProductionGuards(env);
  return env;
});

// ============================================================================
// Utilities
// ============================================================================

/**
 * Validates environment variables against a schema. Throws on failure.
 *
 * @param schema - The schema to validate against
 * @param rawEnv - Optional env source override (e.g., import.meta.env for Vite clients)
 */
export function validateEnv<T>(schema: Schema<T>, rawEnv?: Record<string, string | undefined>): T {
  const result = schema.safeParse(getRawEnv(rawEnv));

  if (!result.success) {
    const message = `Environment validation failed: ${result.error.message}`;
    throw new Error(message);
  }

  return result.data;
}

export interface AppIdentityConfig {
  name: string;
}

// ============================================================================
// App Config
// ============================================================================

/**
 * Complete application configuration.
 *
 * This is the single source of truth for all server settings.
 * Created by the config factory at startup and passed throughout the app.
 */
export interface AppConfig {
  app: AppIdentityConfig;
  env: 'development' | 'production' | 'test';
  server: ServerConfig;
  database: DatabaseConfig;
  auth: AuthConfig;
  email: EmailConfig;
  storage: StorageConfig;
  billing: BillingConfig;
  cache: CacheConfig;
  queue: QueueConfig;
  notifications: NotificationConfig;
  search: SearchConfig;
  packageManager: PackageManagerConfig;
  analytics: AnalyticsConfig;
  /** Multi-tenant data-isolation strategy. Defaults to shared-RLS. */
  tenancy: TenancyConfig;
  webhooks: WebhookConfig;
}
