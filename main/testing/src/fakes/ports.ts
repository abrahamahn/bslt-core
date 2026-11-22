// main/testing/src/fakes/ports.ts
/**
 * Fakes for the external ports of the server: what would otherwise send an
 * email or an SMS, write to a bucket, call a push service or report to an error
 * tracker. Each is the port's interface with spies for methods, so a test can
 * assert on what was sent and replace an answer (`mockResolvedValueOnce`).
 */

import { vi, type Mock } from 'vitest';

/** Email service fake: `send` resolves as delivered. */
export interface FakeEmailService {
  readonly send: Mock;
  readonly healthCheck: Mock;
}

export function createFakeEmailService(): FakeEmailService {
  return {
    send: vi.fn().mockResolvedValue({ success: true, messageId: 'test-message-id' }),
    healthCheck: vi.fn().mockResolvedValue(true),
  };
}

/** SMS provider fake: `send` resolves as delivered. */
export interface FakeSmsProvider {
  readonly send: Mock;
}

export function createFakeSmsProvider(): FakeSmsProvider {
  return { send: vi.fn().mockResolvedValue({ success: true, messageId: 'test-sms-id' }) };
}

/**
 * Storage fake that keeps objects in memory. Uploads can be read back, deleted
 * objects are gone, and a signed URL is an absolute URL that names the key.
 */
export interface FakeStorage {
  readonly upload: Mock;
  readonly download: Mock;
  readonly downloadStream: Mock;
  readonly delete: Mock;
  readonly getSignedUrl: Mock;
  readonly getSignedUploadUrl: Mock;
  readonly head: Mock;
  readonly copy: Mock;
  readonly createMultipartUpload: Mock;
  readonly getSignedPartUploadUrl: Mock;
  readonly uploadPart: Mock;
  readonly listUploadedParts: Mock;
  readonly completeMultipartUpload: Mock;
  readonly abortMultipartUpload: Mock;
  /** What is stored right now, by key. */
  readonly objects: Map<string, Uint8Array>;
}

/** Host of the URLs the storage fake signs. */
export const FAKE_STORAGE_ORIGIN = 'https://storage.test';

async function toBytes(data: unknown): Promise<Uint8Array> {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof Uint8Array) return data;
  const chunks: Uint8Array[] = [];
  const reader = (
    data as { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }> } }
  ).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value !== undefined) chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export function createFakeStorage(): FakeStorage {
  const objects = new Map<string, Uint8Array>();
  const multiparts = new Map<string, Map<number, { bytes: Uint8Array; etag: string }>>();
  let mpCounter = 0;
  const read = (key: string): Uint8Array => {
    const found = objects.get(key);
    if (found === undefined) throw new Error(`FakeStorage: no object at ${key}`);
    return found;
  };
  return {
    objects,
    upload: vi.fn(async (key: string, data: unknown) => {
      objects.set(key, await toBytes(data));
      return key;
    }),
    // async, so a missing object is a rejection, as it is from a real provider.
    download: vi.fn(async (key: string) => Promise.resolve(read(key))),
    downloadStream: vi.fn(async (key: string) => {
      const bytes = read(key);
      let sent = false;
      return Promise.resolve({
        getReader: () => ({
          read: () => {
            if (sent) return Promise.resolve({ done: true });
            sent = true;
            return Promise.resolve({ done: false, value: bytes });
          },
          releaseLock: () => undefined,
        }),
      });
    }),
    delete: vi.fn((key: string) => {
      objects.delete(key);
      return Promise.resolve();
    }),
    getSignedUrl: vi.fn((key: string) => Promise.resolve(`${FAKE_STORAGE_ORIGIN}/${key}`)),
    getSignedUploadUrl: vi.fn((key: string) =>
      Promise.resolve(`${FAKE_STORAGE_ORIGIN}/put/${key}`),
    ),
    head: vi.fn((key: string) => {
      const found = objects.get(key);
      if (found === undefined) return Promise.resolve({ exists: false as const });
      return Promise.resolve({ exists: true as const, sizeBytes: found.byteLength });
    }),
    copy: vi.fn((sourceKey: string, destinationKey: string) => {
      const found = read(sourceKey);
      objects.set(destinationKey, new Uint8Array(found));
      return Promise.resolve();
    }),
    createMultipartUpload: vi.fn((_key: string) => {
      mpCounter += 1;
      const uploadId = `fake-mp-${String(mpCounter)}`;
      multiparts.set(uploadId, new Map());
      return Promise.resolve({ uploadId });
    }),
    getSignedPartUploadUrl: vi.fn((key: string, uploadId: string, partNumber: number) =>
      Promise.resolve(
        `${FAKE_STORAGE_ORIGIN}/mp/${key}?uploadId=${uploadId}&partNumber=${String(partNumber)}`,
      ),
    ),
    uploadPart: vi.fn(async (_key: string, uploadId: string, partNumber: number, data: unknown) => {
      const bytes = await toBytes(data);
      const etag = `"fake-etag-${uploadId}-${String(partNumber)}"`;
      let bucket = multiparts.get(uploadId);
      if (bucket === undefined) {
        bucket = new Map();
        multiparts.set(uploadId, bucket);
      }
      bucket.set(partNumber, { bytes, etag });
      return { etag };
    }),
    listUploadedParts: vi.fn((_key: string, uploadId: string) => {
      const bucket = multiparts.get(uploadId);
      if (bucket === undefined) return Promise.resolve([]);
      const list = [...bucket.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([partNumber, entry]) => ({
          partNumber,
          etag: entry.etag,
          size: entry.bytes.byteLength,
        }));
      return Promise.resolve(list);
    }),
    completeMultipartUpload: vi.fn(
      (
        key: string,
        uploadId: string,
        parts: ReadonlyArray<{ partNumber: number; etag: string }>,
      ) => {
        const bucket = multiparts.get(uploadId);
        if (bucket === undefined || parts.length === 0) {
          return Promise.reject(new Error(`FakeStorage: invalid multipart ${uploadId}`));
        }
        const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
        const buffers: Uint8Array[] = [];
        for (const p of sorted) {
          const entry = bucket.get(p.partNumber);
          if (entry === undefined || entry.etag !== p.etag) {
            return Promise.reject(
              new Error(`FakeStorage: missing or mismatched part ${String(p.partNumber)}`),
            );
          }
          buffers.push(entry.bytes);
        }
        objects.set(key, Buffer.concat(buffers));
        multiparts.delete(uploadId);
        return Promise.resolve({ etag: `"fake-complete-${uploadId}"` });
      },
    ),
    abortMultipartUpload: vi.fn((_key: string, uploadId: string) => {
      multiparts.delete(uploadId);
      return Promise.resolve();
    }),
  };
}

/** Push provider service fake: not configured, so nothing is pushed. */
export interface FakeNotificationService {
  readonly isConfigured: Mock;
  readonly getWebPushProvider: Mock;
}

export function createFakeNotificationService(): FakeNotificationService {
  return {
    isConfigured: vi.fn().mockReturnValue(false),
    getWebPushProvider: vi.fn().mockReturnValue(undefined),
  };
}

/** Error tracker fake: records what the server would have reported. */
export interface FakeErrorTracker {
  readonly captureError: Mock;
  readonly addBreadcrumb: Mock;
  readonly setUserContext: Mock;
}

export function createFakeErrorTracker(): FakeErrorTracker {
  return { captureError: vi.fn(), addBreadcrumb: vi.fn(), setUserContext: vi.fn() };
}

/** Cache stats fake (the health endpoints read it). */
export interface FakeCacheStats {
  readonly getStats: Mock;
}

export function createFakeCacheStats(): FakeCacheStats {
  return { getStats: vi.fn().mockResolvedValue({ hits: 0, misses: 0, size: 0 }) };
}
