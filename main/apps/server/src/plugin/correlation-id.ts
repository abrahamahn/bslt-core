// main/apps/server/src/plugin/correlation-id.ts
import {
  generateCorrelationId,
  isValidCorrelationId,
  type HttpServer,
} from '@bslt/server-system/http';

export interface CorrelationIdOptions {
  headerName?: string;
  trustProxy?: boolean;
}

const DEFAULT_HEADER_NAME = 'x-correlation-id';

export function registerCorrelationIdHook(
  app: HttpServer,
  options: CorrelationIdOptions = {},
): void {
  const { headerName = DEFAULT_HEADER_NAME, trustProxy = true } = options;
  const headerNameLower = headerName.toLowerCase();

  app.addHook('onRequest', (req, reply) => {
    let correlationId: string | undefined;

    if (trustProxy) {
      const headerValue = req.headers[headerNameLower];
      if (typeof headerValue === 'string' && isValidCorrelationId(headerValue)) {
        correlationId = headerValue;
      }
    }

    const finalCorrelationId = correlationId ?? generateCorrelationId();
    req.correlationId = finalCorrelationId;
    reply.header(headerName, finalCorrelationId);
  });
}
