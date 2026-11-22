// main/apps/server/src/plugin/prototype-pollution.ts
/**
 * Reusable Fastify JSON parser registration that strips prototype-pollution keys.
 */

import { BadRequestError } from '@bslt/contract';
import {
  sanitizePrototype,
  type HttpServer,
  type HttpServerRequest,
} from '@bslt/server-system/http';

export function registerPrototypePollutionProtection(server: HttpServer): void {
  server.removeContentTypeParser('application/json');

  server.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req: HttpServerRequest, body: string, done: (err: Error | null, body?: unknown) => void) => {
      try {
        if (body === '' || body.trim() === '') {
          done(null, undefined);
          return;
        }

        const parsed: unknown = JSON.parse(body);
        const sanitized = sanitizePrototype(parsed);

        done(null, sanitized);
      } catch {
        done(new BadRequestError('Invalid JSON'));
      }
    },
  );
}
