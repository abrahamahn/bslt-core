// main/apps/server/src/types/fastify.d.ts
import type { RequestInfo } from '../plugin/request-info';
import type { AppContext } from '../bootstrap/context';
import type { SupportedLocale } from '../middleware/locale';

declare module 'fastify' {
  interface FastifyRequest {
    /** Resolved locale from the Accept-Language header */
    locale: SupportedLocale;

    /** Unique request identifiers for correlation */
    correlationId: string;

    /** Request info extracted by middleware (IP address, user agent) */
    requestInfo: RequestInfo;

    /** Start time for request timing (bigint from process.hrtime.bigint()) */
    requestStart?: bigint;

    /** Application Context (Hybrid Pattern) */
    context?: AppContext;

    /** Authenticated user identity */
    user?: {
      userId: string;
      email: string;
      role: string;
      tenantId?: string;
    };
  }

  interface FastifyReply {
    /** Generate a new CSRF token (provided by @fastify/csrf-protection) */
    generateCsrf(): string;
  }
}
