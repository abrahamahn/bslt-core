// tests/integration/api/platform-errors.integration.test.ts
/**
 * POST /api/platform/errors through the production server (`buildTestServer`):
 * CSRF, body limit, content-type parsing and the error mapper all run as in
 * production, over mocks and without a database.
 */
import { createAuthGuard } from '@bslt/identity/server';
import { createRouteMap, publicRoute, type RouteMap } from '@bslt/server-system/http';
import { buildPlatformErrorsRouteMap } from '@bslt/server-system/observability';
import { buildTestServer, registerTestRouteMap, type TestServer } from '@bslt/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ROUTE = '/api/platform/errors';
// Any other route: the injection filter still guards it.
const PROBE = '/api/probe/echo';
// A valid identifier: the global input sanitizer silently drops any other key name.
const MARKER = 'injectedMarker51c9';

const report = {
  source: 'error',
  name: 'TypeError',
  message: 'x is not a function',
  path: '/dashboard',
};

describe('POST /api/platform/errors', () => {
  let testServer: TestServer;
  const probe = vi.fn(() => ({ status: 204, body: undefined }));

  beforeAll(async () => {
    testServer = await buildTestServer();
    const register = (routes: RouteMap, module: string): void => {
      registerTestRouteMap(
        testServer.server,
        { config: testServer.config, log: testServer.log },
        routes,
        {
          prefix: '/api',
          jwtSecret: testServer.config.auth.jwt.secret,
          authGuardFactory: createAuthGuard,
          module,
        },
      );
    };
    register(buildPlatformErrorsRouteMap(), 'system');
    register(createRouteMap([['probe/echo', publicRoute('POST', probe)]]), 'probe');
    await testServer.ready();
  });

  afterAll(async () => {
    await testServer.close();
  });

  beforeEach(() => {
    testServer.log.error.mockClear();
  });

  const clientReports = (): unknown[] =>
    testServer.log.error.mock.calls.filter(([, message]) => message === 'Client error report');

  it('accepts a valid report: 204, an empty body, one log event', async () => {
    const response = await testServer.inject({
      method: 'POST',
      url: ROUTE,
      payload: { reports: [report] },
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect(clientReports()).toHaveLength(1);
  });

  it('refuses a body over the limit with 413', async () => {
    const response = await testServer.inject({
      method: 'POST',
      url: ROUTE,
      payload: { reports: [{ ...report, message: 'x'.repeat(9000) }] },
    });

    expect(response.statusCode).toBe(413);
    expect(clientReports()).toHaveLength(0);
  });

  it('refuses an unknown key with 400 and never echoes it', async () => {
    const response = await testServer.inject({
      method: 'POST',
      url: ROUTE,
      payload: { reports: [{ ...report, [MARKER]: MARKER }] },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain(MARKER);
    expect(clientReports()).toHaveLength(0);
  });

  it('refuses a body that is not JSON', async () => {
    const response = await testServer.inject({
      method: 'POST',
      url: ROUTE,
      headers: { 'content-type': 'text/plain' },
      payload: MARKER,
    });

    expect([400, 415]).toContain(response.statusCode);
    expect(response.body).not.toContain(MARKER);
  });

  it('still enforces CSRF', async () => {
    await testServer.ready();
    const response = await testServer.server.inject({
      method: 'POST',
      url: ROUTE,
      payload: { reports: [report] },
    });

    expect(response.statusCode).toBe(403);
    expect(clientReports()).toHaveLength(0);
  });

  it('answers the eleventh request a minute from one IP with 429 and Retry-After', async () => {
    const send = () =>
      testServer.inject({
        method: 'POST',
        url: ROUTE,
        remoteAddress: '198.51.100.23',
        payload: { reports: [report] },
      });

    for (let i = 0; i < 10; i += 1) expect((await send()).statusCode).toBe(204);
    const refused = await send();

    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toMatchObject({ message: 'Too many error reports' });
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    expect(clientReports()).toHaveLength(10);
  });

  // Minified stack traces and error messages read like SQL or NoSQL injection
  // to the global input filter; this route is exempt from it (owner decision),
  // and every other route keeps it.
  const injectionLookalikes: [string, Record<string, string>][] = [
    [
      'a chunk name with a double hyphen',
      { stack: '    at f (https://app/assets/index--AbC12.js:1:2)' },
    ],
    ['a message that reads like SQL', { message: 'Please select a plan from the list' }],
    [
      'a message naming a query operator',
      { message: "Cannot read properties of null (reading '$type')" },
    ],
  ];

  it.each(injectionLookalikes)('accepts %s and logs it', async (_label, fields) => {
    const response = await testServer.inject({
      method: 'POST',
      url: ROUTE,
      remoteAddress: '198.51.100.24',
      payload: { reports: [{ ...report, ...fields }] },
    });

    expect(response.statusCode).toBe(204);
    expect(clientReports()).toHaveLength(1);
  });

  it.each(injectionLookalikes)(
    'still refuses %s on any other route with 400, before the handler',
    async (_label, fields) => {
      probe.mockClear();
      const response = await testServer.inject({
        method: 'POST',
        url: PROBE,
        payload: { reports: [{ ...report, ...fields }] },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(probe).not.toHaveBeenCalled();
    },
  );

  it('serves no GET', async () => {
    const response = await testServer.inject({ method: 'GET', url: ROUTE });

    expect(response.statusCode).toBe(404);
  });
});
