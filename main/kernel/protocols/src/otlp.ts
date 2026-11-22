// main/kernel/protocols/src/otlp.ts
/**
 * Owned OpenTelemetry Protocol over HTTP/JSON (`@bslt/protocols/otlp`) and W3C
 * Trace Context v1 (`traceparent`), built strictly on `node:crypto` and `fetch`
 * (restructure plan §4 & §17.2 Phase 20).
 */
import { randomBytes } from 'node:crypto';

const TRACE_ID_RE = /^[0-9a-f]{32}$/u;
const SPAN_ID_RE = /^[0-9a-f]{16}$/u;
const FLAGS_RE = /^[0-9a-f]{2}$/u;
const ZERO_TRACE_ID = '00000000000000000000000000000000';
const ZERO_SPAN_ID = '0000000000000000';
const RETRYABLE_HTTP_STATUSES = new Set([429, 502, 503, 504]);

type OtlpAttributePrimitive = string | number | boolean;

interface OtlpResourceDescriptor {
  readonly serviceName: string;
  readonly serviceVersion?: string;
  readonly attributes?: Readonly<Record<string, OtlpAttributePrimitive>>;
}

interface OtlpSpanInput {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly kind?: 'internal' | 'server' | 'client' | 'producer' | 'consumer';
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly status: 'unset' | 'ok' | 'error';
  readonly statusMessage?: string;
  readonly attributes?: Readonly<Record<string, OtlpAttributePrimitive>>;
}

interface OtlpMetricSample {
  readonly name: string;
  readonly kind: 'gauge' | 'sum';
  readonly value: number;
  readonly timeMs: number;
  readonly startTimeMs?: number;
  readonly attributes?: Readonly<Record<string, OtlpAttributePrimitive>>;
}

interface TraceparentContext {
  readonly version: '00';
  readonly traceId: string;
  readonly spanId: string;
  readonly traceFlags: number;
  readonly sampled: boolean;
}

interface OtlpAnyValue {
  readonly stringValue?: string;
  readonly intValue?: string;
  readonly doubleValue?: number;
  readonly boolValue?: boolean;
}

interface OtlpKeyValue {
  readonly key: string;
  readonly value: OtlpAnyValue;
}

interface OtlpWireSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly kind: number;
  readonly startTimeUnixNano: string;
  readonly endTimeUnixNano: string;
  readonly attributes: readonly OtlpKeyValue[];
  readonly status: {
    readonly code: number;
    readonly message?: string;
  };
}

interface OtlpTracePayload {
  readonly resourceSpans: ReadonlyArray<{
    readonly resource: { readonly attributes: readonly OtlpKeyValue[] };
    readonly scopeSpans: ReadonlyArray<{
      readonly scope: { readonly name: string; readonly version: string };
      readonly spans: readonly OtlpWireSpan[];
    }>;
  }>;
}

interface OtlpMetricsPayload {
  readonly resourceMetrics: ReadonlyArray<{
    readonly resource: { readonly attributes: readonly OtlpKeyValue[] };
    readonly scopeMetrics: ReadonlyArray<{
      readonly scope: { readonly name: string; readonly version: string };
      readonly metrics: ReadonlyArray<Record<string, unknown>>;
    }>;
  }>;
}

interface OtlpExporterOptions {
  readonly endpoint: string;
  readonly serviceName: string;
  readonly serviceVersion?: string;
  readonly resourceAttributes?: Readonly<Record<string, OtlpAttributePrimitive>>;
  readonly headers?: Readonly<Record<string, string>>;
  readonly maxQueueSize?: number;
  readonly maxBatchSize?: number;
  readonly maxRetries?: number;
  readonly retryDelayMs?: number;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

interface OtlpExporterStats {
  readonly queuedSpans: number;
  readonly exportedSpans: number;
  readonly droppedSpans: number;
  readonly exportedMetrics: number;
  readonly failedBatches: number;
}

export interface OtlpHttpExporter {
  recordSpan(span: OtlpSpanInput): void;
  exportMetrics(samples: readonly OtlpMetricSample[]): Promise<boolean>;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
  stats(): OtlpExporterStats;
}

export class OtlpProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OtlpProtocolError';
  }
}

export function generateTraceId(): string {
  let id = randomBytes(16).toString('hex');
  while (id === ZERO_TRACE_ID) {
    id = randomBytes(16).toString('hex');
  }
  return id;
}

export function generateSpanId(): string {
  let id = randomBytes(8).toString('hex');
  while (id === ZERO_SPAN_ID) {
    id = randomBytes(8).toString('hex');
  }
  return id;
}

export function parseTraceparent(header: string | undefined | null): TraceparentContext | null {
  if (typeof header !== 'string') return null;
  const trimmed = header.trim();
  const parts = trimmed.split('-');
  if (parts.length !== 4) return null;
  const [version, traceId, spanId, flagsHex] = parts;
  if (version !== '00' || traceId === undefined || spanId === undefined || flagsHex === undefined) {
    return null;
  }
  if (!TRACE_ID_RE.test(traceId) || traceId === ZERO_TRACE_ID) return null;
  if (!SPAN_ID_RE.test(spanId) || spanId === ZERO_SPAN_ID) return null;
  if (!FLAGS_RE.test(flagsHex)) return null;
  const traceFlags = Number.parseInt(flagsHex, 16);
  return {
    version: '00',
    traceId,
    spanId,
    traceFlags,
    sampled: (traceFlags & 0x01) === 0x01,
  };
}

export function formatTraceparent(input: {
  readonly traceId: string;
  readonly spanId: string;
  readonly sampled?: boolean;
}): string {
  if (!TRACE_ID_RE.test(input.traceId) || input.traceId === ZERO_TRACE_ID) {
    throw new OtlpProtocolError('traceId must be 32 non-zero lowercase hex characters');
  }
  if (!SPAN_ID_RE.test(input.spanId) || input.spanId === ZERO_SPAN_ID) {
    throw new OtlpProtocolError('spanId must be 16 non-zero lowercase hex characters');
  }
  const flags = input.sampled === false ? '00' : '01';
  return `00-${input.traceId}-${input.spanId}-${flags}`;
}

function encodeAttributes(
  attrs: Readonly<Record<string, OtlpAttributePrimitive>> | undefined,
): OtlpKeyValue[] {
  if (attrs === undefined) return [];
  const out: OtlpKeyValue[] = [];
  for (const [key, val] of Object.entries(attrs)) {
    if (typeof val === 'string') {
      out.push({ key, value: { stringValue: val } });
    } else if (typeof val === 'boolean') {
      out.push({ key, value: { boolValue: val } });
    } else if (Number.isInteger(val)) {
      out.push({ key, value: { intValue: String(val) } });
    } else if (Number.isFinite(val)) {
      out.push({ key, value: { doubleValue: val } });
    }
  }
  return out;
}

function encodeResourceAttributes(resource: OtlpResourceDescriptor): OtlpKeyValue[] {
  if (resource.serviceName.trim() === '') {
    throw new OtlpProtocolError('OTLP serviceName must not be empty');
  }
  const merged: Record<string, OtlpAttributePrimitive> = {
    'service.name': resource.serviceName,
    ...(resource.serviceVersion !== undefined
      ? { 'service.version': resource.serviceVersion }
      : {}),
    ...(resource.attributes ?? {}),
  };
  return encodeAttributes(merged);
}

function msToUnixNanoString(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new OtlpProtocolError(`Invalid timestamp in milliseconds: ${String(ms)}`);
  }
  const wholeMicros = BigInt(Math.round(ms * 1000));
  return (wholeMicros * 1000n).toString(10);
}

function spanKindCode(kind: OtlpSpanInput['kind']): number {
  switch (kind) {
    case 'server':
      return 2;
    case 'client':
      return 3;
    case 'producer':
      return 4;
    case 'consumer':
      return 5;
    default:
      return 1; // SPAN_KIND_INTERNAL
  }
}

function statusCode(status: OtlpSpanInput['status']): number {
  switch (status) {
    case 'ok':
      return 1;
    case 'error':
      return 2;
    default:
      return 0;
  }
}

export function encodeOtlpTracePayload(
  resource: OtlpResourceDescriptor,
  spans: readonly OtlpSpanInput[],
): OtlpTracePayload {
  const resourceAttrs = encodeResourceAttributes(resource);
  const wireSpans: OtlpWireSpan[] = spans.map((span) => {
    if (!TRACE_ID_RE.test(span.traceId) || span.traceId === ZERO_TRACE_ID) {
      throw new OtlpProtocolError(`Invalid span traceId: "${span.traceId}"`);
    }
    if (!SPAN_ID_RE.test(span.spanId) || span.spanId === ZERO_SPAN_ID) {
      throw new OtlpProtocolError(`Invalid span spanId: "${span.spanId}"`);
    }
    if (
      span.parentSpanId !== undefined &&
      (!SPAN_ID_RE.test(span.parentSpanId) || span.parentSpanId === ZERO_SPAN_ID)
    ) {
      throw new OtlpProtocolError(`Invalid span parentSpanId: "${span.parentSpanId}"`);
    }
    if (span.endTimeMs < span.startTimeMs) {
      throw new OtlpProtocolError('Span endTimeMs must be >= startTimeMs');
    }
    return {
      traceId: span.traceId,
      spanId: span.spanId,
      ...(span.parentSpanId !== undefined ? { parentSpanId: span.parentSpanId } : {}),
      name: span.name,
      kind: spanKindCode(span.kind),
      startTimeUnixNano: msToUnixNanoString(span.startTimeMs),
      endTimeUnixNano: msToUnixNanoString(span.endTimeMs),
      attributes: encodeAttributes(span.attributes),
      status: {
        code: statusCode(span.status),
        ...(span.statusMessage !== undefined ? { message: span.statusMessage } : {}),
      },
    };
  });

  return {
    resourceSpans: [
      {
        resource: { attributes: resourceAttrs },
        scopeSpans: [
          {
            scope: { name: '@bslt/protocols/otlp', version: '1.0.0' },
            spans: wireSpans,
          },
        ],
      },
    ],
  };
}

export function encodeOtlpMetricsPayload(
  resource: OtlpResourceDescriptor,
  samples: readonly OtlpMetricSample[],
): OtlpMetricsPayload {
  const resourceAttrs = encodeResourceAttributes(resource);
  const metrics = samples.map((sample) => {
    const timeUnixNano = msToUnixNanoString(sample.timeMs);
    const startTimeUnixNano = msToUnixNanoString(sample.startTimeMs ?? sample.timeMs);
    const dataPoint = {
      startTimeUnixNano,
      timeUnixNano,
      asDouble: sample.value,
      attributes: encodeAttributes(sample.attributes),
    };
    if (sample.kind === 'sum') {
      return {
        name: sample.name,
        sum: {
          aggregationTemporality: 2, // AGGREGATION_TEMPORALITY_CUMULATIVE
          isMonotonic: true,
          dataPoints: [dataPoint],
        },
      };
    }
    return {
      name: sample.name,
      gauge: {
        dataPoints: [dataPoint],
      },
    };
  });

  return {
    resourceMetrics: [
      {
        resource: { attributes: resourceAttrs },
        scopeMetrics: [
          {
            scope: { name: '@bslt/protocols/otlp', version: '1.0.0' },
            metrics,
          },
        ],
      },
    ],
  };
}

function normalizeCollectorBaseUrl(endpoint: string): string {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new OtlpProtocolError(`Invalid OTLP collector endpoint URL: "${endpoint}"`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new OtlpProtocolError(
      `Unsupported OTLP collector protocol "${parsed.protocol}" (expected http: or https:)`,
    );
  }
  return endpoint.replace(/\/+$/u, '');
}

function sleepMs(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function createOtlpHttpExporter(options: OtlpExporterOptions): OtlpHttpExporter {
  const baseUrl = normalizeCollectorBaseUrl(options.endpoint);
  if (options.serviceName.trim() === '') {
    throw new OtlpProtocolError('OTLP serviceName must not be empty');
  }
  const maxQueueSize = options.maxQueueSize ?? 2048;
  const maxBatchSize = options.maxBatchSize ?? 256;
  const maxRetries = options.maxRetries ?? 2;
  const retryDelayMs = options.retryDelayMs ?? 100;
  const timeoutMs = options.timeoutMs ?? 5000;
  if (maxQueueSize <= 0 || maxBatchSize <= 0 || timeoutMs <= 0 || maxRetries < 0) {
    throw new OtlpProtocolError(
      'maxQueueSize, maxBatchSize, and timeoutMs must be > 0 and maxRetries >= 0',
    );
  }

  const fetchFn = options.fetchImpl ?? fetch;
  const resource: OtlpResourceDescriptor = {
    serviceName: options.serviceName,
    ...(options.serviceVersion !== undefined ? { serviceVersion: options.serviceVersion } : {}),
    ...(options.resourceAttributes !== undefined ? { attributes: options.resourceAttributes } : {}),
  };

  const queue: OtlpSpanInput[] = [];
  let exportedSpans = 0;
  let droppedSpans = 0;
  let exportedMetrics = 0;
  let failedBatches = 0;
  let closed = false;

  async function postJson(
    pathSuffix: '/v1/traces' | '/v1/metrics',
    body: unknown,
  ): Promise<boolean> {
    const serialized = JSON.stringify(body);
    const url = `${baseUrl}${pathSuffix}`;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...(options.headers ?? {}),
    };

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const res = await fetchFn(url, {
          method: 'POST',
          headers,
          body: serialized,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.ok) {
          return true;
        }
        if (!RETRYABLE_HTTP_STATUSES.has(res.status) || attempt === maxRetries) {
          failedBatches += 1;
          return false;
        }
      } catch {
        if (attempt === maxRetries) {
          failedBatches += 1;
          return false;
        }
      }
      await sleepMs(retryDelayMs * (attempt + 1));
    }
    failedBatches += 1;
    return false;
  }

  return {
    recordSpan(span: OtlpSpanInput): void {
      if (closed) {
        droppedSpans += 1;
        return;
      }
      if (queue.length >= maxQueueSize) {
        queue.shift();
        droppedSpans += 1;
      }
      queue.push(span);
    },

    async exportMetrics(samples: readonly OtlpMetricSample[]): Promise<boolean> {
      if (closed || samples.length === 0) return false;
      const payload = encodeOtlpMetricsPayload(resource, samples);
      const ok = await postJson('/v1/metrics', payload);
      if (ok) {
        exportedMetrics += samples.length;
      }
      return ok;
    },

    async flush(): Promise<void> {
      while (queue.length > 0) {
        const batch = queue.splice(0, maxBatchSize);
        const payload = encodeOtlpTracePayload(resource, batch);
        const ok = await postJson('/v1/traces', payload);
        if (ok) {
          exportedSpans += batch.length;
        }
      }
    },

    async shutdown(): Promise<void> {
      if (closed) return;
      await this.flush();
      closed = true;
    },

    stats(): OtlpExporterStats {
      return {
        queuedSpans: queue.length,
        exportedSpans,
        droppedSpans,
        exportedMetrics,
        failedBatches,
      };
    },
  };
}
