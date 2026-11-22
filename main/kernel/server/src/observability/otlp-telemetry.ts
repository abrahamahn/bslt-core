// main/kernel/server/src/observability/otlp-telemetry.ts
/**
 * Opt-in OTLP/HTTP server request tracing over `@bslt/protocols/otlp`.
 *
 * Activated strictly when `OTEL_EXPORTER_OTLP_ENDPOINT` is non-empty; default
 * clones with no endpoint configured register zero hooks and incur zero runtime cost.
 */
import {
  OtlpProtocolError,
  createOtlpHttpExporter,
  formatTraceparent,
  generateSpanId,
  generateTraceId,
  parseTraceparent,
  type OtlpHttpExporter,
} from '@bslt/protocols/otlp';

interface TraceableRequest {
  readonly method?: string;
  readonly url?: string;
  readonly headers?: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly routeOptions?: { readonly url?: string };
}

interface TraceableReply {
  readonly statusCode?: number;
  readonly elapsedTime?: number;
  header?(name: string, value: string): unknown;
}

interface HookableServer {
  addHook(name: string, hook: (...args: never[]) => unknown): unknown;
}

interface StartOtlpHttpTelemetryOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetchImpl?: typeof fetch;
  readonly flushThreshold?: number;
}

interface ActiveSpanContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly startTimeMs: number;
}

function parseOtlpHeaders(raw: string | undefined): Record<string, string> | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const headers: Record<string, string> = {};
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (trimmed === '') continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) {
      throw new OtlpProtocolError(
        `Invalid OTEL_EXPORTER_OTLP_HEADERS entry "${trimmed}" (expected "Key=Value")`,
      );
    }
    const key = trimmed.slice(0, eqIndex).trim();
    const val = trimmed.slice(eqIndex + 1).trim();
    if (key === '') {
      throw new OtlpProtocolError('OTEL_EXPORTER_OTLP_HEADERS header name must not be empty');
    }
    headers[key] = val;
  }
  return headers;
}

function readSingleHeader(
  headers: Readonly<Record<string, string | readonly string[] | undefined>> | undefined,
  key: string,
): string | undefined {
  const raw = headers?.[key];
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return typeof raw[0] === 'string' ? raw[0] : undefined;
  return undefined;
}

export function startOtlpHttpTelemetry(
  server: HookableServer,
  options: StartOtlpHttpTelemetryOptions = {},
): OtlpHttpExporter | null {
  const env = options.env ?? process.env;
  const endpoint = env['OTEL_EXPORTER_OTLP_ENDPOINT']?.trim() ?? '';
  if (endpoint === '') {
    return null;
  }

  const serviceName = env['OTEL_SERVICE_NAME']?.trim() || 'bslt-server';
  const headers = parseOtlpHeaders(env['OTEL_EXPORTER_OTLP_HEADERS']);
  const flushThreshold = options.flushThreshold ?? 32;

  const exporter = createOtlpHttpExporter({
    endpoint,
    serviceName,
    ...(headers !== undefined ? { headers } : {}),
    ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
  });

  const activeByRequest = new WeakMap<TraceableRequest, ActiveSpanContext>();

  server.addHook('onRequest', (req: TraceableRequest, reply: TraceableReply, done: () => void) => {
    const incoming = parseTraceparent(readSingleHeader(req.headers, 'traceparent'));
    const traceId = incoming?.traceId ?? generateTraceId();
    const spanId = generateSpanId();
    const spanCtx: ActiveSpanContext = {
      traceId,
      spanId,
      ...(incoming !== null ? { parentSpanId: incoming.spanId } : {}),
      startTimeMs: Date.now(),
    };
    activeByRequest.set(req, spanCtx);
    reply.header?.('traceparent', formatTraceparent({ traceId, spanId, sampled: true }));
    done();
  });

  server.addHook('onResponse', (req: TraceableRequest, reply: TraceableReply, done: () => void) => {
    const spanCtx = activeByRequest.get(req);
    if (spanCtx !== undefined) {
      const durationMs =
        typeof reply.elapsedTime === 'number' && reply.elapsedTime >= 0 ? reply.elapsedTime : 0;
      const endTimeMs = Math.max(spanCtx.startTimeMs, spanCtx.startTimeMs + Math.round(durationMs));
      const statusCode = reply.statusCode ?? 200;
      const route = req.routeOptions?.url ?? req.url ?? 'unmatched';
      const method = req.method ?? 'GET';

      exporter.recordSpan({
        traceId: spanCtx.traceId,
        spanId: spanCtx.spanId,
        ...(spanCtx.parentSpanId !== undefined ? { parentSpanId: spanCtx.parentSpanId } : {}),
        name: `${method} ${route}`,
        kind: 'server',
        startTimeMs: spanCtx.startTimeMs,
        endTimeMs,
        status: statusCode >= 500 ? 'error' : 'ok',
        attributes: {
          'http.method': method,
          'http.route': route,
          'http.status_code': statusCode,
        },
      });

      if (exporter.stats().queuedSpans >= flushThreshold) {
        void exporter.flush();
      }
    }
    done();
  });

  server.addHook('onClose', (_instance: unknown, done: () => void) => {
    void exporter.shutdown().finally(() => {
      done();
    });
  });

  return exporter;
}
