// main/server/system/src/config/infra/storage.ts
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { S3_DEFAULTS } from '@bslt/shared/constants';

import type {
  FullEnv,
  LocalStorageConfig,
  S3StorageConfig,
  StorageConfig,
  StorageProviderName,
} from '@bslt/shared/system/config';

/**
 * Storage Configuration Loader
 *
 * Supports local filesystem (development) and S3-compatible providers (production).
 * Works with AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces.
 */

/**
 * Loads file storage configuration from environment variables.
 */
/**
 * Load File Storage Configuration.
 *
 * **Strategies**:
 * - **Local**: Stores files on disk (default in dev). Root path is configurable.
 * - **S3**: Uses parameters compatible with AWS S3, Cloudflare R2, MinIO, or DigitalOcean Spaces.
 *
 * @param env - Environment variables.
 */
export interface LoadStorageConfigOptions {
  apiBaseUrl?: string;
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/u, '');
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/gu, '');
}

function findRepoRoot(startDir: string): string | null {
  let current = resolve(startDir);

  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(resolve(current, 'pnpm-workspace.yaml'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }

  return null;
}

function resolveStorageRootPath(rawPath: string): string {
  if (isAbsolute(rawPath)) return rawPath;

  const repoRoot = findRepoRoot(process.cwd());
  if (repoRoot !== null && rawPath.startsWith('main/')) {
    return resolve(repoRoot, rawPath);
  }

  return resolve(process.cwd(), rawPath);
}

function resolvePublicBaseUrl(
  rawBaseUrl: string | undefined,
  apiBaseUrl: string | undefined,
): string {
  const base = rawBaseUrl !== undefined && rawBaseUrl !== '' ? rawBaseUrl : '/uploads';
  const normalizedApiBase = apiBaseUrl !== undefined ? trimTrailingSlashes(apiBaseUrl) : '';

  if (base.startsWith('/') && normalizedApiBase !== '') {
    return `${normalizedApiBase}/${trimSlashes(base)}`;
  }

  return base;
}

export function loadStorageConfig(
  env: FullEnv,
  options: LoadStorageConfigOptions = {},
): StorageConfig {
  const provider = env.STORAGE_PROVIDER as StorageProviderName;

  if (provider === 's3') {
    const config: S3StorageConfig = {
      provider: 's3',
      bucket: env.S3_BUCKET ?? '',
      region: env.S3_REGION ?? '',
      accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
      // Path-style is required for MinIO and some S3-compatible services
      forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
      // Default presigned URLs to 1 hour
      presignExpiresInSeconds:
        env.S3_PRESIGN_EXPIRES_IN_SECONDS ?? S3_DEFAULTS.PRESIGN_EXPIRES_SECONDS,
    };
    // Custom endpoint for S3-compatible services (MinIO, R2, Spaces)
    if (env.S3_ENDPOINT !== undefined) {
      config.endpoint = env.S3_ENDPOINT;
    }
    return config;
  }

  // Local filesystem storage (development default)
  // Ensure we use an absolute path relative to the specific app root,
  // not the CWD (which might be the monorepo root)
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const defaultPath = resolve(currentDir, '../../../../../apps/server/uploads');

  const config: LocalStorageConfig = {
    provider: 'local',
    // In a monorepo, keep uploads in a known data directory
    rootPath:
      env.STORAGE_ROOT_PATH != null && env.STORAGE_ROOT_PATH !== ''
        ? resolveStorageRootPath(env.STORAGE_ROOT_PATH)
        : defaultPath,
    publicBaseUrl: resolvePublicBaseUrl(env.STORAGE_PUBLIC_BASE_URL, options.apiBaseUrl),
  };
  return config;
}

/**
 * Validates storage configuration for production readiness.
 */
export function validateStorage(config: StorageConfig, isProd: boolean): string[] {
  const errors: string[] = [];

  if (config.provider === 's3') {
    if (config.bucket === '') errors.push('S3_BUCKET is required for S3 storage');
    if (config.region === '') errors.push('S3_REGION is required for S3 storage');
    if (isProd && config.accessKeyId === '') {
      errors.push('S3_ACCESS_KEY_ID is required in production');
    }
    if (isProd && config.secretAccessKey === '') {
      errors.push('S3_SECRET_ACCESS_KEY is required in production');
    }
  }

  return errors;
}
