// main/apps/server/src/plugin/multipart.ts
/**
 * Reusable Fastify multipart parser registration.
 */

import { BadRequestError } from '@bslt/shared/system';
import { parseMultipartFile, type ParsedMultipartFile } from '@bslt/shared/system';

import type { FastifyInstance, FastifyRequest } from 'fastify';

export function registerMultipartFormParser(server: FastifyInstance): void {
  server.addContentTypeParser(
    /^multipart\/form-data/i,
    { parseAs: 'buffer' },
    (
      request: FastifyRequest,
      body: Buffer,
      done: (error: Error | null, body?: ParsedMultipartFile | Record<string, never>) => void,
    ) => {
      try {
        const contentType = request.headers['content-type'];
        const value =
          typeof contentType === 'string'
            ? contentType
            : Array.isArray(contentType) && typeof contentType[0] === 'string'
              ? contentType[0]
              : undefined;
        if (value === undefined || value === '') {
          done(new BadRequestError('Missing Content-Type header'));
          return;
        }

        const file = parseMultipartFile(body, value);
        if (file === null) {
          done(null, {});
          return;
        }

        done(null, file);
      } catch {
        done(new BadRequestError('Invalid multipart payload'));
      }
    },
  );
}
