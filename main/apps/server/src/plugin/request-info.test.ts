// main/apps/server/src/plugin/request-info.test.ts

import { createHttpServer, type HttpServer } from '@bslt/server-system/http';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { registerRequestInfoHook } from './request-info';

describe('Request Info Middleware', () => {
  let server: HttpServer;

  beforeEach(async () => {
    server = createHttpServer();
    registerRequestInfoHook(server);

    server.get('/test', (request) => ({
      ipAddress: request.requestInfo.ipAddress,
      userAgent: request.requestInfo.userAgent,
    }));

    server.post('/test-post', (request) => ({
      ipAddress: request.requestInfo.ipAddress,
      userAgent: request.requestInfo.userAgent,
    }));

    server.put('/test-put', (request) => ({
      ipAddress: request.requestInfo.ipAddress,
      userAgent: request.requestInfo.userAgent,
    }));

    server.get('/handler-test', (request, reply) => {
      const info = (request as unknown as Record<string, unknown>)['requestInfo'];
      if (info === null || info === undefined) {
        return reply.status(500).send({ error: 'requestInfo not available' });
      }
      return {
        hasIpAddress: typeof (info as { ipAddress?: unknown }).ipAddress === 'string',
        hasUserAgent: 'userAgent' in (info as object),
      };
    });

    server.get('/type-test', (request) => {
      const info = request.requestInfo;
      return {
        ipAddressType: typeof info.ipAddress,
        userAgentType: typeof info.userAgent,
        keys: Object.keys(info).sort(),
      };
    });

    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  describe('IP address extraction', () => {
    test('should extract IP address from request', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/test',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        ipAddress: string;
        userAgent: string | undefined;
      };
      expect(body.ipAddress).toBe('127.0.0.1');
    });

    test('should return unknown when IP cannot be determined', async () => {
      const customServer = createHttpServer();

      customServer.addHook('onRequest', (req, _reply, done) => {
        Object.defineProperty(req, 'ip', { value: '', writable: true });
        done();
      });

      registerRequestInfoHook(customServer);
      customServer.get('/test', (request) => ({
        ipAddress: request.requestInfo.ipAddress,
      }));

      await customServer.ready();

      const response = await customServer.inject({
        method: 'GET',
        url: '/test',
      });

      const body = JSON.parse(response.body) as { ipAddress: string };
      expect(body.ipAddress).toBe('unknown');

      await customServer.close();
    });
  });

  describe('user agent extraction', () => {
    test('should extract user agent from headers', async () => {
      const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Test Browser';

      const response = await server.inject({
        method: 'GET',
        url: '/test',
        headers: {
          'user-agent': userAgent,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        ipAddress: string;
        userAgent: string | undefined;
      };
      expect(body.userAgent).toBe(userAgent);
    });

    test('should return the default inject user agent when no header is provided', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/test',
        headers: {},
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        ipAddress: string;
        userAgent: string | undefined;
      };
      expect(body.userAgent).toBe('bslt-inject');
    });

    test('should truncate long user agents to prevent log bloat', async () => {
      const maxLength = 500;
      const longUserAgent = 'A'.repeat(1000);

      const response = await server.inject({
        method: 'GET',
        url: '/test',
        headers: {
          'user-agent': longUserAgent,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        ipAddress: string;
        userAgent: string | undefined;
      };
      expect(body.userAgent).toBeDefined();
      expect(body.userAgent).toBe('A'.repeat(maxLength));
    });

    test('should handle empty user agent string as undefined', async () => {
      const customServer = createHttpServer();
      registerRequestInfoHook(customServer);

      customServer.get('/test', (request) => ({
        userAgent: request.requestInfo.userAgent,
      }));

      await customServer.ready();

      const response = await customServer.inject({
        method: 'GET',
        url: '/test',
        headers: {
          'user-agent': '',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        userAgent: string | undefined;
      };
      expect(body.userAgent).toBeUndefined();

      await customServer.close();
    });
  });

  describe('hook behavior', () => {
    test('should attach requestInfo on every request', async () => {
      for (let i = 0; i < 3; i++) {
        const response = await server.inject({
          method: 'GET',
          url: '/test',
          headers: {
            'user-agent': `Test Agent ${String(i)}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body) as {
          ipAddress: string;
          userAgent: string | undefined;
        };
        expect(body.ipAddress).toBe('127.0.0.1');
        expect(body.userAgent).toBe(`Test Agent ${String(i)}`);
      }
    });

    test('should work with different HTTP methods', async () => {
      const methods = ['GET', 'POST', 'PUT'] as const;
      const urls = ['/test', '/test-post', '/test-put'];

      for (let i = 0; i < methods.length; i++) {
        const method = methods[i]!;
        const url = urls[i]!;
        const injectOptions =
          method !== 'GET'
            ? {
                method,
                url,
                headers: { 'user-agent': 'Test Agent' },
                payload: {},
              }
            : {
                method,
                url,
                headers: { 'user-agent': 'Test Agent' },
              };
        const response = await server.inject(injectOptions);

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body) as {
          ipAddress: string;
          userAgent: string | undefined;
        };
        expect(body.ipAddress).toBeDefined();
        expect(body.userAgent).toBe('Test Agent');
      }
    });

    test('should be available in route handlers', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/handler-test',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        hasIpAddress: boolean;
        hasUserAgent: boolean;
      };
      expect(body.hasIpAddress).toBe(true);
      expect(body.hasUserAgent).toBe(true);
    });
  });

  describe('real-world user agents', () => {
    const realUserAgents = [
      {
        name: 'Chrome on Windows',
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      {
        name: 'Firefox on macOS',
        ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0',
      },
      {
        name: 'Safari on iOS',
        ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
      },
      {
        name: 'Edge on Windows',
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
      },
      {
        name: 'curl',
        ua: 'curl/8.4.0',
      },
      {
        name: 'Bot',
        ua: 'Googlebot/2.1 (+http://www.google.com/bot.html)',
      },
    ];

    for (const { name, ua } of realUserAgents) {
      test(`should handle ${name} user agent`, async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/test',
          headers: {
            'user-agent': ua,
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body) as {
          ipAddress: string;
          userAgent: string | undefined;
        };
        expect(body.userAgent).toBe(ua);
      });
    }
  });

  describe('type safety', () => {
    test('requestInfo should have the expected shape', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/type-test',
        headers: {
          'user-agent': 'Test',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        ipAddressType: string;
        userAgentType: string;
        keys: string[];
      };
      expect(body.ipAddressType).toBe('string');
      expect(body.userAgentType).toBe('string');
      expect(body.keys).toEqual(['ip', 'ipAddress', 'userAgent']);
    });
  });
});
