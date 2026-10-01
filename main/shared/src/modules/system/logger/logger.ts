// main/shared/src/modules/system/logger/logger.ts

/** Log levels supported by the system. */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

/** Arbitrary metadata to attach to log entries. */
export type LogMeta = Record<string, unknown>;

/** Structured request context for logging. */
export interface LogRequestContext {
  /** Correlation ID for tracing across services */
  correlationId: string;
  /** Unique request ID for the current service */
  requestId: string;
  /** HTTP method */
  method: string;
  /** Request path */
  path: string;
  /** Client IP address */
  ip: string;
  /** Client user agent */
  userAgent?: string | undefined;
  /** Authenticated user ID */
  userId?: string | undefined;
  /** W3C traceparent trace ID (32-char hex), when a traceparent header is present */
  traceId?: string | undefined;
}

/** Error-like object structure for logging. */
export interface LogErrorLike {
  name: string;
  message: string;
  stack?: string | undefined;
  code?: unknown;
  cause?: unknown;
}

/** Represents a single log entry. */
export interface LogEvent {
  /** ISO 8601 timestamp string */
  time: string;
  /** Severity level */
  level: Exclude<LogLevel, 'silent'>;
  /** Log message */
  msg: string;

  // common enterprise fields
  correlationId?: string | undefined;
  requestId?: string | undefined;
  method?: string | undefined;
  path?: string | undefined;

  /** Additional structured metadata */
  meta?: LogMeta | undefined;

  /** Structured error payload */
  err?: LogErrorLike | undefined;

  /** Static bindings (e.g., service name, version) */
  bindings?: LogMeta | undefined;
}

/** Logger interface for consistent logging across the application. */
export interface Logger {
  trace(msgOrMeta: string | LogMeta, metaOrMsg?: LogMeta | string): void;
  debug(msgOrMeta: string | LogMeta, metaOrMsg?: LogMeta | string): void;
  info(msgOrMeta: string | LogMeta, metaOrMsg?: LogMeta | string): void;
  warn(msgOrMeta: string | LogMeta, metaOrMsg?: LogMeta | string): void;

  error(
    errOrMetaOrMsg: Error | LogMeta | string,
    msgOrMeta?: string | LogMeta,
    meta?: LogMeta,
  ): void;
  fatal(
    errOrMetaOrMsg: Error | LogMeta | string,
    msgOrMeta?: string | LogMeta,
    meta?: LogMeta,
  ): void;

  /** Create a child logger with fixed metadata bindings */
  child(bindings: LogMeta): Logger;

  /** Returns true if the given level is enabled on this logger instance */
  isLevelEnabled?(level: LogLevel): boolean;
}
