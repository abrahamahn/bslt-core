// main/kernel/protocols/src/otlp.test.ts
import { describe, expect, it, vi } from 'vitest';

import {
  OtlpProtocolError,
  createOtlpHttpExporter,
  encodeOtlpMetricsPayload,
  encodeOtlpTracePayload,
  formatTraceparent,
  generateSpanId,
  generateTraceId,
  parseTraceparent,
} from './otlp';

describe('@bslt/protocols/otlp — W3C Trace Context & OTLP/HTTP JSON exporter', () => {
  it('rejects malformed, uppercase, unsupported-version, and all-zero W3C traceparent headers', () => {
    expect(parseTraceparent('')).toBeNull();
    expect(parseTraceparent('00-short-span-01')).toBeNull();
    expect(parseTraceparent('00-4BF92F3577B34DA6A3CE929D0E0E4736-00f067aa0ba902b7-01')).toBeNull();
    expect(parseTraceparent('ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')).toBeNull();
    expect(parseTraceparent('00-00000000000000000000000000000000-00f067aa0ba902b7-01')).toBeNull();
    expect(parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01')).toBeNull();
    expect(parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-zz')).toBeNull();
    expect(
      parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01-extra'),
    ).toBeNull();
  });

  it('throws OtlpProtocolError when formatting invalid traceparent components and round-trips W3C vectors', () => {
    expect(() =>
      formatTraceparent({
        traceId: '00000000000000000000000000000000',
        spanId: '00f067aa0ba902b7',
        sampled: true,
      }),
    ).toThrow(OtlpProtocolError);
    expect(() =>
      formatTraceparent({
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        spanId: '0000000000000000',
        sampled: true,
      }),
    ).toThrow(OtlpProtocolError);
    expect(() =>
      formatTraceparent({
        traceId: 'not-hex',
        spanId: '00f067aa0ba902b7',
        sampled: false,
      }),
    ).toThrow(OtlpProtocolError);

    const w3cVector = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const parsed = parseTraceparent(w3cVector);
    expect(parsed).toEqual({
      version: '00',
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      traceFlags: 1,
      sampled: true,
    });
    expect(
      formatTraceparent({
        traceId: parsed!.traceId,
        spanId: parsed!.spanId,
        sampled: parsed!.sampled,
      }),
    ).toBe(w3cVector);

    expect(generateTraceId()).toMatch(/^[0-9a-f]{32}$/u);
    expect(generateSpanId()).toMatch(/^[0-9a-f]{16}$/u);
  });

  it('rejects invalid span IDs or inverted timestamps when encoding OTLP trace and metric payloads', () => {
    expect(() =>
      encodeOtlpTracePayload({ serviceName: 'bslt-api' }, [
        {
          traceId: 'bad-trace-id',
          spanId: '00f067aa0ba902b7',
          name: 'GET /api/tasks',
          startTimeMs: 1000,
          endTimeMs: 1010,
          status: 'ok',
        },
      ]),
    ).toThrow(OtlpProtocolError);

    expect(() =>
      encodeOtlpTracePayload({ serviceName: 'bslt-api' }, [
        {
          traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
          spanId: '00f067aa0ba902b7',
          name: 'GET /api/tasks',
          startTimeMs: 2000,
          endTimeMs: 1999,
          status: 'ok',
        },
      ]),
    ).toThrow(OtlpProtocolError);

    expect(() => encodeOtlpMetricsPayload({ serviceName: '' }, [])).toThrow(OtlpProtocolError);

    const tracePayload = encodeOtlpTracePayload(
      { serviceName: 'bslt-api', serviceVersion: '1.0.0', attributes: { role: 'api' } },
      [
        {
          traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
          spanId: '00f067aa0ba902b7',
          parentSpanId: '1111111111111111',
          name: 'GET /api/tasks',
          kind: 'server',
          startTimeMs: 1_700_000_000_000,
          endTimeMs: 1_700_000_000_025,
          status: 'error',
          statusMessage: 'boom',
          attributes: {
            'http.method': 'GET',
            'http.status_code': 500,
            'http.duration_ms': 25.5,
            error: true,
          },
        },
      ],
    );
    const span = tracePayload.resourceSpans[0]?.scopeSpans[0]?.spans[0];
    expect(span?.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(span?.parentSpanId).toBe('1111111111111111');
    expect(span?.startTimeUnixNano).toBe('1700000000000000000');
    expect(span?.endTimeUnixNano).toBe('1700000000025000000');
    expect(span?.status).toEqual({ code: 2, message: 'boom' });

    const metricsPayload = encodeOtlpMetricsPayload({ serviceName: 'bslt-api' }, [
      {
        name: 'bslt.requests.total',
        kind: 'sum',
        value: 42,
        timeMs: 1_700_000_000_000,
        startTimeMs: 1_700_000_000_000,
        attributes: { status: '200' },
      },
      {
        name: 'bslt.db.up',
        kind: 'gauge',
        value: 1,
        timeMs: 1_700_000_000_000,
      },
    ]);
    expect(metricsPayload.resourceMetrics[0]?.scopeMetrics[0]?.metrics).toHaveLength(2);
  });

  it('rejects invalid exporter config, bounds queue overflow, does not retry 4xx, retries 503, and drains on shutdown', async () => {
    expect(() =>
      createOtlpHttpExporter({
        endpoint: 'ftp://collector.internal:4318',
        serviceName: 'bslt-api',
      }),
    ).toThrow(OtlpProtocolError);
    expect(() =>
      createOtlpHttpExporter({
        endpoint: 'https://collector.internal:4318',
        serviceName: 'bslt-api',
        maxQueueSize: 0,
      }),
    ).toThrow(OtlpProtocolError);

    let callCount = 0;
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      callCount += 1;
      const url = String(input);
      if (url.endsWith('/v1/metrics')) {
        return new Response('{}', { status: 400 });
      }
      if (callCount === 1) {
        return new Response('unavailable', { status: 503 });
      }
      return new Response('{}', { status: 200 });
    });

    const exporter = createOtlpHttpExporter({
      endpoint: 'https://collector.internal:4318/',
      serviceName: 'bslt-api',
      headers: { Authorization: 'Bearer secret-token' },
      maxQueueSize: 2,
      maxBatchSize: 2,
      maxRetries: 2,
      retryDelayMs: 1,
      timeoutMs: 1000,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const baseTraceId = generateTraceId();
    exporter.recordSpan({
      traceId: baseTraceId,
      spanId: generateSpanId(),
      name: 'span-1',
      startTimeMs: 100,
      endTimeMs: 110,
      status: 'ok',
    });
    exporter.recordSpan({
      traceId: baseTraceId,
      spanId: generateSpanId(),
      name: 'span-2',
      startTimeMs: 110,
      endTimeMs: 120,
      status: 'ok',
    });
    exporter.recordSpan({
      traceId: baseTraceId,
      spanId: generateSpanId(),
      name: 'span-3',
      startTimeMs: 120,
      endTimeMs: 130,
      status: 'ok',
    });

    expect(exporter.stats().droppedSpans).toBe(1);

    await exporter.flush();
    expect(exporter.stats().exportedSpans).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2); // 503 then 200

    // 400 on /v1/metrics must NOT retry
    const metricsOk = await exporter.exportMetrics([
      { name: 'bslt.db.up', kind: 'gauge', value: 1, timeMs: 1000 },
    ]);
    expect(metricsOk).toBe(false);
    expect(exporter.stats().failedBatches).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await exporter.shutdown();
    exporter.recordSpan({
      traceId: baseTraceId,
      spanId: generateSpanId(),
      name: 'span-after-shutdown',
      startTimeMs: 200,
      endTimeMs: 210,
      status: 'ok',
    });
    expect(exporter.stats().droppedSpans).toBe(2);
  });
});
