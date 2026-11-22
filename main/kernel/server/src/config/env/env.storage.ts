// main/kernel/server/src/config/env/env.storage.ts
/**
 * Storage Environment Configuration
 *
 * Storage types, env interface, and validation schema.
 * Merged from config/types/infra.ts (storage section) and config/env.ts.
 *
 * @module config/env.storage
 */

import { defaulted, enumOf, number, object, optional, refine, string } from '@bslt/schema';

import { httpUrlSchema, trueFalseSchema } from './env.base';

import type { Schema } from '@bslt/schema';

// ============================================================================
// Types
// ============================================================================

type StorageProviderName = 'local' | 's3';

/** Base storage configuration shared by all providers. */
interface StorageConfigBase {
  provider: StorageProviderName;
}

/** Local filesystem storage configuration. */
export interface LocalStorageConfig extends StorageConfigBase {
  provider: 'local';
  rootPath: string;
  publicBaseUrl?: string;
  /**
   * Secret (min 32 chars) that local signed URLs are keyed from — the validated
   * auth cookie secret. Shared by the provider (signs) and `/uploads` (verifies).
   */
  signingSecret: string;
}

/** S3-compatible storage configuration. */
export interface S3StorageConfig extends StorageConfigBase {
  provider: 's3';
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucket: string;
  endpoint?: string;
  forcePathStyle: boolean;
  presignExpiresInSeconds: number;
}

export type StorageConfig = LocalStorageConfig | S3StorageConfig;

// ============================================================================
// Env Interface
// ============================================================================

/** Storage environment variables */
export interface StorageEnv {
  STORAGE_PROVIDER: 'local' | 's3';
  STORAGE_ROOT_PATH?: string | undefined;
  STORAGE_PUBLIC_BASE_URL?: string | undefined;
  S3_ACCESS_KEY_ID?: string | undefined;
  S3_SECRET_ACCESS_KEY?: string | undefined;
  S3_BUCKET?: string | undefined;
  S3_REGION?: string | undefined;
  S3_ENDPOINT?: string | undefined;
  S3_FORCE_PATH_STYLE?: 'true' | 'false' | undefined;
  S3_PRESIGN_EXPIRES_IN_SECONDS?: number | undefined;
}

// ============================================================================
// Env Schema
// ============================================================================

function isStoragePublicBaseUrl(parsed: string): boolean {
  if (parsed.startsWith('/')) return true;
  try {
    new URL(parsed);
    return true;
  } catch {
    return false;
  }
}

export const StorageEnvSchema: Schema<StorageEnv> = object(
  {
    STORAGE_PROVIDER: defaulted(enumOf(['local', 's3'] as const, 'STORAGE_PROVIDER'), 'local'),
    STORAGE_ROOT_PATH: optional(string({ label: 'STORAGE_ROOT_PATH' })),
    STORAGE_PUBLIC_BASE_URL: optional(
      refine(
        string({ label: 'STORAGE_PUBLIC_BASE_URL' }),
        isStoragePublicBaseUrl,
        'STORAGE_PUBLIC_BASE_URL must be an absolute URL or absolute path',
      ),
    ),
    S3_ACCESS_KEY_ID: optional(string({ label: 'S3_ACCESS_KEY_ID' })),
    S3_SECRET_ACCESS_KEY: optional(string({ label: 'S3_SECRET_ACCESS_KEY' })),
    S3_BUCKET: optional(string({ label: 'S3_BUCKET' })),
    S3_REGION: optional(string({ label: 'S3_REGION' })),
    S3_ENDPOINT: optional(httpUrlSchema('S3_ENDPOINT')),
    S3_FORCE_PATH_STYLE: optional(trueFalseSchema),
    S3_PRESIGN_EXPIRES_IN_SECONDS: optional(
      number({ coerce: true, label: 'S3_PRESIGN_EXPIRES_IN_SECONDS' }),
    ),
  },
  { unknownKeys: 'strip' },
);
