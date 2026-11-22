// main/apps/server/src/http/file-server.test.ts
/**
 * Tests for the static file server's upload rate limiter.
 *
 * Drives the real routes via fastify.inject. Requesters are isolated per
 * test through distinct x-forwarded-for IPs since the limiter state is
 * module-level. Covers the limit boundary, requester isolation, and
 * window expiry (per-key reset without a full-map scan per request).
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createHttpServer, type HttpServer } from '@bslt/server-system/http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerFileServer } from './file-server';

const RATE_LIMIT_MAX_REQUESTS = 180;
const WINDOW_MS = 60_000;

describe('file server rate limiting', () => {
  let app: HttpServer;

  beforeAll(async () => {
    app = createHttpServer();
    registerFileServer(
      {
        uploadDir: mkdtempSync(join(tmpdir(), 'file-server-test-')),
        maxFileSize: 1024,
        signatureSecret: Buffer.from('test-secret'),
      },
      app,
    );
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // Fake timers stall fastify.inject, so control time via Date.now alone —
  // the only clock the rate limiter reads
  const BASE_TIME = 1_750_000_000_000;
  let nowSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    nowSpy = vi.spyOn(Date, 'now').mockReturnValue(BASE_TIME);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  async function get(ip: string): Promise<number> {
    const response = await app.inject({
      method: 'GET',
      url: '/uploads/test-id/test.txt',
      headers: { 'x-forwarded-for': ip },
    });
    return response.statusCode;
  }

  it('should allow requests up to the limit and reject the next with 429', async () => {
    const ip = '10.0.0.1';
    for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i++) {
      expect(await get(ip)).not.toBe(429);
    }
    expect(await get(ip)).toBe(429);
  });

  it('should track requesters independently', async () => {
    for (let i = 0; i <= RATE_LIMIT_MAX_REQUESTS; i++) {
      await get('10.0.0.2');
    }
    expect(await get('10.0.0.2')).toBe(429);
    expect(await get('10.0.0.3')).not.toBe(429);
  });

  it('should reset a requester after the window expires', async () => {
    const ip = '10.0.0.4';
    for (let i = 0; i <= RATE_LIMIT_MAX_REQUESTS; i++) {
      await get(ip);
    }
    expect(await get(ip)).toBe(429);

    nowSpy.mockReturnValue(BASE_TIME + WINDOW_MS + 1);

    expect(await get(ip)).not.toBe(429);
  });
});
