// main/apps/server/src/plugin/prototype-pollution.test.ts

import { createHttpServer, type HttpServer } from '@bslt/server-system/http';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { registerPrototypePollutionProtection } from './prototype-pollution';

describe('registerPrototypePollutionProtection', () => {
  let server: HttpServer;

  beforeEach(async () => {
    server = createHttpServer();
    registerPrototypePollutionProtection(server);

    server.post('/test', (req) => {
      return { received: req.body };
    });

    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  test('sanitizes JSON bodies with __proto__ payloads', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/test',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ safe: 'value', __proto__: { isAdmin: true } }),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { received: Record<string, unknown> };
    expect(body.received).toEqual({ safe: 'value' });
    expect(body.received).not.toHaveProperty('__proto__');
  });

  test('handles empty bodies', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/test',
      headers: { 'content-type': 'application/json' },
      payload: '',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { received: unknown };
    expect(body.received).toBeUndefined();
  });

  test('handles whitespace-only bodies', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/test',
      headers: { 'content-type': 'application/json' },
      payload: '   ',
    });

    expect(response.statusCode).toBe(200);
  });

  test('rejects invalid JSON with 400', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/test',
      headers: { 'content-type': 'application/json' },
      payload: '{invalid json}',
    });

    expect(response.statusCode).toBe(400);
  });

  test('passes through safe JSON unchanged', async () => {
    const safePayload = { name: 'test', nested: { value: 123 } };
    const response = await server.inject({
      method: 'POST',
      url: '/test',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(safePayload),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { received: typeof safePayload };
    expect(body.received).toEqual(safePayload);
  });
});
