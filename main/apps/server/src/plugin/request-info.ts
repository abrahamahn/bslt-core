// main/apps/server/src/plugin/request-info.ts
/**
 * Reusable Fastify request-info hook for server transports.
 */

import { type RequestInfo as SharedRequestInfo } from '@bslt/shared/contracts';
import { extractIpAddress, extractUserAgent } from '@bslt/shared/system';

import type { FastifyInstance } from 'fastify';

export type RequestInfo = SharedRequestInfo;

declare module 'fastify' {
  interface FastifyRequest {
    requestInfo: RequestInfo;
  }
}

export function registerRequestInfoHook(app: FastifyInstance): void {
  app.addHook('onRequest', (req, _reply, done) => {
    const userAgent = extractUserAgent(
      req.headers as Record<string, string | string[] | undefined>,
    );
    const ipAddress = extractIpAddress(req);
    req.requestInfo = {
      ip: ipAddress,
      ipAddress,
      ...(userAgent !== undefined ? { userAgent } : {}),
    };
    done();
  });
}
