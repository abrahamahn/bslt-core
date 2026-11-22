// main/kernel/storage/src/providers/s3.ts
import { createS3Client, S3ProtocolError, type S3ProtocolClient } from '@bslt/protocols/s3';

import { StorageError, StorageNotFoundError, StorageUploadError } from '../errors';
import { normalizeStorageKey } from '../signing';

import type {
  S3StorageConfig,
  StorageHeadResult,
  StorageMultipartPart,
  StorageProvider,
} from '../types';
import type { ReadableStreamLike } from '@bslt/contract';

async function drainStreamLike(stream: ReadableStreamLike<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      if (next.value !== undefined) {
        chunks.push(next.value);
      }
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

function mapS3Error(error: unknown, key: string, defaultMessage: string): StorageError {
  if (error instanceof StorageError) return error;
  if (error instanceof S3ProtocolError) {
    if (error.isNotFound) {
      return new StorageNotFoundError(key, error);
    }
    return new StorageError(error.message, error.statusCode, error.s3Code, error);
  }
  if (error instanceof Error) {
    return new StorageError(error.message, 500, 'STORAGE_ERROR', error);
  }
  return new StorageError(defaultMessage, 500, 'STORAGE_ERROR');
}

export class S3StorageProvider implements StorageProvider {
  private readonly client: S3ProtocolClient;
  private readonly defaultExpires: number;

  constructor(private readonly config: S3StorageConfig) {
    try {
      this.client = createS3Client({
        region: config.region,
        forcePathStyle: config.forcePathStyle,
        ...(config.endpoint !== undefined && config.endpoint !== ''
          ? { endpoint: config.endpoint }
          : {}),
        ...(config.accessKeyId !== '' && config.secretAccessKey !== ''
          ? {
              credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
              },
            }
          : {}),
      });
    } catch (error) {
      throw mapS3Error(error, '', 'Failed to initialize S3 storage client');
    }
    this.defaultExpires = config.presignExpiresInSeconds;
  }

  async upload(
    key: string,
    data: Buffer | Uint8Array | string | ReadableStreamLike<Uint8Array>,
    contentType: string,
  ): Promise<string> {
    const finalKey = normalizeStorageKey(key);
    try {
      const body =
        typeof data === 'string' || data instanceof Uint8Array ? data : await drainStreamLike(data);
      await this.client.putObject({
        bucket: this.config.bucket,
        key: finalKey,
        body,
        contentType,
      });
      return finalKey;
    } catch (error) {
      if (error instanceof S3ProtocolError) {
        throw new StorageUploadError(finalKey, error);
      }
      throw mapS3Error(error, finalKey, `Failed to upload S3 object: ${finalKey}`);
    }
  }

  async download(key: string): Promise<Buffer> {
    const finalKey = normalizeStorageKey(key);
    try {
      const result = await this.client.getObject({
        bucket: this.config.bucket,
        key: finalKey,
      });
      return Buffer.from(result.body);
    } catch (error) {
      throw mapS3Error(error, key, `Failed to download S3 object: ${key}`);
    }
  }

  async downloadStream(key: string): Promise<ReadableStreamLike<Uint8Array>> {
    const finalKey = normalizeStorageKey(key);
    try {
      const result = await this.client.getObjectStream({
        bucket: this.config.bucket,
        key: finalKey,
      });
      return {
        getReader: () => {
          const reader = result.stream.getReader();
          return {
            read: async () => {
              const chunk = await reader.read();
              if (chunk.done) return { done: true };
              return { done: false, value: chunk.value };
            },
            releaseLock: () => {
              reader.releaseLock();
            },
          };
        },
      };
    } catch (error) {
      throw mapS3Error(error, key, `Failed to stream S3 object: ${key}`);
    }
  }

  async head(key: string): Promise<StorageHeadResult> {
    const finalKey = normalizeStorageKey(key);
    try {
      const result = await this.client.headObject({
        bucket: this.config.bucket,
        key: finalKey,
      });
      if (!result.exists) return { exists: false };
      return {
        exists: true,
        sizeBytes: result.contentLength,
        ...(result.contentType !== undefined ? { contentType: result.contentType } : {}),
        ...(result.etag !== undefined ? { etag: result.etag } : {}),
      };
    } catch (error) {
      throw mapS3Error(error, key, `Failed to stat S3 object: ${key}`);
    }
  }

  async copy(sourceKey: string, destinationKey: string): Promise<void> {
    const src = normalizeStorageKey(sourceKey);
    const dst = normalizeStorageKey(destinationKey);
    try {
      await this.client.copyObject({
        sourceBucket: this.config.bucket,
        sourceKey: src,
        destinationBucket: this.config.bucket,
        destinationKey: dst,
      });
    } catch (error) {
      throw mapS3Error(error, sourceKey, `Failed to copy S3 object ${src} -> ${dst}`);
    }
  }

  async delete(key: string): Promise<void> {
    const finalKey = normalizeStorageKey(key);
    try {
      await this.client.deleteObject({
        bucket: this.config.bucket,
        key: finalKey,
      });
    } catch (error) {
      throw mapS3Error(error, key, `Failed to delete S3 object: ${key}`);
    }
  }

  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string> {
    const finalKey = normalizeStorageKey(key);
    try {
      const url = this.client.presignGetObject({
        bucket: this.config.bucket,
        key: finalKey,
        expiresInSeconds: expiresInSeconds ?? this.defaultExpires,
      });
      return Promise.resolve(url);
    } catch (error) {
      return Promise.reject(mapS3Error(error, key, `Failed to presign GET URL: ${key}`));
    }
  }

  getSignedUploadUrl(key: string, contentType: string, expiresInSeconds?: number): Promise<string> {
    const finalKey = normalizeStorageKey(key);
    try {
      const url = this.client.presignPutObject({
        bucket: this.config.bucket,
        key: finalKey,
        contentType,
        expiresInSeconds: expiresInSeconds ?? this.defaultExpires,
      });
      return Promise.resolve(url);
    } catch (error) {
      return Promise.reject(mapS3Error(error, key, `Failed to presign PUT URL: ${key}`));
    }
  }

  async createMultipartUpload(
    key: string,
    contentType: string,
  ): Promise<{ readonly uploadId: string }> {
    const finalKey = normalizeStorageKey(key);
    try {
      return await this.client.createMultipartUpload({
        bucket: this.config.bucket,
        key: finalKey,
        contentType,
      });
    } catch (error) {
      throw mapS3Error(error, key, `Failed to initiate S3 multipart upload: ${key}`);
    }
  }

  getSignedPartUploadUrl(
    key: string,
    uploadId: string,
    partNumber: number,
    expiresInSeconds?: number,
  ): Promise<string> {
    const finalKey = normalizeStorageKey(key);
    try {
      const url = this.client.presignUploadPart({
        bucket: this.config.bucket,
        key: finalKey,
        uploadId,
        partNumber,
        expiresInSeconds: expiresInSeconds ?? this.defaultExpires,
      });
      return Promise.resolve(url);
    } catch (error) {
      return Promise.reject(mapS3Error(error, key, `Failed to presign multipart part URL: ${key}`));
    }
  }

  async uploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    data: Buffer | Uint8Array,
  ): Promise<{ readonly etag: string }> {
    const finalKey = normalizeStorageKey(key);
    try {
      return await this.client.uploadPart({
        bucket: this.config.bucket,
        key: finalKey,
        uploadId,
        partNumber,
        body: data,
      });
    } catch (error) {
      throw mapS3Error(error, key, `Failed to upload S3 part ${String(partNumber)}: ${key}`);
    }
  }

  async listUploadedParts(key: string, uploadId: string): Promise<StorageMultipartPart[]> {
    const finalKey = normalizeStorageKey(key);
    try {
      const parts: StorageMultipartPart[] = [];
      let marker: number | undefined;
      for (;;) {
        const page = await this.client.listParts({
          bucket: this.config.bucket,
          key: finalKey,
          uploadId,
          ...(marker !== undefined ? { partNumberMarker: marker } : {}),
        });
        parts.push(...page.parts);
        if (!page.isTruncated || page.nextPartNumberMarker === undefined) {
          break;
        }
        marker = page.nextPartNumberMarker;
      }
      return parts;
    } catch (error) {
      throw mapS3Error(error, key, `Failed to list S3 multipart parts: ${key}`);
    }
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: readonly StorageMultipartPart[],
  ): Promise<{ readonly etag?: string }> {
    const finalKey = normalizeStorageKey(key);
    try {
      return await this.client.completeMultipartUpload({
        bucket: this.config.bucket,
        key: finalKey,
        uploadId,
        parts,
      });
    } catch (error) {
      throw mapS3Error(error, key, `Failed to complete S3 multipart upload: ${key}`);
    }
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    const finalKey = normalizeStorageKey(key);
    try {
      await this.client.abortMultipartUpload({
        bucket: this.config.bucket,
        key: finalKey,
        uploadId,
      });
    } catch (error) {
      throw mapS3Error(error, key, `Failed to abort S3 multipart upload: ${key}`);
    }
  }
}
