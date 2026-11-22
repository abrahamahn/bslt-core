// main/kernel/server/src/config/env/env.notification.ts
/**
 * Notification Environment Configuration
 *
 * Notification types, provider schemas, env interface, and validation schema.
 * Merged from config/types/services.ts (notification section),
 * config/types/notification.ts, and config/env.ts.
 *
 * @module config/env.notification
 */

import { boolean, defaulted, enumOf, object, optional, string, unknown } from '@bslt/schema';

import { trueFalseSchema } from './env.base';

import type { Schema } from '@bslt/schema';

// ============================================================================
// Types
// ============================================================================

/**
 * OneSignal push notification configuration.
 * Used for mobile and web push notifications.
 */
export interface OneSignalConfig {
  /** OneSignal REST API key */
  restApiKey: string;
  /** OneSignal user authentication key */
  userAuthKey: string;
  /** OneSignal app ID */
  appId: string;
  /** Optional: Additional settings */
  settings?:
    | {
        /** Whether to enable logging */
        enableLogging?: boolean | undefined;
      }
    | undefined;
}

/**
 * Courier push notification configuration.
 * Used for multi-channel notifications via Courier platform.
 */
export interface CourierConfig {
  /** Courier API key */
  apiKey: string;
  /** Courier API URL */
  apiUrl?: string | undefined;
  /** Optional: Additional settings */
  settings?:
    | {
        /** Whether to enable logging */
        enableLogging?: boolean | undefined;
      }
    | undefined;
}

/**
 * Knock push notification configuration.
 * Used for multi-channel notifications via Knock platform.
 */
interface KnockConfig {
  /** Knock secret key */
  secretKey: string;
  /** Knock API URL */
  apiUrl?: string | undefined;
  /** Optional: Additional settings */
  settings?:
    | {
        /** Whether to enable logging */
        enableLogging?: boolean | undefined;
      }
    | undefined;
}

/**
 * Amazon SNS configuration.
 * Used for high-volume push notifications.
 */
interface SnsConfig {
  /** AWS Access Key ID */
  accessKeyId: string;
  /** AWS Secret Access Key */
  secretAccessKey: string;
  /** AWS Region */
  region: string;
  /** SNS Topic ARN (optional) */
  topicArn?: string | undefined;
}

/**
 * Braze configuration.
 * Used for marketing and engagement notifications.
 */
interface BrazeConfig {
  /** Braze API key */
  apiKey: string;
  /** Braze API URL */
  apiUrl: string;
  /** Optional: Additional settings */
  settings?:
    | {
        /** Whether to enable logging */
        enableLogging?: boolean | undefined;
      }
    | undefined;
}

/**
 * Generic push notification configuration.
 * Used for custom notification implementations.
 */
interface GenericNotificationConfig {
  /** Provider-specific configuration */
  [key: string]: unknown;
}

/** Push notification provider type. */
export type NotificationProvider = 'onesignal' | 'courier' | 'knock' | 'sns' | 'braze' | 'generic';

/**
 * Push notifications configuration.
 * Supports multiple providers for flexibility.
 */
export interface NotificationConfig {
  /** Enable push notifications */
  enabled: boolean;
  /** Active push notification provider */
  provider: NotificationProvider;
  /** Provider-specific configuration */
  config:
    | OneSignalConfig
    | CourierConfig
    | KnockConfig
    | SnsConfig
    | BrazeConfig
    | GenericNotificationConfig;
}

// ============================================================================
// Provider Config Schemas
// ============================================================================

const providerSettingsSchema = object(
  {
    enableLogging: optional(boolean({ label: 'enableLogging' })),
  },
  { unknownKeys: 'strip' },
);

export const OneSignalSchema: Schema<OneSignalConfig> = object(
  {
    restApiKey: string({ min: 1, label: 'restApiKey' }),
    userAuthKey: string({ min: 1, label: 'userAuthKey' }),
    appId: string({ min: 1, label: 'appId' }),
    settings: optional(providerSettingsSchema),
  },
  { unknownKeys: 'strip' },
);

export const CourierSchema: Schema<CourierConfig> = object(
  {
    apiKey: string({ min: 1, label: 'apiKey' }),
    apiUrl: optional(string({ label: 'apiUrl' })),
    settings: optional(providerSettingsSchema),
  },
  { unknownKeys: 'strip' },
);

export const KnockSchema: Schema<KnockConfig> = object(
  {
    secretKey: string({ min: 1, label: 'secretKey' }),
    apiUrl: optional(string({ label: 'apiUrl' })),
    settings: optional(providerSettingsSchema),
  },
  { unknownKeys: 'strip' },
);

export const SnsSchema: Schema<SnsConfig> = object(
  {
    accessKeyId: string({ min: 1, label: 'accessKeyId' }),
    secretAccessKey: string({ min: 1, label: 'secretAccessKey' }),
    region: defaulted(string({ min: 1, label: 'region' }), 'us-east-1'),
    topicArn: optional(string({ label: 'topicArn' })),
  },
  { unknownKeys: 'strip' },
);

export const BrazeSchema: Schema<BrazeConfig> = object(
  {
    apiKey: string({ min: 1, label: 'apiKey' }),
    apiUrl: string({ min: 1, label: 'apiUrl' }),
    settings: optional(providerSettingsSchema),
  },
  { unknownKeys: 'strip' },
);

// ============================================================================
// Notification Provider Schema
// ============================================================================

/** Valid notification provider values for schema-level validation */
const NOTIFICATION_SCHEMA_PROVIDERS = ['onesignal', 'courier', 'generic'] as const;

type NotificationSchemaProvider = (typeof NOTIFICATION_SCHEMA_PROVIDERS)[number];

export const NotificationProviderSchema: Schema<NotificationSchemaProvider> = enumOf(
  NOTIFICATION_SCHEMA_PROVIDERS,
  'NOTIFICATIONS_PROVIDER',
);

// ============================================================================
// Notification Config Schema
// ============================================================================

/** Validated notification configuration shape. */
interface NotificationConfigValidated {
  enabled: boolean;
  provider: NotificationSchemaProvider;
  config: unknown;
}

export const NotificationConfigSchema: Schema<NotificationConfigValidated> = object(
  {
    enabled: boolean({ label: 'enabled' }),
    provider: NotificationProviderSchema,
    config: unknown(),
  },
  { unknownKeys: 'strip' },
);

// ============================================================================
// Env Interface
// ============================================================================

/** Valid notification env provider values (superset including all providers) */
const NOTIFICATION_ENV_PROVIDERS = [
  'onesignal',
  'courier',
  'knock',
  'sns',
  'braze',
  'generic',
] as const;

type NotificationEnvProvider = (typeof NOTIFICATION_ENV_PROVIDERS)[number];

/** Parsed notification environment variables. */
export interface NotificationEnv {
  NOTIFICATIONS_PROVIDER?: NotificationEnvProvider | undefined;
  ONESIGNAL_REST_API_KEY?: string | undefined;
  ONESIGNAL_USER_AUTH_KEY?: string | undefined;
  ONESIGNAL_APP_ID?: string | undefined;
  ONESIGNAL_ENABLE_LOGGING?: 'true' | 'false' | undefined;
  COURIER_API_KEY?: string | undefined;
  COURIER_API_URL?: string | undefined;
  COURIER_ENABLE_LOGGING?: 'true' | 'false' | undefined;
  KNOCK_SECRET_KEY?: string | undefined;
  KNOCK_API_URL?: string | undefined;
  KNOCK_ENABLE_LOGGING?: 'true' | 'false' | undefined;
  AWS_SNS_ACCESS_KEY_ID?: string | undefined;
  AWS_SNS_SECRET_ACCESS_KEY?: string | undefined;
  AWS_SNS_REGION?: string | undefined;
  AWS_SNS_TOPIC_ARN?: string | undefined;
  BRAZE_API_KEY?: string | undefined;
  BRAZE_API_URL?: string | undefined;
  BRAZE_ENABLE_LOGGING?: 'true' | 'false' | undefined;
  VAPID_PUBLIC_KEY?: string | undefined;
  VAPID_PRIVATE_KEY?: string | undefined;
  VAPID_SUBJECT?: string | undefined;
}

// ============================================================================
// Env Schema
// ============================================================================

/**
 * Schema for notification environment variables.
 * All fields are optional since the notification system is opt-in.
 */
export const NotificationEnvSchema: Schema<NotificationEnv> = object(
  {
    NOTIFICATIONS_PROVIDER: optional(enumOf(NOTIFICATION_ENV_PROVIDERS, 'NOTIFICATIONS_PROVIDER')),
    ONESIGNAL_REST_API_KEY: optional(string({ label: 'ONESIGNAL_REST_API_KEY' })),
    ONESIGNAL_USER_AUTH_KEY: optional(string({ label: 'ONESIGNAL_USER_AUTH_KEY' })),
    ONESIGNAL_APP_ID: optional(string({ label: 'ONESIGNAL_APP_ID' })),
    ONESIGNAL_ENABLE_LOGGING: optional(trueFalseSchema),
    COURIER_API_KEY: optional(string({ label: 'COURIER_API_KEY' })),
    COURIER_API_URL: optional(string({ label: 'COURIER_API_URL' })),
    COURIER_ENABLE_LOGGING: optional(trueFalseSchema),
    KNOCK_SECRET_KEY: optional(string({ label: 'KNOCK_SECRET_KEY' })),
    KNOCK_API_URL: optional(string({ label: 'KNOCK_API_URL' })),
    KNOCK_ENABLE_LOGGING: optional(trueFalseSchema),
    AWS_SNS_ACCESS_KEY_ID: optional(string({ label: 'AWS_SNS_ACCESS_KEY_ID' })),
    AWS_SNS_SECRET_ACCESS_KEY: optional(string({ label: 'AWS_SNS_SECRET_ACCESS_KEY' })),
    AWS_SNS_REGION: optional(string({ label: 'AWS_SNS_REGION' })),
    AWS_SNS_TOPIC_ARN: optional(string({ label: 'AWS_SNS_TOPIC_ARN' })),
    BRAZE_API_KEY: optional(string({ label: 'BRAZE_API_KEY' })),
    BRAZE_API_URL: optional(string({ label: 'BRAZE_API_URL' })),
    BRAZE_ENABLE_LOGGING: optional(trueFalseSchema),
    VAPID_PUBLIC_KEY: optional(string({ label: 'VAPID_PUBLIC_KEY' })),
    VAPID_PRIVATE_KEY: optional(string({ label: 'VAPID_PRIVATE_KEY' })),
    VAPID_SUBJECT: optional(string({ label: 'VAPID_SUBJECT' })),
  },
  { unknownKeys: 'strip' },
);
