// main/server/storage/src/types.ts
/**
 * Storage Provider Types
 *
 * Re-exports shared storage config types and defines engine-specific types.
 *
 * Naming convention:
 * - StorageProvider = the storage client interface (implements upload/download/delete)
 * - StorageProviderName = the string union ('local' | 's3' | ...)
 * - StorageConfig = discriminated union of provider-specific configs
 */

import type {
  LocalStorageConfig as SharedLocalStorageConfig,
  S3StorageConfig as SharedS3StorageConfig,
  StorageBackend,
  StorageClient,
  StorageConfig as SharedStorageConfig,
} from '@bslt/shared/contracts';

export type LocalStorageConfig = SharedLocalStorageConfig;
export type S3StorageConfig = SharedS3StorageConfig;
export type StorageConfig = SharedStorageConfig;

/**
 * Storage provider interface — alias for the shared StorageClient contract.
 * Backend-core providers (LocalStorageProvider, S3StorageProvider) implement this.
 */
export type StorageProvider = StorageClient;

/**
 * Storage provider name string union — alias for the shared StorageProvider type.
 */
export type StorageProviderName = StorageBackend;

/**
 * Parameters for uploading a file to storage.
 *
 * @param key - Storage key (file path)
 * @param contentType - MIME type of the content
 * @param body - File content as Buffer, Uint8Array, or string
 */
export interface UploadParams {
  key: string;
  contentType: string;
  body: Buffer | Uint8Array | string;
}
