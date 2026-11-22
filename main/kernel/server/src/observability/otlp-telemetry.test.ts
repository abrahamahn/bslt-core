// main/kernel/server/src/observability/otlp-telemetry.test.ts
import { OtlpProtocolError } from '@bslt/protocols/otlp';
import { describe, expect, it, vi } from 'vitest';

import { startOtlpHttpTelemetry } from './otlp-telemetry';

function createFakeHookServer() {
  const onRequestHooks: Array<(req: unknown, reply: unknown, done: () => void) => void> = [];
  const onResponseHooks: Array<(req: unknown, reply: unknown, done: () => void) => void> = [];
  const onCloseHooks: Array<(instance: unknown, done: () => void) => Promise<void> | void> = [];

  return {
    onRequestHooks,
    onResponseHooks,
    onCloseHooks,
    server: {
      addHook(name: string, hook: (...args: never[]) => unknown) {
        if (name === 'onRequest') {
          onRequestHooks.push(hook as (req: unknown, reply: unknown, done: () => void) => void);
        } else if (name === 'onResponse') {
          onResponseHooks.push(hook as (req: unknown, reply: unknown, done: () => void) => void);
        } else if (name === 'onClose') {
          onCloseHooks.push(hook as (instance: unknown, done: () => void) => Promise<void> | void);
        }
      },
    },
  };
}

describe('startOtlpHttpTelemetry', () => {
  it('stays inert when OTEL_EXPORTER_OTLP_ENDPOINT is unset or blank', () => {
    const fake = createFakeHookServer();
    expect(startOtlpHttpTelemetry(fake.server, { env: {} })).toBeNull();
    expect(
      startOtlpHttpTelemetry(fake.server, { env: { OTEL_EXPORTER_OTLP_ENDPOINT: '   ' } }),
    ).toBeNull();
    expect(fake.onRequestHooks).toHaveLength(0);
    expect(fake.onResponseHooks).toHaveLength(0);
    expect(fake.onCloseHooks).toHaveLength(0);
  });

  it('rejects invalid OTEL_EXPORTER_OTLP_ENDPOINT URLs and malformed OTEL_EXPORTER_OTLP_HEADERS at boot', () => {
    const fake = createFakeHookServer();
    expect(() =>
      startOtlpHttpTelemetry(fake.server, {
        env: { OTEL_EXPORTER_OTLP_ENDPOINT: 'not-a-valid-url' },
      }),
    ).toThrow(OtlpProtocolError);

    expect(() =>
      startOtlpHttpTelemetry(fake.server, {
        env: {
          OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otel.example.com',
          OTEL_EXPORTER_OTLP_HEADERS: 'MalformedHeaderWithoutEquals',
        },
      }),
    ).toThrow(OtlpProtocolError);
  });

  it('propagates valid W3C traceparent, replaces malformed traceparent, and flushes spans on close', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    const fake = createFakeHookServer();

    const exporter = startOtlpHttpTelemetry(fake.server, {
      env: {
        OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otel.example.com',
        OTEL_SERVICE_NAME: 'bslt-api-test',
        OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Bearer test-key, x-tenant=core',
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
      flushThreshold: 10,
    });
    expect(exporter).not.toBeNull();

    const responseHeaders: Record<string, string> = {};
    const req = {
      method: 'GET',
      url: '/api/tasks',
      headers: {
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      },
      routeOptions: { url: '/api/tasks' },
    };
    const reply = {
      statusCode: 502,
      elapsedTime: 18,
      header(key: string, val: string) {
        responseHeaders[key] = val;
      },
    };

    for (const h of fake.onRequestHooks) h(req, reply, () => {});
    expect(responseHeaders['traceparent']).toMatch(
      /^00-4bf92f3577b34da6a3ce929d0e0e4736-[0-9a-f]{16}-01$/u,
    );

    for (const h of fake.onResponseHooks) h(req, reply, () => {});
    expect(exporter!.stats().queuedSpans).toBe(1);

    // Malformed incoming traceparent generates a fresh traceId instead of crashing
    const badReq = {
      method: 'POST',
      url: '/api/tasks/create',
      headers: { traceparent: 'invalid-header' },
      routeOptions: { url: '/api/tasks/create' },
    };
    const badReply = {
      statusCode: 201,
      elapsedTime: 5,
      header(key: string, val: string) {
        responseHeaders[key] = val;
      },
    };
    for (const h of fake.onRequestHooks) h(badReq, badReply, () => {});
    for (const h of fake.onResponseHooks) h(badReq, badReply, () => {});
    expect(exporter!.stats().queuedSpans).toBe(2);

    // Trigger onClose hook -> drains queue to OTLP collector
    for (const h of fake.onCloseHooks) {
      await new Promise<void>((resolve) => {
        void h({}, resolve);
      });
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(exporter!.stats().exportedSpans).toBe(2);
  });
});
