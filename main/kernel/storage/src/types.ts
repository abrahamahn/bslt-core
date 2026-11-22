// main/kernel/storage/src/types.ts
/**
 * Storage Provider Types
 *
 * Re-exports shared storage config types and defines engine-specific types,
 * including upload sessions, multipart operations, head probes, and copy.
 */

import type {
  LocalStorageConfig as SharedLocalStorageConfig,
  S3StorageConfig as SharedS3StorageConfig,
  StorageClient,
  StorageConfig as SharedStorageConfig,
} from '@bslt/contract';

export type LocalStorageConfig = SharedLocalStorageConfig;
export type S3StorageConfig = SharedS3StorageConfig;
export type StorageConfig = SharedStorageConfig;

export type StorageHeadResult =
  | {
      readonly exists: true;
      readonly sizeBytes: number;
      readonly contentType?: string;
      readonly etag?: string;
    }
  | { readonly exists: false };

export interface StorageMultipartPart {
  readonly partNumber: number;
  readonly etag: string;
  readonly size?: number;
}

/**
 * Storage provider interface — extends the shared StorageClient contract with
 * optional upload-session, multipart, head, and copy operations implemented by
 * both `LocalStorageProvider` and `S3StorageProvider`.
 */
export interface StorageProvider extends StorageClient {
  head?(key: string): Promise<StorageHeadResult>;
  copy?(sourceKey: string, destinationKey: string): Promise<void>;
  getSignedUploadUrl?(key: string, contentType: string, expiresInSeconds?: number): Promise<string>;
  createMultipartUpload?(key: string, contentType: string): Promise<{ readonly uploadId: string }>;
  getSignedPartUploadUrl?(
    key: string,
    uploadId: string,
    partNumber: number,
    expiresInSeconds?: number,
  ): Promise<string>;
  uploadPart?(
    key: string,
    uploadId: string,
    partNumber: number,
    data: Buffer | Uint8Array,
  ): Promise<{ readonly etag: string }>;
  listUploadedParts?(key: string, uploadId: string): Promise<StorageMultipartPart[]>;
  completeMultipartUpload?(
    key: string,
    uploadId: string,
    parts: readonly StorageMultipartPart[],
  ): Promise<{ readonly etag?: string }>;
  abortMultipartUpload?(key: string, uploadId: string): Promise<void>;
}
