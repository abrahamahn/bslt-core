// main/apps/server/src/middleware/static.ts
/**
 * Static File Serving
 *
 * Simple static file server for local storage uploads.
 * Replaces @fastify/static with minimal implementation.
 */

import { open } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

import { HTTP_STATUS } from '@bslt/shared/constants';
import { getMimeType } from '@bslt/shared/media';
import { createRateLimiter, getRequesterId } from '@bslt/shared/system';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 240;
const staticRateLimit = createRateLimiter(RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS);

function isRateLimited(requester: string): boolean {
  return !staticRateLimit(requester).allowed;
}

/** Coerce a Fastify header value (string | string[] | undefined) to a single string. */
function asString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function resolveStaticPath(root: string, relativePath: string): string | null {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(resolvedRoot, relativePath);
  if (resolvedPath === resolvedRoot) return null;
  if (!resolvedPath.startsWith(`${resolvedRoot}${sep}`)) return null;
  return resolvedPath;
}

/** A satisfiable byte range, or a sentinel for a syntactically valid but unsatisfiable one. */
type ParsedRange = { start: number; end: number } | 'unsatisfiable' | null;

/**
 * Parse a single HTTP `Range` header against a known resource size.
 *
 * Supports the three single-range forms browsers send for media seeking:
 * `bytes=start-end`, `bytes=start-` (open-ended), and `bytes=-suffix` (last N bytes).
 * Multi-range requests are intentionally treated as "no range" (we serve the full
 * body) since a single media element never needs them.
 *
 * @returns inclusive `{ start, end }`, `'unsatisfiable'` for an out-of-bounds range
 *          (caller should answer 416), or `null` when no usable single range applies.
 * @complexity O(1)
 */
export function parseRangeHeader(rangeHeader: string | undefined, size: number): ParsedRange {
  if (rangeHeader === undefined || !rangeHeader.startsWith('bytes=')) return null;

  const spec = rangeHeader.slice('bytes='.length);
  if (spec.includes(',')) return null; // multi-range: fall back to full body

  const match = /^(\d*)-(\d*)$/u.exec(spec.trim());
  if (match === null) return null;

  const [, startRaw, endRaw] = match;
  if (startRaw === '' && endRaw === '') return null;

  let start: number;
  let end: number;
  if (startRaw === '') {
    // Suffix range: last `endRaw` bytes.
    const suffix = Number(endRaw);
    if (suffix <= 0) return 'unsatisfiable';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startRaw);
    end = endRaw === '' ? size - 1 : Math.min(Number(endRaw), size - 1);
  }

  if (start > end || start >= size) return 'unsatisfiable';
  return { start, end };
}

export interface StaticServeOptions {
  /** Root directory for static files */
  root: string;
  /** URL prefix (e.g., '/uploads/') */
  prefix: string;
  /** Cache max-age in seconds (default: 1 hour) */
  maxAge?: number;
}

/**
 * Register static file serving routes
 *
 * @param server - The Fastify instance to register on
 * @param options - Static serve configuration options
 */
export function registerStaticServe(server: FastifyInstance, options: StaticServeOptions): void {
  const { root, prefix, maxAge = 3600 } = options;

  // Ensure prefix ends with /
  const normalizedPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;

  /**
   * Rate-limiting preHandler. Must be async (or call `done`): a synchronous hook
   * that returns `undefined` never advances the Fastify lifecycle, hanging every
   * request. When the limit is exceeded the 429 reply ends the lifecycle here.
   */
  const rateLimitHandler = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (isRateLimited(getRequesterId(req))) {
      await reply.status(HTTP_STATUS.TOO_MANY_REQUESTS).send({ error: 'Too many requests' });
    }
  };

  // Register route for static files
  server.get(
    `${normalizedPrefix}*`,
    { preHandler: rateLimitHandler },
    async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const params = (req.params ?? {}) as Record<string, unknown>;
      const wildcard = params['*'];
      const fromParams = typeof wildcard === 'string' ? wildcard : undefined;
      const fromUrl = req.url.startsWith(normalizedPrefix)
        ? req.url.slice(normalizedPrefix.length)
        : req.url;
      const relativePath = fromParams ?? fromUrl;

      // Decode URI components (handle %20, etc.)
      let decodedPath: string;
      try {
        decodedPath = decodeURIComponent(relativePath);
      } catch {
        return reply.status(HTTP_STATUS.BAD_REQUEST).send({ error: 'Invalid path encoding' });
      }

      const fullPath = resolveStaticPath(root, decodedPath);
      if (fullPath === null) {
        return reply.status(HTTP_STATUS.FORBIDDEN).send({ error: 'Forbidden' });
      }

      // Open once for a TOCTOU-safe stat, then stream from the same handle.
      let fd: Awaited<ReturnType<typeof open>>;
      try {
        fd = await open(fullPath, 'r');
      } catch (err) {
        const error = err as NodeJS.ErrnoException;
        if (error.code === 'ENOENT') {
          return reply.status(HTTP_STATUS.NOT_FOUND).send({ error: 'Not found' });
        }
        server.log.error({ err, path: fullPath }, 'Static file serve error');
        return reply
          .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
          .send({ error: 'Internal server error' });
      }

      let stats: Awaited<ReturnType<typeof fd.stat>>;
      try {
        stats = await fd.stat();
      } catch (err) {
        await fd.close();
        server.log.error({ err, path: fullPath }, 'Static file serve error');
        return reply
          .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
          .send({ error: 'Internal server error' });
      }

      if (!stats.isFile()) {
        await fd.close();
        return reply.status(HTTP_STATUS.NOT_FOUND).send({ error: 'Not found' });
      }

      // Resolve the requested range before setting content headers: an unsatisfiable
      // range answers with a JSON error and must NOT carry the file's binary
      // Content-Type (Fastify refuses to serialize an object under a non-JSON type).
      const range = parseRangeHeader(asString(req.headers['range']), stats.size);

      if (range === 'unsatisfiable') {
        await fd.close();
        void reply.header('Content-Range', `bytes */${String(stats.size)}`);
        return reply
          .status(HTTP_STATUS.RANGE_NOT_SATISFIABLE)
          .send({ error: 'Range not satisfiable' });
      }

      void reply.header('Content-Type', getMimeType(fullPath));
      void reply.header('Cache-Control', `public, max-age=${String(maxAge)}`);
      void reply.header('Last-Modified', stats.mtime.toUTCString());
      // Advertise range support so media elements enable seeking.
      void reply.header('Accept-Ranges', 'bytes');

      if (range !== null) {
        // Partial content: stream only the requested byte window for media seeking.
        void reply.header(
          'Content-Range',
          `bytes ${String(range.start)}-${String(range.end)}/${String(stats.size)}`,
        );
        void reply.header('Content-Length', range.end - range.start + 1);
        void reply.status(HTTP_STATUS.PARTIAL_CONTENT);
        return reply.send(
          fd.createReadStream({ autoClose: true, start: range.start, end: range.end }),
        );
      }

      void reply.header('Content-Length', stats.size);

      // Stream from the open handle. autoClose closes the handle on 'end'/'error',
      // so the handle is owned solely by the stream from here on (no double close).
      return reply.send(fd.createReadStream({ autoClose: true }));
    },
  );

  server.log.info({ root, prefix: normalizedPrefix }, 'Static file serving registered');
}
