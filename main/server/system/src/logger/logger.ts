// main/server/system/src/logger/logger.ts

import { randomUUID } from 'node:crypto';

import {
  type LogErrorLike,
  type LogEvent,
  type LogLevel,
  type LogMeta,
  type LogRequestContext,
  type Logger,
} from '@bslt/shared/system';
import pino, { type DestinationStream, type Logger as PinoLogger } from 'pino';

import { COLORS, colorize, levelToColor, padLevel, USE_COLOR } from './formatter';

const SENSITIVE_KEYS = [
  'authorization',
  'cookie',
  'set-cookie',
  'password',
  'token',
  'secret',
  'key',
  'apiKey',
];

// Build redact paths: top-level, one level of nesting, and known HTTP header paths.
const REDACT_PATHS: string[] = [
  ...SENSITIVE_KEYS,
  ...SENSITIVE_KEYS.map((k) => `*.${k}`),
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'request.headers.authorization',
  'request.headers.cookie',
];

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

class PinoLoggerWrapper implements Logger {
  constructor(private readonly pinoLogger: PinoLogger) {}

  trace(msgOrMeta: string | LogMeta, metaOrMsg?: LogMeta | string): void {
    if (typeof msgOrMeta === 'string') {
      const meta = typeof metaOrMsg === 'object' ? metaOrMsg : {};
      this.pinoLogger.trace(meta, msgOrMeta);
      return;
    }
    const msg = typeof metaOrMsg === 'string' ? metaOrMsg : undefined;
    this.pinoLogger.trace(msgOrMeta, msg);
  }

  debug(msgOrMeta: string | LogMeta, metaOrMsg?: LogMeta | string): void {
    if (typeof msgOrMeta === 'string') {
      const meta = typeof metaOrMsg === 'object' ? metaOrMsg : {};
      this.pinoLogger.debug(meta, msgOrMeta);
      return;
    }
    const msg = typeof metaOrMsg === 'string' ? metaOrMsg : undefined;
    this.pinoLogger.debug(msgOrMeta, msg);
  }

  info(msgOrMeta: string | LogMeta, metaOrMsg?: LogMeta | string): void {
    if (typeof msgOrMeta === 'string') {
      const meta = typeof metaOrMsg === 'object' ? metaOrMsg : {};
      this.pinoLogger.info(meta, msgOrMeta);
      return;
    }
    const msg = typeof metaOrMsg === 'string' ? metaOrMsg : undefined;
    this.pinoLogger.info(msgOrMeta, msg);
  }

  warn(msgOrMeta: string | LogMeta, metaOrMsg?: LogMeta | string): void {
    if (typeof msgOrMeta === 'string') {
      const meta = typeof metaOrMsg === 'object' ? metaOrMsg : {};
      this.pinoLogger.warn(meta, msgOrMeta);
      return;
    }
    const msg = typeof metaOrMsg === 'string' ? metaOrMsg : undefined;
    this.pinoLogger.warn(msgOrMeta, msg);
  }

  error(
    errOrMetaOrMsg: Error | LogMeta | string,
    msgOrMeta?: string | LogMeta,
    meta?: LogMeta,
  ): void {
    if (errOrMetaOrMsg instanceof Error) {
      const msg = typeof msgOrMeta === 'string' ? msgOrMeta : errOrMetaOrMsg.message;
      const extra = typeof msgOrMeta === 'object' ? msgOrMeta : meta;
      this.pinoLogger.error({ err: serializeError(errOrMetaOrMsg), ...extra }, msg);
      return;
    }
    if (typeof errOrMetaOrMsg === 'string') {
      const extra = typeof msgOrMeta === 'object' ? msgOrMeta : meta;
      this.pinoLogger.error(extra ?? {}, errOrMetaOrMsg);
      return;
    }
    const msg = typeof msgOrMeta === 'string' ? msgOrMeta : undefined;
    this.pinoLogger.error({ ...errOrMetaOrMsg, ...meta }, msg);
  }

  fatal(
    errOrMetaOrMsg: Error | LogMeta | string,
    msgOrMeta?: string | LogMeta,
    meta?: LogMeta,
  ): void {
    if (errOrMetaOrMsg instanceof Error) {
      const msg = typeof msgOrMeta === 'string' ? msgOrMeta : errOrMetaOrMsg.message;
      const extra = typeof msgOrMeta === 'object' ? msgOrMeta : meta;
      this.pinoLogger.fatal({ err: serializeError(errOrMetaOrMsg), ...extra }, msg);
      return;
    }
    if (typeof errOrMetaOrMsg === 'string') {
      const extra = typeof msgOrMeta === 'object' ? msgOrMeta : meta;
      this.pinoLogger.fatal(extra ?? {}, errOrMetaOrMsg);
      return;
    }
    const msg = typeof msgOrMeta === 'string' ? msgOrMeta : undefined;
    this.pinoLogger.fatal({ ...errOrMetaOrMsg, ...meta }, msg);
  }

  child(bindings: LogMeta): Logger {
    return new PinoLoggerWrapper(this.pinoLogger.child(bindings));
  }

  isLevelEnabled(level: LogLevel): boolean {
    return this.pinoLogger.isLevelEnabled(level);
  }
}

export function createLogger(
  configuredLevel: LogLevel = 'info',
  baseBindings: LogMeta = {},
  formatter?: (event: LogEvent) => string,
): Logger {
  const pinoOptions: pino.LoggerOptions = {
    level: configuredLevel,
    base: baseBindings,
    redact: {
      paths: REDACT_PATHS,
      censor: '[REDACTED]',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label): { level: string } => ({ level: label }),
    },
  };

  let destination: DestinationStream | undefined;
  if (formatter !== undefined) {
    destination = {
      write(msg: string): void {
        try {
          const parsed = JSON.parse(msg) as unknown;
          const event = toLogEvent(parsed);
          if (event === undefined) {
            process.stdout.write(msg);
            return;
          }
          process.stdout.write(`${formatter(event)}\n`);
        } catch {
          process.stdout.write(msg);
        }
      },
    };
  }

  const pinoInstance =
    destination === undefined ? pino(pinoOptions) : pino(pinoOptions, destination);
  return new PinoLoggerWrapper(pinoInstance);
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

export function createJobCorrelationId(jobName: string): string {
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
