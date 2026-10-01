// main/apps/server/src/plugin/prototype-pollution.ts
/**
 * Reusable Fastify JSON parser registration that strips prototype-pollution keys.
 */

import { sanitizePrototype } from '@bslt/shared/helpers/object';
import { BadRequestError } from '@bslt/shared/system';

import type { FastifyInstance, FastifyRequest } from 'fastify';

export function registerPrototypePollutionProtection(server: FastifyInstance): void {
  server.removeContentTypeParser('application/json');

  server.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req: FastifyRequest, body: string, done: (err: Error | null, body?: unknown) => void) => {
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
