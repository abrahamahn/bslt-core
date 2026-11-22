// main/apps/server/src/plugin/request-info.ts
/**
 * Reusable Fastify request-info hook for server transports.
 */

import { extractIpAddress, extractUserAgent, type HttpServer } from '@bslt/server-system/http';

export function registerRequestInfoHook(app: HttpServer): void {
  app.addHook('onRequest', (req, _reply, done) => {
    const userAgent = extractUserAgent(req.headers);
    const ipAddress = extractIpAddress(req);
    req.requestInfo = {
      ip: ipAddress,
      ipAddress,
      ...(userAgent !== undefined ? { userAgent } : {}),
    };
    done();
  });
}
