// main/kernel/server/src/http/http.ts
import type { Logger } from '../logger/types';

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
