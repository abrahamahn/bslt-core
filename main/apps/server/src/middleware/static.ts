// main/apps/server/src/middleware/static.ts
/**
 * Static File Serving
 *
 * File server for local storage uploads. Every request must carry a valid,
 * unexpired HMAC signature issued by the local storage provider (the local
 * equivalent of an S3 presigned GET); there is no unauthenticated path.
 * Replaces @fastify/static with minimal implementation.
 */

import { open } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

import { HTTP_STATUS } from '@bslt/contract';
import {
  getMimeType,
  getRequesterId,
  type HttpServer,
  type HttpServerReply,
  type HttpServerRequest,
} from '@bslt/server-system/http';
import { createSlidingWindowLimiter } from '@bslt/server-system/security';
import {
  deriveStorageUrlKey,
  isServableStorageKey,
  SIGNED_URL_QUERY,
  verifyStorageUrl,
} from '@bslt/storage';

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 240;
const staticRateLimit = createSlidingWindowLimiter(RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS);

function isRateLimited(requester: string): boolean {
  return !staticRateLimit(requester).allowed;
}

/** Coerce a Fastify header value (string | string[] | undefined) to a single string. */
function asString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/** Raw (still-encoded) query value; repeated params stay arrays so verification refuses them. */
function queryValue(query: unknown, name: string): unknown {
  return query !== null && typeof query === 'object'
    ? (query as Record<string, unknown>)[name]
    : undefined;
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

interface StaticServeOptions {
  /** Root directory for static files */
  root: string;
  /** URL prefix (e.g., '/uploads/') */
  prefix: string;
  /**
   * Secret (min 32 chars) the URL-signing key is derived from — the same one the
   * local storage provider signs with (`config.storage.signingSecret`).
   */
  signingSecret: string;
  /** Upper bound for Cache-Control max-age in seconds (default: 1 hour) */
  maxAge?: number;
}

/**
 * Register the signed file-serving route.
 *
 * GET/HEAD `<prefix><key>?expires=<epoch s>&signature=<hex>` serves `<root>/<key>`
 * only when the signature covers exactly this key and expiry and the URL has
 * not expired; anything else is 403 before the filesystem is touched.
 *
 * @param server - The Fastify instance to register on
 * @param options - Static serve configuration options
 * @throws StorageError when the signing secret is shorter than 32 characters
 */
export function registerStaticServe(server: HttpServer, options: StaticServeOptions): void {
  const { root, prefix, signingSecret, maxAge = 3600 } = options;
  const signingKey = deriveStorageUrlKey(signingSecret);

  // Ensure prefix ends with /
  const normalizedPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;

  /**
   * Rate-limiting preHandler. When the limit is exceeded the 429 reply ends the
   * lifecycle here.
   */
  const rateLimitHandler = (req: HttpServerRequest, reply: HttpServerReply): void => {
    if (isRateLimited(getRequesterId(req))) {
      reply.status(HTTP_STATUS.TOO_MANY_REQUESTS).send({ error: 'Too many requests' });
    }
  };

  // Register route for static files
  server.get(
    `${normalizedPrefix}*`,
    { preHandler: rateLimitHandler },
    async (req: HttpServerRequest, reply: HttpServerReply): Promise<void> => {
      // Take the key from the raw URL and decode it exactly once. The router has
      // already decoded `params['*']`; decoding that again would turn `%252e%252e`
      // into `..` and make the signed key differ from the served one.
      const queryStart = req.url.indexOf('?');
      const rawPath = queryStart === -1 ? req.url : req.url.slice(0, queryStart);
      if (!rawPath.startsWith(normalizedPrefix)) {
        reply.status(HTTP_STATUS.FORBIDDEN).send({ error: 'Forbidden' });
        return;
      }

      let key: string;
      try {
        key = decodeURIComponent(rawPath.slice(normalizedPrefix.length));
      } catch {
        reply.status(HTTP_STATUS.BAD_REQUEST).send({ error: 'Invalid path encoding' });
        return;
      }

      // One uniform 403 for traversal and every signature failure: no oracle.
      if (!isServableStorageKey(key)) {
        reply.status(HTTP_STATUS.FORBIDDEN).send({ error: 'Forbidden' });
        return;
      }
      const verdict = verifyStorageUrl(
        {
          method: 'GET', // HEAD is a GET without a body
          key,
          expires: queryValue(req.query, SIGNED_URL_QUERY.expires),
          signature: queryValue(req.query, SIGNED_URL_QUERY.signature),
        },
        signingKey,
      );
      if (!verdict.valid) {
        reply.status(HTTP_STATUS.FORBIDDEN).send({ error: 'Forbidden' });
        return;
      }

      const fullPath = resolveStaticPath(root, key);
      if (fullPath === null) {
        reply.status(HTTP_STATUS.FORBIDDEN).send({ error: 'Forbidden' });
        return;
      }

      // Open once for a TOCTOU-safe stat, then stream from the same handle.
      let fd: Awaited<ReturnType<typeof open>>;
      try {
        fd = await open(fullPath, 'r');
      } catch (err) {
        const error = err as NodeJS.ErrnoException;
        if (error.code === 'ENOENT') {
          reply.status(HTTP_STATUS.NOT_FOUND).send({ error: 'Not found' });
          return;
        }
        server.log.error({ err, path: fullPath }, 'Static file serve error');
        reply.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).send({ error: 'Internal server error' });
        return;
      }

      let stats: Awaited<ReturnType<typeof fd.stat>>;
      try {
        stats = await fd.stat();
      } catch (err) {
        await fd.close();
        server.log.error({ err, path: fullPath }, 'Static file serve error');
        reply.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).send({ error: 'Internal server error' });
        return;
      }

      if (!stats.isFile()) {
        await fd.close();
        reply.status(HTTP_STATUS.NOT_FOUND).send({ error: 'Not found' });
        return;
      }

      // Resolve the requested range before setting content headers: an unsatisfiable
      // range answers with a JSON error and must NOT carry the file's binary
      // Content-Type.
      const range = parseRangeHeader(asString(req.headers['range']), stats.size);

      if (range === 'unsatisfiable') {
        await fd.close();
        reply.header('Content-Range', `bytes */${String(stats.size)}`);
        reply.status(HTTP_STATUS.RANGE_NOT_SATISFIABLE).send({ error: 'Range not satisfiable' });
        return;
      }

      // Private, and never cacheable beyond the signed URL's own lifetime.
      const secondsLeft = verdict.expiresAt - Math.floor(Date.now() / 1000);
      reply.header('Content-Type', getMimeType(fullPath));
      reply.header(
        'Cache-Control',
        `private, max-age=${String(Math.max(0, Math.min(maxAge, secondsLeft)))}`,
      );
      reply.header('Last-Modified', stats.mtime.toUTCString());
      // Advertise range support so media elements enable seeking.
      reply.header('Accept-Ranges', 'bytes');

      if (range !== null) {
        // Partial content: stream only the requested byte window for media seeking.
        reply.header(
          'Content-Range',
          `bytes ${String(range.start)}-${String(range.end)}/${String(stats.size)}`,
        );
        reply.header('Content-Length', range.end - range.start + 1);
        reply.status(HTTP_STATUS.PARTIAL_CONTENT);
        reply.send(fd.createReadStream({ autoClose: true, start: range.start, end: range.end }));
        return;
      }

      reply.header('Content-Length', stats.size);

      // Stream from the open handle. autoClose closes the handle on 'end'/'error',
      // so the handle is owned solely by the stream from here on (no double close).
      reply.send(fd.createReadStream({ autoClose: true }));
    },
  );

  server.log.info({ root, prefix: normalizedPrefix }, 'Static file serving registered');
}
