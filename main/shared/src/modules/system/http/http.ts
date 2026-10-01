// main/shared/src/modules/system/http/http.ts
import type { Logger } from '../logger';

// ============================================================================
// Framework-agnostic HTTP request/response contracts
// ============================================================================

export interface HttpRequest {
  body: unknown;
  params: Record<string, string | undefined>;
  query: Record<string, string | string[] | undefined>;
  headers: Record<string, string | string[] | undefined>;
  ip: string;
  method: string;
  url: string;
  correlationId: string;
  log: Logger;
  user?: { userId: string; role: string; [key: string]: unknown };
  cookies?: Record<string, string | undefined>;
}

export interface HttpReply {
  status(code: number): this;
  code(code: number): this;
  send(data: unknown): this;
  header(key: string, value: string): this;
}

// ============================================================================
// Route Result
// ============================================================================

/**
 * Standard route handler result used by the { status, body } response pattern.
 * Consumed by realtime handlers; the registration layer detects this shape at runtime.
 *
 * @typeParam T - The response body type
 */
export interface RouteResult<T = unknown> {
  readonly status: number;
  readonly body: T;
}
