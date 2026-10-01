// main/server/system/src/errors/types.ts

import type { ErrorWire, ErrorStatusCode } from '@bslt/shared/system';

export interface HttpErrorResponse {
  status: ErrorStatusCode;
  wire: ErrorWire;
  retryAfter?: number;
}

export interface ErrorMapperLogger {
  info?: (message: string, context?: Record<string, unknown>) => void;
  warn: (context: Record<string, unknown>, message: string) => void;
  error: (context: unknown, message?: string, meta?: Record<string, unknown>) => void;
}

export interface ErrorMapperOptions {
  isProduction?: boolean;
  logContext?: Record<string, unknown>;
}

export interface ToHttpErrorOptions {
  isProduction?: boolean;
  correlationId?: string;
}
