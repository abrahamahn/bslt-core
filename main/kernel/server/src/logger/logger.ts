// main/kernel/server/src/logger/logger.ts

import { randomUUID } from 'node:crypto';

import { COLORS, colorize, levelToColor, padLevel, USE_COLOR } from './formatter';
import { writeLine } from './stdout';
import {
  LOG_LEVELS,
  SENSITIVE_KEYS,
  type LogErrorLike,
  type LogEvent,
  type LogLevel,
  type LogMeta,
  type LogRequestContext,
  type Logger,
} from './types';

// Binding keys that pino took for child options and never wrote.
const RESERVED_BINDINGS = new Set(['level', 'serializers', 'formatters', 'customLevels']);

const CENSOR = '[REDACTED]';
const CENSOR_JSON = JSON.stringify(CENSOR);
const UNSERIALIZABLE = '[unable to serialize, circular reference is too complex to analyze]';
const UNSERIALIZABLE_JSON = JSON.stringify(UNSERIALIZABLE);
const MAX_DEPTH = 5;

/** A field of a log line: its key and its value already serialized as JSON. */
type Entry = readonly [key: string, json: string];
/** The fields and the message of one log call, after its arguments are read. */
type Call = readonly [fields: LogMeta, msg: unknown];
type ErrorLike = LogMeta & { readonly message: string };

const isRecord = (value: unknown): value is LogMeta => typeof value === 'object' && value !== null;
const asMeta = (value: unknown): LogMeta => (isRecord(value) ? value : {});
const isErrorLike = (value: unknown): value is ErrorLike =>
  isRecord(value) && typeof value['message'] === 'string';

export function serializeError(err: Error): LogErrorLike {
  const withCode = err as Error & { code?: unknown; cause?: unknown };
  return {
    name: err.name,
    message: err.message,
    stack: err.stack,
    code: withCode.code,
    cause: withCode.cause,
  };
}

function colorizePrettyJson(text: string): string {
  return text.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
    (match) => {
      if (match.endsWith(':')) return `${COLORS.cyan}${match}${COLORS.reset}`;
      if (match.startsWith('"')) {
        const raw = match.slice(1, -1).toUpperCase();
        if (['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'].includes(raw)) {
          return colorize(match, levelToColor(raw));
        }
        return `${COLORS.green}${match}${COLORS.reset}`;
      }
      if (match === 'null') return `${COLORS.gray}${match}${COLORS.reset}`;
      if (match === 'true' || match === 'false') return `${COLORS.magenta}${match}${COLORS.reset}`;
      return `${COLORS.yellow}${match}${COLORS.reset}`;
    },
  );
}

function toLogEvent(value: unknown): LogEvent | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const candidate = value as Partial<LogEvent>;
  if (
    typeof candidate.time !== 'string' ||
    typeof candidate.msg !== 'string' ||
    typeof candidate.level !== 'string'
  ) {
    return undefined;
  }
  return candidate as LogEvent;
}

export function developmentFormatter(event: LogEvent): string {
  const timestamp = new Date(event.time).toISOString();
  const levelName = event.level.toUpperCase();
  const levelStr = padLevel(levelName);
  const color = levelToColor(levelName);

  const header = `${colorize(`[${timestamp}]`, 'gray')} ${colorize(levelStr, color)} ${event.msg}`;

  const payload: Record<string, unknown> = {};
  if (event.correlationId !== undefined) payload['correlationId'] = event.correlationId;
  if (event.requestId !== undefined) payload['requestId'] = event.requestId;
  if (event.method !== undefined) payload['method'] = event.method;
  if (event.path !== undefined) payload['path'] = event.path;
  if (event.meta !== undefined && Object.keys(event.meta).length > 0) payload['meta'] = event.meta;
  if (event.err !== undefined) payload['err'] = event.err;

  if (Object.keys(payload).length === 0) return header;

  const pretty = JSON.stringify(payload, null, 2)
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');

  const formattedJson = USE_COLOR ? colorizePrettyJson(pretty) : pretty;
  return `${header}\n${formattedJson}\n`;
}

// ── err serializer: pino-std-serializers 7.1.0, without tagging the error ───

function causeOf(err: ErrorLike): ErrorLike | undefined {
  const cause = err['cause'];
  return isErrorLike(cause) ? cause : undefined;
}

/** `err` followed by its causes, each rendered by `own`; a loop ends with `loop`. */
function withCauses(
  err: ErrorLike,
  own: (err: ErrorLike) => string,
  separator: string,
  loop: string,
  seen = new Set<ErrorLike>(),
): string {
  if (seen.has(err)) return `${own(err)}${loop}`;
  const cause = causeOf(err);
  if (cause === undefined) return own(err);
  seen.add(err);
  return `${own(err)}${separator}${withCauses(cause, own, separator, loop, seen)}`;
}

const messageOwn = (err: ErrorLike): string => err.message;
const stackOwn = (err: ErrorLike): string => (typeof err['stack'] === 'string' ? err['stack'] : '');

function serializeErr(value: unknown, active = new WeakSet<ErrorLike>()): unknown {
  if (!isErrorLike(value) || active.has(value)) return value;
  active.add(value);
  const ctor = value['constructor'];
  const out: LogMeta = {
    type: typeof ctor === 'function' ? ctor.name : value['name'],
    message: withCauses(value, messageOwn, ': ', ': ...'),
    stack: withCauses(value, stackOwn, '\ncaused by: ', '\ncauses have become circular...'),
  };
  const errors = value['errors'];
  if (Array.isArray(errors))
    out['aggregateErrors'] = errors.map((item) => serializeErr(item, active));
  // for-in, as pino does: inherited enumerable keys count; `raw` is reserved by the serializer.
  for (const key in value) {
    if (key === 'raw' || out[key] !== undefined) continue;
    const field = value[key];
    if (!isErrorLike(field)) out[key] = field;
    // Causes are already folded into message and stack.
    else if (key !== 'cause' && !active.has(field)) out[key] = serializeErr(field, active);
  }
  active.delete(value);
  return out;
}

// ── redaction: by name, while serializing, never on the caller's object ─────

/** `Authorization`, `access_token` and `X-CSRF-Token` read as `authorization`, `accesstoken`… */
const normalizeKey = (key: string): string => key.toLowerCase().replace(/[-_]/g, '');
const SENSITIVE = new Set<string>(SENSITIVE_KEYS.map(normalizeKey));
const isSensitive = (key: string): boolean => SENSITIVE.has(normalizeKey(key));

type WithToJson = LogMeta & { readonly toJSON: (key: string) => unknown };
const hasToJson = (value: unknown): value is WithToJson =>
  isRecord(value) && typeof value['toJSON'] === 'function';

/** A copy of `value` with `names` censored, keeping its prototype so that its methods still run. */
function censoredCopy(value: LogMeta, names: readonly string[]): LogMeta {
  // Spread defines properties, so an own `__proto__` key stays a key.
  const copy = { ...value, ...Object.fromEntries(names.map((name) => [name, CENSOR])) };
  Reflect.setPrototypeOf(copy, Reflect.getPrototypeOf(value));
  return copy;
}

/**
 * A JSON.stringify replacer, so a name is censored at any depth and inside arrays. It gets each
 * value after its toJSON ran on the logged object; when that object has listed own fields, its
 * toJSON runs again on a copy with them censored, so one that renames or concatenates a listed
 * field cannot carry it out. What a toJSON returns is censored like any other value.
 */
function censor(this: unknown, key: string, value: unknown): unknown {
  if (isSensitive(key)) return CENSOR;
  const raw = isRecord(this) ? this[key] : undefined;
  if (!hasToJson(raw)) return value;
  const listed = Object.keys(raw).filter(isSensitive);
  return listed.length === 0 ? value : raw.toJSON.call(censoredCopy(raw, listed), key);
}

/** A class instance, such as a live request or reply, rather than data the caller built. */
function isInstance(value: unknown): value is LogMeta {
  if (!isRecord(value) || Array.isArray(value)) return false;
  const proto = Reflect.getPrototypeOf(value);
  return proto !== Object.prototype && proto !== null;
}

// Fastify's req serializer (fastify/lib/logger-pino.js), which a loggerInstance does not get.
function requestSummary(req: LogMeta): LogMeta {
  const headers = req['headers'];
  const socket = req['socket'];
  return {
    method: req['method'],
    url: req['url'],
    version: isRecord(headers) ? headers['accept-version'] : undefined,
    host: req['host'],
    remoteAddress: req['ip'],
    remotePort: isRecord(socket) ? socket['remotePort'] : undefined,
  };
}

// A live request or reply under these keys is summarized, never dumped with its raw headers,
// rawHeaders and socket.
const SUMMARIES = new Map<string, (value: LogMeta) => LogMeta>([
  ['req', requestSummary],
  ['request', requestSummary],
  ['res', (res) => ({ statusCode: res['statusCode'] })],
]);

function summarize(key: string, value: unknown): unknown {
  const summary = SUMMARIES.get(key);
  return summary !== undefined && isInstance(value) ? summary(value) : value;
}

// ── serialization ───────────────────────────────────────────────────────────

/** pino's fallback for what plain JSON rejects: cycles, bigints, and depth past five. */
function boundedReplacer(): (this: unknown, key: string, value: unknown) => unknown {
  const ancestors: unknown[] = [];
  return function bounded(this: unknown, key: string, given: unknown): unknown {
    const value = censor.call(this, key, given);
    if (typeof value === 'bigint') return Number(value);
    if (typeof value !== 'object' || value === null) return value;
    while (ancestors.length > 0 && ancestors.at(-1) !== this) ancestors.pop();
    if (ancestors.includes(value)) return '[Circular]';
    if (ancestors.length >= MAX_DEPTH) return Array.isArray(value) ? '[Array]' : '[Object]';
    ancestors.push(value);
    return value;
  };
}

function toJson(value: unknown): string | undefined {
  try {
    return JSON.stringify(value, censor);
  } catch {
    return JSON.stringify(value, boundedReplacer());
  }
}

/** `holder[key]` as the JSON of a top-level field, or undefined to leave it out. Never throws. */
function fieldJson(holder: LogMeta, key: string): string | undefined {
  try {
    const raw = holder[key];
    const value = key === 'err' ? serializeErr(raw) : raw;
    if (value === undefined || typeof value === 'function') return undefined;
    if (isSensitive(key)) return CENSOR_JSON;
    // pino could not serialize a top-level Buffer; its bytes stay out of the line.
    if (Buffer.isBuffer(value)) return UNSERIALIZABLE_JSON;
    return toJson(summarize(key, value));
  } catch {
    return UNSERIALIZABLE_JSON;
  }
}

function entriesOf(holder: LogMeta, keys: readonly string[]): Entry[] {
  return keys.flatMap((key): Entry[] => {
    const json = fieldJson(holder, key);
    return json === undefined ? [] : [[key, json]];
  });
}

const bindingEntries = (bindings: LogMeta): Entry[] =>
  entriesOf(
    bindings,
    Object.keys(bindings).filter((key) => !RESERVED_BINDINGS.has(key)),
  );

// ── call forms, as the shared Logger and Fastify use them ───────────────────

// pino took an Error object argument as { err }; emit() then takes its message for a missing msg.
const asFields = (value: unknown): LogMeta =>
  value instanceof Error ? { err: value } : asMeta(value);

function logCall(first: unknown, second: unknown): Call {
  if (typeof first === 'string') return [asFields(second), first];
  return [asFields(first), typeof second === 'string' ? second : undefined];
}

function errorCall(first: unknown, second: unknown, third: unknown): Call {
  const extra = typeof second === 'object' ? second : third;
  if (first instanceof Error) {
    const msg = typeof second === 'string' ? second : first.message;
    return [{ err: serializeError(first), ...asMeta(extra) }, msg];
  }
  if (typeof first === 'string') return [asFields(extra), first];
  return [{ ...asMeta(first), ...asMeta(third) }, typeof second === 'string' ? second : undefined];
}

function formatLine(line: string, formatter?: (event: LogEvent) => string): string {
  if (formatter === undefined) return line;
  try {
    const event = toLogEvent(JSON.parse(line) as unknown);
    return event === undefined ? line : formatter(event);
  } catch {
    return line;
  }
}

/**
 * One JSON object per line on stdout: level label, ISO time, bindings, fields, msg. A key that
 * repeats (a child binding, a meta field, a msg in meta) keeps its first position and its last
 * value, as pino's lines read once parsed.
 */
class JsonLogger {
  constructor(
    readonly level: LogLevel,
    private readonly bindings: readonly Entry[],
    private readonly formatter?: (event: LogEvent) => string,
  ) {}

  trace(first: unknown, second?: unknown): void {
    this.emit('trace', first, second);
  }

  debug(first: unknown, second?: unknown): void {
    this.emit('debug', first, second);
  }

  info(first: unknown, second?: unknown): void {
    this.emit('info', first, second);
  }

  warn(first: unknown, second?: unknown): void {
    this.emit('warn', first, second);
  }

  error(first: unknown, second?: unknown, third?: unknown): void {
    this.emit('error', first, second, third);
  }

  fatal(first: unknown, second?: unknown, third?: unknown): void {
    this.emit('fatal', first, second, third);
  }

  silent(_first?: unknown, _second?: unknown): void {
    // Silent level: the call writes nothing.
  }

  child(bindings: LogMeta): JsonLogger {
    return new JsonLogger(
      this.level,
      [...this.bindings, ...bindingEntries(bindings)],
      this.formatter,
    );
  }

  isLevelEnabled(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  private emit(
    level: Exclude<LogLevel, 'silent'>,
    first: unknown,
    second: unknown,
    third?: unknown,
  ): void {
    if (!this.isLevelEnabled(level)) return;
    let line: string;
    try {
      const [fields, given] =
        level === 'error' || level === 'fatal'
          ? errorCall(first, second, third)
          : logCall(first, second);
      const err = fields['err'];
      // pino's rule: with no msg anywhere, an err's message is the line's msg.
      const msg =
        given === undefined && fields['msg'] === undefined && isRecord(err)
          ? err['message']
          : given;
      line = this.render(level, fields, msg);
    } catch {
      // A log call never throws; arguments that cannot even be read leave a marker line.
      line = this.render(level, {}, UNSERIALIZABLE);
    }
    writeLine(formatLine(line, this.formatter));
  }

  private render(level: LogLevel, fields: LogMeta, msg: unknown): string {
    const entries = new Map<string, string>([
      ['level', JSON.stringify(level)],
      ['time', JSON.stringify(new Date().toISOString())],
      ...this.bindings,
      ...entriesOf(fields, Object.keys(fields)),
      ...(msg === undefined ? [] : entriesOf({ msg }, ['msg'])),
    ]);
    return `{${[...entries].map(([key, json]) => `${JSON.stringify(key)}:${json}`).join(',')}}`;
  }
}

export function createLogger(
  configuredLevel: LogLevel = 'info',
  baseBindings: LogMeta = {},
  formatter?: (event: LogEvent) => string,
): JsonLogger {
  return new JsonLogger(configuredLevel, bindingEntries(baseBindings), formatter);
}

export function createRequestLogger(baseLogger: Logger, requestContext: LogRequestContext): Logger {
  const bindings: LogMeta = {
    correlationId: requestContext.correlationId,
    requestId: requestContext.requestId,
    method: requestContext.method,
    path: requestContext.path,
  };
  if (requestContext.traceId !== undefined) bindings['traceId'] = requestContext.traceId;
  return baseLogger.child(bindings);
}

function createJobCorrelationId(jobName: string): string {
  return `job:${jobName}:${randomUUID()}`;
}

export function createJobLogger(baseLogger: Logger, jobName: string, jobId?: string): Logger {
  const correlationId = jobId ?? createJobCorrelationId(jobName);
  return baseLogger.child({
    correlationId,
    requestId: correlationId,
    method: 'JOB',
    path: jobName,
  });
}
