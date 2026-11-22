// main/kernel/client/src/upload/resumable-upload.test.ts
import { describe, expect, it, vi } from 'vitest';

import {
  ResumableUploadError,
  uploadFileResumable,
  type ResumableUploadProgress,
} from './resumable-upload';

describe('uploadFileResumable (@bslt/client-engine)', () => {
  it('rejects empty payloads, invalid partSizeBytes, invalid concurrency, and invalid maxPartRetries', async () => {
    const noopComplete = vi.fn().mockResolvedValue({ fileId: 'f1' });

    await expect(
      uploadFileResumable({
        data: new Uint8Array(0),
        contentType: 'image/png',
        session: { mode: 'single', sessionId: 's1', uploadUrl: 'https://upload.test/put' },
        completeSession: noopComplete,
      }),
    ).rejects.toThrow(ResumableUploadError);

    await expect(
      uploadFileResumable({
        data: new Uint8Array([1, 2, 3]),
        contentType: 'image/png',
        partSizeBytes: 0,
        session: { mode: 'multipart', sessionId: 's1', partSizeBytes: 0 },
        getPartUploadTarget: vi.fn(),
        completeSession: noopComplete,
      }),
    ).rejects.toThrow(ResumableUploadError);

    await expect(
      uploadFileResumable({
        data: new Uint8Array([1, 2, 3]),
        contentType: 'image/png',
        concurrency: 0,
        session: { mode: 'single', sessionId: 's1', uploadUrl: 'https://upload.test/put' },
        completeSession: noopComplete,
      }),
    ).rejects.toThrow(ResumableUploadError);

    await expect(
      uploadFileResumable({
        data: new Uint8Array([1, 2, 3]),
        contentType: 'image/png',
        maxPartRetries: -1,
        session: { mode: 'single', sessionId: 's1', uploadUrl: 'https://upload.test/put' },
        completeSession: noopComplete,
      }),
    ).rejects.toThrow(ResumableUploadError);
  });

  it('does not retry 4xx part rejections and fails when multipart PUT returns no ETag', async () => {
    const fetch403 = vi.fn().mockResolvedValue(new Response('Forbidden', { status: 403 }));
    await expect(
      uploadFileResumable({
        data: new Uint8Array([1, 2, 3, 4]),
        contentType: 'application/octet-stream',
        session: { mode: 'multipart', sessionId: 's1', partSizeBytes: 2 },
        concurrency: 1,
        fetchImpl: fetch403,
        maxPartRetries: 3,
        retryDelayMs: 1,
        getPartUploadTarget: ({ partNumber }) =>
          Promise.resolve({ url: `https://upload.test/part/${String(partNumber)}` }),
        completeSession: vi.fn(),
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(fetch403).toHaveBeenCalledTimes(1);

    const fetchNoEtag = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    await expect(
      uploadFileResumable({
        data: new Uint8Array([1, 2]),
        contentType: 'application/octet-stream',
        session: { mode: 'multipart', sessionId: 's2', partSizeBytes: 4 },
        fetchImpl: fetchNoEtag,
        getPartUploadTarget: () => Promise.resolve({ url: 'https://upload.test/part/1' }),
        completeSession: vi.fn(),
      }),
    ).rejects.toThrow(/etag/i);
  });

  it('fails after exhausting transient 503 retries and invokes abortSession on AbortSignal cancellation', async () => {
    const fetch503 = vi.fn().mockResolvedValue(new Response('Unavailable', { status: 503 }));
    await expect(
      uploadFileResumable({
        data: new Uint8Array([10, 20]),
        contentType: 'image/jpeg',
        session: { mode: 'single', sessionId: 's-503', uploadUrl: 'https://upload.test/put' },
        fetchImpl: fetch503,
        maxPartRetries: 2,
        retryDelayMs: 1,
        completeSession: vi.fn(),
      }),
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(fetch503).toHaveBeenCalledTimes(3);

    const controller = new AbortController();
    controller.abort();
    const abortSession = vi.fn().mockResolvedValue(undefined);
    await expect(
      uploadFileResumable({
        data: new Uint8Array([1, 2, 3, 4]),
        contentType: 'video/mp4',
        session: { mode: 'multipart', sessionId: 's-abort', partSizeBytes: 2 },
        signal: controller.signal,
        abortOnCancel: true,
        abortSession,
        getPartUploadTarget: () => Promise.resolve({ url: 'https://upload.test/part/1' }),
        completeSession: vi.fn(),
      }),
    ).rejects.toThrow(/abort/i);
    expect(abortSession).toHaveBeenCalledWith('s-abort');
  });

  it('resumes a multipart upload by skipping completedParts, retries transient 500s, reports progress, and completes in part order', async () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7]); // 3 parts of size 3, 3, 1
    let part2Attempts = 0;
    const uploadedPartCalls: number[] = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      const partMatch = /part\/(\d+)$/u.exec(url);
      const partNumber = Number(partMatch?.[1] ?? '0');
      uploadedPartCalls.push(partNumber);

      if (partNumber === 2 && part2Attempts === 0) {
        part2Attempts += 1;
        return new Response('Transient', { status: 500 });
      }
      return new Response('', {
        status: 200,
        headers: { etag: `"etag-${String(partNumber)}"` },
      });
    });

    const progressEvents: ResumableUploadProgress[] = [];
    const completeSession = vi.fn().mockResolvedValue({ fileId: 'file-123' });

    const result = await uploadFileResumable({
      data: payload,
      contentType: 'video/mp4',
      session: {
        mode: 'multipart',
        sessionId: 'mp-session-1',
        partSizeBytes: 3,
      },
      completedParts: [{ partNumber: 1, etag: '"etag-1"', size: 3 }],
      concurrency: 2,
      maxPartRetries: 2,
      retryDelayMs: 1,
      fetchImpl: fetchMock as unknown as typeof fetch,
      getPartUploadTarget: ({ partNumber }) =>
        Promise.resolve({ url: `https://upload.test/part/${String(partNumber)}` }),
      onProgress: (p) => progressEvents.push(p),
      completeSession,
    });

    expect(result).toEqual({ fileId: 'file-123' });
    // Part 1 was already completed; part 2 failed once then succeeded; part 3 succeeded once
    expect(uploadedPartCalls).toEqual([2, 3, 2]);
    expect(completeSession).toHaveBeenCalledWith({
      sessionId: 'mp-session-1',
      parts: [
        { partNumber: 1, etag: '"etag-1"', size: 3 },
        { partNumber: 2, etag: '"etag-2"', size: 3 },
        { partNumber: 3, etag: '"etag-3"', size: 1 },
      ],
    });
    expect(progressEvents.at(-1)).toEqual({
      uploadedBytes: 7,
      totalBytes: 7,
      completedParts: 3,
      totalParts: 3,
    });
  });

  it('uploads single-PUT sessions and forwards ETag when present', async () => {
    const fetchSingle = vi
      .fn()
      .mockResolvedValue(new Response('', { status: 200, headers: { etag: '"single-etag"' } }));
    const completeSession = vi.fn().mockResolvedValue({ ok: true });

    const res = await uploadFileResumable({
      data: new Uint8Array([9, 8, 7]),
      contentType: 'image/webp',
      session: {
        mode: 'single',
        sessionId: 'single-1',
        uploadUrl: 'https://upload.test/direct',
      },
      fetchImpl: fetchSingle,
      completeSession,
    });

    expect(res).toEqual({ ok: true });
    expect(completeSession).toHaveBeenCalledWith({
      sessionId: 'single-1',
      etag: '"single-etag"',
    });
  });
});
