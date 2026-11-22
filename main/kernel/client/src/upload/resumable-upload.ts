// main/kernel/client/src/upload/resumable-upload.ts
/**
 * Owned resumable single-PUT and multipart upload client (`@bslt/client-engine`).
 *
 * Drives direct-to-storage presigned upload sessions with bounded concurrency,
 * exponential-backoff retries on transient network/5xx errors, skip-on-resume
 * over already-uploaded parts, byte progress reporting, and `AbortSignal` cleanup.
 */

const DEFAULT_PART_SIZE_BYTES = 5 * 1024 * 1024; // 5 MiB (S3 minimum non-final part size)
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_MAX_PART_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 250;

export interface UploadedPartRef {
  readonly partNumber: number;
  readonly etag: string;
  readonly size: number;
}

export interface ResumableUploadProgress {
  readonly uploadedBytes: number;
  readonly totalBytes: number;
  readonly completedParts: number;
  readonly totalParts: number;
}

export type UploadSessionDescriptor =
  | {
      readonly mode: 'single';
      readonly sessionId: string;
      readonly uploadUrl: string;
      readonly headers?: Readonly<Record<string, string>>;
    }
  | {
      readonly mode: 'multipart';
      readonly sessionId: string;
      readonly partSizeBytes?: number;
    };

export interface PartUploadTarget {
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export class ResumableUploadError extends Error {
  public readonly statusCode: number | undefined;
  public readonly retryable: boolean;

  constructor(
    message: string,
    options: {
      readonly statusCode?: number;
      readonly retryable?: boolean;
      readonly cause?: unknown;
    } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'ResumableUploadError';
    this.statusCode = options.statusCode;
    this.retryable = options.retryable ?? false;
  }
}

interface BaseResumableUploadOptions {
  readonly data: Blob | Uint8Array;
  readonly contentType: string;
  readonly partSizeBytes?: number;
  readonly concurrency?: number;
  readonly maxPartRetries?: number;
  readonly retryDelayMs?: number;
  readonly completedParts?: readonly UploadedPartRef[];
  readonly signal?: AbortSignal;
  readonly abortOnCancel?: boolean;
  readonly abortSession?: (sessionId: string) => Promise<void>;
  readonly onProgress?: (progress: ResumableUploadProgress) => void;
  readonly fetchImpl?: typeof fetch;
}

interface SingleResumableUploadOptions<TResult> extends BaseResumableUploadOptions {
  readonly session: Extract<UploadSessionDescriptor, { mode: 'single' }>;
  readonly completeSession: (input: {
    readonly sessionId: string;
    readonly etag?: string;
  }) => Promise<TResult>;
}

interface MultipartResumableUploadOptions<TResult> extends BaseResumableUploadOptions {
  readonly session: Extract<UploadSessionDescriptor, { mode: 'multipart' }>;
  readonly getPartUploadTarget: (input: {
    readonly sessionId: string;
    readonly partNumber: number;
    readonly contentLength: number;
  }) => Promise<PartUploadTarget>;
  readonly completeSession: (input: {
    readonly sessionId: string;
    readonly parts: readonly UploadedPartRef[];
  }) => Promise<TResult>;
}

export type ResumableUploadOptions<TResult> =
  SingleResumableUploadOptions<TResult> | MultipartResumableUploadOptions<TResult>;

function isSingleSessionOptions<TResult>(
  opts: ResumableUploadOptions<TResult>,
): opts is SingleResumableUploadOptions<TResult> {
  return opts.session.mode === 'single';
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal !== undefined && signal.aborted;
}

function byteLengthOf(data: Blob | Uint8Array): number {
  return data instanceof Uint8Array ? data.byteLength : data.size;
}

function slicePayload(data: Blob | Uint8Array, start: number, end: number): Blob | Uint8Array {
  return data instanceof Uint8Array ? data.subarray(start, end) : data.slice(start, end);
}

function toBodyInit(chunk: Blob | Uint8Array): BodyInit {
  if (chunk instanceof Uint8Array) {
    const copy = new Uint8Array(chunk.byteLength);
    copy.set(chunk);
    return copy.buffer;
  }
  return chunk;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  if (isAborted(signal)) {
    throw new ResumableUploadError('Upload aborted', { retryable: false });
  }
  await new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new ResumableUploadError('Upload aborted', { retryable: false }));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function extractResponseEtag(res: Response): Promise<string | undefined> {
  const headerEtag = res.headers.get('etag') ?? res.headers.get('ETag');
  if (headerEtag !== null && headerEtag.trim() !== '') {
    return headerEtag.trim();
  }
  const text = await res.text().catch(() => '');
  if (text.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(text) as { etag?: unknown; data?: { etag?: unknown } };
      if (typeof parsed.etag === 'string' && parsed.etag !== '') return parsed.etag;
      if (typeof parsed.data?.etag === 'string' && parsed.data.etag !== '') return parsed.data.etag;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

async function putWithRetries(params: {
  readonly fetchFn: typeof fetch;
  readonly getTarget: () => Promise<PartUploadTarget>;
  readonly body: Blob | Uint8Array;
  readonly defaultHeaders?: Readonly<Record<string, string>>;
  readonly maxRetries: number;
  readonly retryDelayMs: number;
  readonly signal?: AbortSignal;
}): Promise<{ readonly etag?: string }> {
  let attempt = 0;
  for (;;) {
    if (isAborted(params.signal)) {
      throw new ResumableUploadError('Upload aborted', { retryable: false });
    }
    const target = await params.getTarget();
    let res: Response;
    try {
      res = await params.fetchFn(target.url, {
        method: 'PUT',
        headers: {
          ...params.defaultHeaders,
          ...target.headers,
        },
        body: toBodyInit(params.body),
        ...(params.signal !== undefined ? { signal: params.signal } : {}),
      });
    } catch (error) {
      if (isAborted(params.signal)) {
        throw new ResumableUploadError('Upload aborted', { retryable: false, cause: error });
      }
      if (attempt >= params.maxRetries) {
        throw new ResumableUploadError('Network error during upload', {
          retryable: true,
          cause: error,
        });
      }
      attempt += 1;
      await sleepWithSignal(params.retryDelayMs * 2 ** (attempt - 1), params.signal);
      continue;
    }

    if (res.ok) {
      const etag = await extractResponseEtag(res);
      return etag !== undefined ? { etag } : {};
    }

    const retryable = isRetryableStatus(res.status);
    if (!retryable || attempt >= params.maxRetries) {
      throw new ResumableUploadError(`Upload failed with HTTP ${String(res.status)}`, {
        statusCode: res.status,
        retryable,
      });
    }
    attempt += 1;
    await sleepWithSignal(params.retryDelayMs * 2 ** (attempt - 1), params.signal);
  }
}

export async function uploadFileResumable<TResult>(
  options: ResumableUploadOptions<TResult>,
): Promise<TResult> {
  const totalBytes = byteLengthOf(options.data);
  if (totalBytes <= 0) {
    throw new ResumableUploadError('Cannot upload an empty payload');
  }
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new ResumableUploadError('Upload concurrency must be a positive integer');
  }
  const maxRetries = options.maxPartRetries ?? DEFAULT_MAX_PART_RETRIES;
  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new ResumableUploadError('maxPartRetries must be a non-negative integer');
  }
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const fetchFn = options.fetchImpl ?? fetch;

  const maybeAbortSession = async (): Promise<unknown> => {
    if (options.abortOnCancel === true && options.abortSession !== undefined) {
      try {
        await options.abortSession(options.session.sessionId);
      } catch (abortError: unknown) {
        return abortError;
      }
    }
    return undefined;
  };

  if (isAborted(options.signal)) {
    const abortCause = await maybeAbortSession();
    throw new ResumableUploadError(
      'Upload aborted',
      abortCause !== undefined ? { cause: abortCause } : {},
    );
  }

  try {
    if (isSingleSessionOptions(options)) {
      const { session, completeSession } = options;
      const putResult = await putWithRetries({
        fetchFn,
        getTarget: () =>
          Promise.resolve({
            url: session.uploadUrl,
            ...(session.headers !== undefined ? { headers: session.headers } : {}),
          }),
        body: options.data,
        defaultHeaders: { 'content-type': options.contentType },
        maxRetries,
        retryDelayMs,
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
      });
      options.onProgress?.({
        uploadedBytes: totalBytes,
        totalBytes,
        completedParts: 1,
        totalParts: 1,
      });
      return await completeSession({
        sessionId: session.sessionId,
        ...(putResult.etag !== undefined ? { etag: putResult.etag } : {}),
      });
    }

    const partSizeBytes =
      options.session.partSizeBytes ?? options.partSizeBytes ?? DEFAULT_PART_SIZE_BYTES;
    if (!Number.isInteger(partSizeBytes) || partSizeBytes <= 0) {
      throw new ResumableUploadError('Multipart partSizeBytes must be a positive integer');
    }

    const totalParts = Math.ceil(totalBytes / partSizeBytes);
    const completedMap = new Map<number, UploadedPartRef>();
    let uploadedBytes = 0;

    for (const existing of options.completedParts ?? []) {
      const expectedStart = (existing.partNumber - 1) * partSizeBytes;
      const expectedEnd = Math.min(totalBytes, expectedStart + partSizeBytes);
      const expectedSize = expectedEnd - expectedStart;
      if (
        existing.partNumber >= 1 &&
        existing.partNumber <= totalParts &&
        existing.etag !== '' &&
        existing.size === expectedSize &&
        !completedMap.has(existing.partNumber)
      ) {
        completedMap.set(existing.partNumber, existing);
        uploadedBytes += existing.size;
      }
    }

    const pendingParts: number[] = [];
    for (let pn = 1; pn <= totalParts; pn += 1) {
      if (!completedMap.has(pn)) {
        pendingParts.push(pn);
      }
    }

    let cursor = 0;
    let fatalError = false;
    const workerCount = Math.min(concurrency, Math.max(1, pendingParts.length));
    const { session, getPartUploadTarget, completeSession } = options;

    const runWorker = async (): Promise<void> => {
      for (;;) {
        if (fatalError) return;
        const idx = cursor;
        cursor += 1;
        const partNumber = pendingParts[idx];
        if (partNumber === undefined) return;

        const start = (partNumber - 1) * partSizeBytes;
        const end = Math.min(totalBytes, start + partSizeBytes);
        const chunk = slicePayload(options.data, start, end);
        const chunkSize = end - start;

        let putRes: { readonly etag?: string };
        try {
          putRes = await putWithRetries({
            fetchFn,
            getTarget: () =>
              getPartUploadTarget({
                sessionId: session.sessionId,
                partNumber,
                contentLength: chunkSize,
              }),
            body: chunk,
            maxRetries,
            retryDelayMs,
            ...(options.signal !== undefined ? { signal: options.signal } : {}),
          });
        } catch (err) {
          fatalError = true;
          throw err;
        }

        if (putRes.etag === undefined || putRes.etag === '') {
          throw new ResumableUploadError(
            `Multipart upload part ${String(partNumber)} returned no ETag`,
          );
        }

        completedMap.set(partNumber, {
          partNumber,
          etag: putRes.etag,
          size: chunkSize,
        });
        uploadedBytes += chunkSize;
        options.onProgress?.({
          uploadedBytes,
          totalBytes,
          completedParts: completedMap.size,
          totalParts,
        });
      }
    };

    if (pendingParts.length > 0) {
      await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
    } else {
      options.onProgress?.({
        uploadedBytes,
        totalBytes,
        completedParts: completedMap.size,
        totalParts,
      });
    }

    const orderedParts = [...completedMap.values()].sort((a, b) => a.partNumber - b.partNumber);
    return await completeSession({
      sessionId: session.sessionId,
      parts: orderedParts,
    });
  } catch (error) {
    if (isAborted(options.signal)) {
      const abortCause = await maybeAbortSession();
      if (abortCause !== undefined && error instanceof Error && error.cause === undefined) {
        throw new ResumableUploadError(error.message, { cause: abortCause });
      }
    }
    throw error;
  }
}
