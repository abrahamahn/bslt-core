// main/kernel/storage/src/providers/local.ts
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  copyFile,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import { S3_DEFAULTS } from '@bslt/contract';

import { StorageError, StorageNotFoundError, toStorageError } from '../errors';
import {
  deriveStorageUrlKey,
  isServableStorageKey,
  MAX_SIGNED_URL_EXPIRES_SECONDS,
  normalizeStorageKey,
  SIGNED_URL_QUERY,
  signStorageUrl,
  type StorageUrlMethod,
} from '../signing';

import type {
  LocalStorageConfig,
  StorageHeadResult,
  StorageMultipartPart,
  StorageProvider,
} from '../types';
import type { ReadableStreamLike } from '@bslt/contract';

/** Where the app serves local files when no public base URL is configured. */
const DEFAULT_PUBLIC_BASE_URL = '/uploads';
const UPLOAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const MAX_PART_NUMBER = 10_000;

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

function computePartEtag(bytes: Uint8Array): string {
  return `"${createHash('sha256').update(bytes).digest('hex')}"`;
}

export class LocalStorageProvider implements StorageProvider {
  private readonly signingKey: Buffer;
  private readonly publicBaseUrl: string;

  /**
   * @throws StorageError when `config.signingSecret` is shorter than 32 characters
   */
  constructor(private readonly config: LocalStorageConfig) {
    this.signingKey = deriveStorageUrlKey(config.signingSecret);
    const base = (config.publicBaseUrl ?? DEFAULT_PUBLIC_BASE_URL).replace(/\/+$/u, '');
    this.publicBaseUrl = base === '' ? DEFAULT_PUBLIC_BASE_URL : base;
  }

  private resolveKey(key: string): string {
    const safeKey = normalizeStorageKey(key, true);
    return join(this.config.rootPath, safeKey);
  }

  private resolveMultipartDir(uploadId: string): string {
    if (!UPLOAD_ID_PATTERN.test(uploadId)) {
      throw new StorageError('Invalid multipart uploadId');
    }
    return join(this.config.rootPath, '.multipart', uploadId);
  }

  private validatePartNumber(partNumber: number): void {
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > MAX_PART_NUMBER) {
      throw new StorageError(
        `Multipart partNumber must be an integer between 1 and ${String(MAX_PART_NUMBER)}`,
      );
    }
  }

  private async writeFileAtomic(
    filePath: string,
    data: Buffer | Uint8Array | string,
  ): Promise<void> {
    const dir = dirname(filePath);
    const tempPath = join(dir, `.${basename(filePath)}.${randomUUID()}.tmp`);
    const fd = await open(tempPath, 'wx', 0o600);
    try {
      await fd.writeFile(data);
    } finally {
      await fd.close();
    }
    await rename(tempPath, filePath);
  }

  private signKeyUrl(
    method: StorageUrlMethod,
    key: string,
    expiresInSeconds: number = S3_DEFAULTS.PRESIGN_EXPIRES_SECONDS,
  ): Promise<string> {
    const canonicalKey = normalizeStorageKey(key, true);
    if (!isServableStorageKey(canonicalKey)) {
      return Promise.reject(new StorageError('Cannot sign a URL for an unservable storage key'));
    }
    if (
      !Number.isInteger(expiresInSeconds) ||
      expiresInSeconds <= 0 ||
      expiresInSeconds > MAX_SIGNED_URL_EXPIRES_SECONDS
    ) {
      return Promise.reject(
        new StorageError(
          `Signed URL expiry must be a whole number of seconds from 1 to ${String(MAX_SIGNED_URL_EXPIRES_SECONDS)}`,
        ),
      );
    }

    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const signature = signStorageUrl({ method, key: canonicalKey, expiresAt }, this.signingKey);
    const path = canonicalKey.split('/').map(encodeURIComponent).join('/');
    const query = new URLSearchParams({
      [SIGNED_URL_QUERY.expires]: String(expiresAt),
      [SIGNED_URL_QUERY.signature]: signature,
    });
    return Promise.resolve(`${this.publicBaseUrl}/${path}?${query.toString()}`);
  }

  async upload(
    key: string,
    data: Buffer | Uint8Array | string | ReadableStreamLike<Uint8Array>,
    _contentType: string,
  ): Promise<string> {
    const rawKey = key !== '' ? key : randomUUID();
    const canonicalKey = normalizeStorageKey(rawKey, true);
    const filePath = join(this.config.rootPath, canonicalKey);
    await mkdir(dirname(filePath), { recursive: true });
    const bytes =
      typeof data === 'string' || data instanceof Uint8Array ? data : await drainStreamLike(data);
    await this.writeFileAtomic(filePath, bytes);
    return canonicalKey;
  }

  async download(key: string): Promise<Buffer> {
    const filePath = this.resolveKey(key);
    try {
      return await readFile(filePath);
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        throw new StorageNotFoundError(key, error);
      }
      throw toStorageError(error, `Failed to read storage object: ${key}`);
    }
  }

  downloadStream(key: string): Promise<ReadableStreamLike<Uint8Array>> {
    const filePath = this.resolveKey(key);
    const nodeStream = createReadStream(filePath);

    return Promise.resolve({
      getReader: (): {
        read(): Promise<{ done: boolean; value?: Uint8Array }>;
        releaseLock(): void;
      } => {
        let streamEnded = false;
        return {
          read: async (): Promise<{ done: boolean; value?: Uint8Array }> => {
            if (streamEnded) {
              return { done: true };
            }
            return new Promise((resolve, reject) => {
              nodeStream.once('data', (chunk: Buffer) => {
                resolve({ done: false, value: new Uint8Array(chunk) });
              });
              nodeStream.once('end', () => {
                streamEnded = true;
                resolve({ done: true });
              });
              nodeStream.once('error', reject);
            });
          },
          releaseLock: (): void => {
            nodeStream.destroy();
          },
        };
      },
    });
  }

  async head(key: string): Promise<StorageHeadResult> {
    const filePath = this.resolveKey(key);
    try {
      const stats = await stat(filePath);
      return { exists: true, sizeBytes: stats.size };
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return { exists: false };
      }
      throw toStorageError(error, `Failed to stat storage object: ${key}`);
    }
  }

  async copy(sourceKey: string, destinationKey: string): Promise<void> {
    const srcPath = this.resolveKey(sourceKey);
    const dstPath = this.resolveKey(destinationKey);
    await mkdir(dirname(dstPath), { recursive: true });
    const tempPath = join(dirname(dstPath), `.${basename(dstPath)}.${randomUUID()}.tmp`);
    try {
      await copyFile(srcPath, tempPath);
      await rename(tempPath, dstPath);
    } catch (error: unknown) {
      try {
        await unlink(tempPath);
      } catch (cleanupErr: unknown) {
        if (
          cleanupErr instanceof Error &&
          'code' in cleanupErr &&
          (cleanupErr as NodeJS.ErrnoException).code !== 'ENOENT'
        ) {
          throw toStorageError(cleanupErr, 'Failed to clean up temporary copy file');
        }
      }
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        throw new StorageNotFoundError(sourceKey, error);
      }
      throw toStorageError(error, `Failed to copy storage object: ${sourceKey}`);
    }
  }

  async delete(key: string): Promise<void> {
    const filePath = this.resolveKey(key);
    try {
      await unlink(filePath);
    } catch (error: unknown) {
      if (
        error != null &&
        typeof error === 'object' &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code !== 'ENOENT'
      ) {
        throw toStorageError(error, 'Failed to delete storage object');
      }
    }
  }

  getSignedUrl(
    key: string,
    expiresInSeconds: number = S3_DEFAULTS.PRESIGN_EXPIRES_SECONDS,
  ): Promise<string> {
    return this.signKeyUrl('GET', key, expiresInSeconds);
  }

  getSignedUploadUrl(
    key: string,
    _contentType: string,
    expiresInSeconds: number = S3_DEFAULTS.PRESIGN_EXPIRES_SECONDS,
  ): Promise<string> {
    return this.signKeyUrl('PUT', key, expiresInSeconds);
  }

  async createMultipartUpload(
    key: string,
    _contentType: string,
  ): Promise<{ readonly uploadId: string }> {
    const canonicalKey = normalizeStorageKey(key, true);
    if (!isServableStorageKey(canonicalKey)) {
      throw new StorageError('Cannot initiate multipart upload for an unservable storage key');
    }
    const uploadId = randomUUID();
    const dir = this.resolveMultipartDir(uploadId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    return { uploadId };
  }

  getSignedPartUploadUrl(
    key: string,
    uploadId: string,
    partNumber: number,
    expiresInSeconds: number = S3_DEFAULTS.PRESIGN_EXPIRES_SECONDS,
  ): Promise<string> {
    this.resolveMultipartDir(uploadId);
    this.validatePartNumber(partNumber);
    return this.signKeyUrl(
      'PUT',
      `${normalizeStorageKey(key, true)}/__parts/${uploadId}/${String(partNumber)}`,
      expiresInSeconds,
    );
  }

  async uploadPart(
    _key: string,
    uploadId: string,
    partNumber: number,
    data: Buffer | Uint8Array,
  ): Promise<{ readonly etag: string }> {
    const dir = this.resolveMultipartDir(uploadId);
    this.validatePartNumber(partNumber);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const partPath = join(dir, `part-${String(partNumber).padStart(5, '0')}`);
    await this.writeFileAtomic(partPath, data);
    return { etag: computePartEtag(data) };
  }

  async listUploadedParts(_key: string, uploadId: string): Promise<StorageMultipartPart[]> {
    const dir = this.resolveMultipartDir(uploadId);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return [];
      }
      throw toStorageError(error, 'Failed to list multipart upload parts');
    }

    const parts: StorageMultipartPart[] = [];
    for (const entry of entries) {
      const match = /^part-(\d{5})$/u.exec(entry);
      if (match?.[1] === undefined) continue;
      const partNumber = Number(match[1]);
      const buf = await readFile(join(dir, entry));
      parts.push({
        partNumber,
        etag: computePartEtag(buf),
        size: buf.length,
      });
    }
    parts.sort((a, b) => a.partNumber - b.partNumber);
    return parts;
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: readonly StorageMultipartPart[],
  ): Promise<{ readonly etag?: string }> {
    const dir = this.resolveMultipartDir(uploadId);
    if (parts.length === 0) {
      throw new StorageError('CompleteMultipartUpload requires at least one part');
    }
    for (const p of parts) {
      this.validatePartNumber(p.partNumber);
    }

    const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    const buffers: Buffer[] = [];
    for (const p of sorted) {
      const partPath = join(dir, `part-${String(p.partNumber).padStart(5, '0')}`);
      let buf: Buffer;
      try {
        buf = await readFile(partPath);
      } catch {
        throw new StorageError(`Missing uploaded part ${String(p.partNumber)}`);
      }
      const actualEtag = computePartEtag(buf);
      if (actualEtag !== p.etag) {
        throw new StorageError(
          `ETag mismatch on part ${String(p.partNumber)}: expected ${actualEtag}, got ${p.etag}`,
        );
      }
      buffers.push(buf);
    }

    const assembled = Buffer.concat(buffers);
    const targetPath = this.resolveKey(key);
    await mkdir(dirname(targetPath), { recursive: true });
    await this.writeFileAtomic(targetPath, assembled);
    await rm(dir, { recursive: true, force: true });
    return { etag: computePartEtag(assembled) };
  }

  async abortMultipartUpload(_key: string, uploadId: string): Promise<void> {
    const dir = this.resolveMultipartDir(uploadId);
    await rm(dir, { recursive: true, force: true });
  }
}
