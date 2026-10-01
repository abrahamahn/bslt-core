// main/server/storage/src/index.ts
/**
 * @bslt/storage
 *
 * Storage providers, signing utilities, and storage configuration.
 */

// Errors
export {
  isStorageError,
  isStorageNotFoundError,
  StorageError,
  StorageNotFoundError,
  StorageUploadError,
  toStorageError,
} from './errors';

// Configuration
export { DEFAULT_STORAGE_MAX_FILE_SIZE, loadStorageConfig, validateStorage } from './config';

// Types
export type {
  LocalStorageConfig,
  S3StorageConfig,
  StorageConfig,
  StorageProvider,
  StorageProviderName,
  UploadParams,
} from './types';

// Factory
export { createStorage } from './factory';

// Providers (direct access if needed)
export { LocalStorageProvider, S3StorageProvider } from './providers';

// URL Signing (canonical implementations)
export {
  createSignedUrl,
  createSignature as createStorageSignature,
  getDefaultExpiration,
  isUrlExpired,
  normalizeFilename as normalizeStorageFilename,
  normalizeStorageKey,
  parseSignedUrl,
  verifySignature as verifyStorageSignature,
  type SignedUrlData,
} from './signing';
