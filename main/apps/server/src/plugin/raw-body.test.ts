// main/apps/server/src/plugin/raw-body.test.ts

import { createHttpServer, type HttpServer } from '@bslt/server-system/http';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { registerPrototypePollutionProtection } from './prototype-pollution';
import { registerRawBodyCapture } from './raw-body';

describe('registerRawBodyCapture', () => {
  let server: HttpServer;

  beforeEach(async () => {
    server = createHttpServer({ bodyLimit: 1024 });
    registerPrototypePollutionProtection(server);
    registerRawBodyCapture(server);

    server.post('/raw', { config: { rawBody: true } }, (req) => {
      return { raw: req.rawBody?.toString() ?? null, body: req.body ?? null };
    });

    server.post('/normal', (req) => {
      return { raw: req.rawBody?.toString() ?? null, body: req.body ?? null };
    });

    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  test('captures the exact raw bytes and still parses the JSON body', async () => {
    // Whitespace and key order must survive — HMAC verification needs the
    // bytes the sender signed, not a re-serialization.
    const payload = '{ "b" : 1,\n "a": "x" }';
    const response = await server.inject({
      method: 'POST',
      url: '/raw',
      headers: { 'content-type': 'application/json' },
      payload,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { raw: string; body: unknown };
    expect(body.raw).toBe(payload);
    expect(body.body).toEqual({ b: 1, a: 'x' });
  });

  test('does not capture on routes that have not opted in', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/normal',
      headers: { 'content-type': 'application/json' },
      payload: '{"safe":true}',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { raw: string | null; body: unknown };
    expect(body.raw).toBeNull();
    expect(body.body).toEqual({ safe: true });
  });

  test('leaves rawBody undefined for a bodyless request', async () => {
    const response = await server.inject({ method: 'POST', url: '/raw' });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { raw: string | null };
    expect(body.raw).toBeNull();
  });

  test('rejects invalid JSON with 400 — the parser still runs on the replayed stream', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/raw',
      headers: { 'content-type': 'application/json' },
      payload: '{invalid json}',
    });

    expect(response.statusCode).toBe(400);
  });

  test('keeps prototype-pollution keys in rawBody while the parsed body is sanitized', async () => {
    const payload = '{"safe":"value","__proto__":{"isAdmin":true}}';
    const response = await server.inject({
      method: 'POST',
      url: '/raw',
      headers: { 'content-type': 'application/json' },
      payload,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { raw: string; body: Record<string, unknown> };
    expect(body.raw).toBe(payload);
    expect(body.body).toEqual({ safe: 'value' });
    expect(({} as Record<string, unknown>)['isAdmin']).toBeUndefined();
  });

  test('rejects payloads above the body limit with 413', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/raw',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ data: 'x'.repeat(2048) }),
    });

    expect(response.statusCode).toBe(413);
  });
});
