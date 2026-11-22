// main/kernel/storage/src/index.ts
/**
 * @bslt/storage
 *
 * Storage providers, signing utilities, and storage configuration.
 */

// Errors
export { StorageError, StorageNotFoundError, StorageUploadError, toStorageError } from './errors';

// Configuration (loaded and validated by @bslt/server-system config)
export { DEFAULT_STORAGE_MAX_FILE_SIZE } from './config';

// Types
export type {
  LocalStorageConfig,
  S3StorageConfig,
  StorageConfig,
  StorageHeadResult,
  StorageMultipartPart,
  StorageProvider,
} from './types';

// Factory
export { createStorage } from './factory';

// Providers (direct access if needed)
export { LocalStorageProvider, S3StorageProvider } from './providers';

// URL Signing (canonical implementation: local provider signs, /uploads verifies)
export {
  deriveStorageUrlKey,
  isServableStorageKey,
  MAX_SIGNED_URL_EXPIRES_SECONDS,
  normalizeStorageKey,
  SIGNED_URL_QUERY,
  signStorageUrl,
  verifyStorageUrl,
  type StorageUrlClaims,
  type StorageUrlMethod,
  type StorageUrlVerdict,
} from './signing';
