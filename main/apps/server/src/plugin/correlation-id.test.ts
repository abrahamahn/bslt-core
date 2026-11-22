// main/apps/server/src/plugin/correlation-id.test.ts

import {
  generateCorrelationId,
  type HttpServer,
  type HttpServerReply,
  type HttpServerRequest,
} from '@bslt/server-system/http';
import { describe, expect, it, vi } from 'vitest';

import { registerCorrelationIdHook } from './correlation-id';

describe('generateCorrelationId', () => {
  it('should generate a valid UUID', () => {
    const id = generateCorrelationId();

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('should generate unique IDs', () => {
    const ids = new Set<string>();

    for (let i = 0; i < 100; i++) {
      ids.add(generateCorrelationId());
    }

    expect(ids.size).toBe(100);
  });
});

describe('registerCorrelationIdHook', () => {
  it('should register an onRequest hook', () => {
    const addHookMock = vi.fn();
    const mockApp = {
      addHook: addHookMock,
    } as unknown as HttpServer;

    registerCorrelationIdHook(mockApp);

    expect(addHookMock).toHaveBeenCalledWith('onRequest', expect.any(Function));
  });

  it('should set correlation ID on request and response', async () => {
    let hookFn: ((req: HttpServerRequest, reply: HttpServerReply) => Promise<void>) | undefined;

    const mockApp = {
      addHook: vi.fn((event: string, fn: typeof hookFn) => {
        if (event === 'onRequest') {
          hookFn = fn;
        }
      }),
    } as unknown as HttpServer;

    registerCorrelationIdHook(mockApp);

    const mockReq = {
      headers: {},
    } as unknown as HttpServerRequest;
    const headerMock = vi.fn();
    const mockReply = {
      header: headerMock,
    } as unknown as HttpServerReply;

    await hookFn!(mockReq, mockReply);

    expect(mockReq.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(headerMock).toHaveBeenCalledWith(
      'x-correlation-id',
      expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      ),
    );
  });

  it('should use an existing trusted correlation ID header', async () => {
    let hookFn: ((req: HttpServerRequest, reply: HttpServerReply) => Promise<void>) | undefined;

    const mockApp = {
      addHook: vi.fn((event: string, fn: typeof hookFn) => {
        if (event === 'onRequest') {
          hookFn = fn;
        }
      }),
    } as unknown as HttpServer;

    registerCorrelationIdHook(mockApp, { trustProxy: true });

    const existingId = 'my-existing-correlation-id-123';
    const mockReq = {
      headers: {
        'x-correlation-id': existingId,
      },
    } as unknown as HttpServerRequest;
    const headerMock = vi.fn();
    const mockReply = {
      header: headerMock,
    } as unknown as HttpServerReply;

    await hookFn!(mockReq, mockReply);

    expect(mockReq.correlationId).toBe(existingId);
    expect(headerMock).toHaveBeenCalledWith('x-correlation-id', existingId);
  });

  it('should generate a new ID when trustProxy is false', async () => {
    let hookFn: ((req: HttpServerRequest, reply: HttpServerReply) => Promise<void>) | undefined;

    const mockApp = {
      addHook: vi.fn((event: string, fn: typeof hookFn) => {
        if (event === 'onRequest') {
          hookFn = fn;
        }
      }),
    } as unknown as HttpServer;

    registerCorrelationIdHook(mockApp, { trustProxy: false });

    const existingId = 'my-existing-correlation-id-123';
    const mockReq = {
      headers: {
        'x-correlation-id': existingId,
      },
    } as unknown as HttpServerRequest;
    const headerMock = vi.fn();
    const mockReply = {
      header: headerMock,
    } as unknown as HttpServerReply;

    await hookFn!(mockReq, mockReply);

    expect(mockReq.correlationId).not.toBe(existingId);
    expect(mockReq.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('should reject invalid correlation IDs', async () => {
    let hookFn: ((req: HttpServerRequest, reply: HttpServerReply) => Promise<void>) | undefined;

    const mockApp = {
      addHook: vi.fn((event: string, fn: typeof hookFn) => {
        if (event === 'onRequest') {
          hookFn = fn;
        }
      }),
    } as unknown as HttpServer;

    registerCorrelationIdHook(mockApp);

    const mockReq = {
      headers: {
        'x-correlation-id': 'invalid\r\nheader-injection',
      },
    } as unknown as HttpServerRequest;
    const headerMock = vi.fn();
    const mockReply = {
      header: headerMock,
    } as unknown as HttpServerReply;

    await hookFn!(mockReq, mockReply);

    expect(mockReq.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('should use a custom header name when specified', async () => {
    let hookFn: ((req: HttpServerRequest, reply: HttpServerReply) => Promise<void>) | undefined;

    const mockApp = {
      addHook: vi.fn((event: string, fn: typeof hookFn) => {
        if (event === 'onRequest') {
          hookFn = fn;
        }
      }),
    } as unknown as HttpServer;

    registerCorrelationIdHook(mockApp, { headerName: 'x-request-id' });

    const existingId = 'custom-header-id-456';
    const mockReq = {
      headers: {
        'x-request-id': existingId,
      },
    } as unknown as HttpServerRequest;
    const headerMock = vi.fn();
    const mockReply = {
      header: headerMock,
    } as unknown as HttpServerReply;

    await hookFn!(mockReq, mockReply);

    expect(mockReq.correlationId).toBe(existingId);
    expect(headerMock).toHaveBeenCalledWith('x-request-id', existingId);
  });
});
