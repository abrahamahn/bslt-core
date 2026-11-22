// main/apps/server/src/middleware/compression.ts
/**
 * HTTP content coding on `node:zlib` (restructure plan, section 13, A2).
 *
 * Responses are sent br or gzip, as Accept-Encoding allows, when the body is
 * text, JSON or XML of at least 1 KiB. Request bodies sent with a
 * Content-Encoding (br, gzip, deflate or zstd) are inflated before the
 * content-type parser reads them, and the body limit counts both the encoded
 * and the inflated bytes.
 *
 * Both hooks are attached to every route as it is registered, so they run
 * after every application hook: the encoder is the last `onSend` hook (every
 * other one sees the identity payload) and the decoder the first route-level
 * `preParsing` hook. Not-found answers are not routes and stay identity.
 */

import { finished, pipeline, Readable, type Transform } from 'node:stream';
import { promisify } from 'node:util';
import {
  brotliCompress,
  constants,
  createBrotliCompress,
  createBrotliDecompress,
  createGunzip,
  createGzip,
  createInflate,
  createZstdDecompress,
  gzip,
} from 'node:zlib';

import { BadRequestError } from '@bslt/contract';
import {
  httpErrorCodes,
  type HttpRequestPayload,
  type HttpServer,
  type HttpServerReply,
  type HttpServerRequest,
  type PreParsingHookHandler,
} from '@bslt/server-system/http';

type Coding = 'br' | 'gzip';

/** Smaller bodies gain too little to pay for the coding. */
const THRESHOLD_BYTES = 1024;
/** Quality 11 costs far more CPU for a few percent; 4 is the usual on-the-fly level. */
const BROTLI_OPTIONS = { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } };
/** Text (but not an event stream, which must flush per event), JSON and XML. */
const COMPRESSIBLE = /^text\/(?!event-stream)|[/+](?:json|xml)$/u;
/** RFC 9110 qvalue: 0 to 1 with at most three decimals. */
const QVALUE = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/u;
/** No body, a cache revalidation, or byte offsets of the identity body. */
const UNTOUCHED_STATUS = new Set([204, 304, 206]);

const brotli = promisify(brotliCompress);
const gzipBuffer = promisify(gzip);

/**
 * Replies this module encoded. A stream that fails before the encoder wrote a
 * byte is answered again by the error handler, through `onSend` again: that
 * answer must not keep the coding of the abandoned one.
 */
const encodedReplies = new WeakSet<HttpServerReply>();

const DECODERS: Readonly<Record<string, () => Transform>> = {
  br: createBrotliDecompress,
  gzip: createGunzip,
  deflate: createInflate,
  zstd: createZstdDecompress,
};

function quality(parameters: readonly string[]): number {
  const weight = parameters
    .map((parameter) => parameter.trim().toLowerCase())
    .find((parameter) => parameter.startsWith('q='));
  if (weight === undefined) return 1;
  const value = weight.slice(2);
  return QVALUE.test(value) ? Number(value) : 0;
}

/**
 * The coding to send for an Accept-Encoding header: the acceptable one with
 * the highest weight, br on a tie. `x-gzip` is gzip, `*` grants gzip only, and
 * a malformed weight refuses its coding.
 */
export function negotiateEncoding(header: string | undefined): Coding | undefined {
  if (header === undefined) return undefined;
  const weights = new Map<string, number>();
  for (const entry of header.split(',')) {
    const [name = '', ...parameters] = entry.split(';');
    const lowered = name.trim().toLowerCase();
    const coding = lowered === 'x-gzip' ? 'gzip' : lowered;
    weights.set(coding, Math.max(weights.get(coding) ?? 0, quality(parameters)));
  }
  const br = weights.get('br') ?? 0;
  const gzipWeight = weights.get('gzip') ?? weights.get('*') ?? 0;
  if (br === 0 && gzipWeight === 0) return undefined;
  return br >= gzipWeight ? 'br' : 'gzip';
}

function isCompressible(contentType: unknown): boolean {
  if (typeof contentType !== 'string') return false;
  const mediaType = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return COMPRESSIBLE.test(mediaType);
}

function markEncoded(reply: HttpServerReply, coding: Coding): void {
  encodedReplies.add(reply);
  reply.header('content-encoding', coding);
  const vary = reply.getHeader('vary');
  const tokens = String(vary ?? '')
    .split(',')
    .map((token) => token.trim().toLowerCase());
  if (tokens.includes('*') || tokens.includes('accept-encoding')) return;
  reply.header('vary', vary === undefined ? 'Accept-Encoding' : `${String(vary)}, Accept-Encoding`);
}

async function encodeResponse(
  request: HttpServerRequest,
  reply: HttpServerReply,
  payload: unknown,
): Promise<unknown> {
  if (encodedReplies.delete(reply)) reply.removeHeader('content-encoding');
  if (request.method === 'HEAD' || payload === null || payload === undefined) return payload;
  if (
    UNTOUCHED_STATUS.has(reply.statusCode) ||
    reply.hasHeader('content-range') ||
    reply.hasHeader('accept-ranges')
  ) {
    return payload;
  }
  const encoding = reply.getHeader('content-encoding');
  if (encoding !== undefined && encoding !== 'identity') return payload;
  if (!isCompressible(reply.getHeader('content-type'))) return payload;
  const coding = negotiateEncoding(request.headers['accept-encoding']);
  if (coding === undefined) return payload;

  if (typeof payload === 'string' || Buffer.isBuffer(payload)) {
    if (Buffer.byteLength(payload) < THRESHOLD_BYTES) return payload;
    const encoded =
      coding === 'br' ? await brotli(payload, BROTLI_OPTIONS) : await gzipBuffer(payload);
    markEncoded(reply, coding);
    // Fastify sets Content-Length from the encoded buffer.
    return encoded;
  }

  if (payload instanceof Readable) {
    if (Number(reply.getHeader('content-length')) < THRESHOLD_BYTES) return payload;
    const encoder = coding === 'br' ? createBrotliCompress(BROTLI_OPTIONS) : createGzip();
    reply.removeHeader('content-length');
    markEncoded(reply, coding);
    // A source error destroys the encoder with it; Fastify reports the error of the
    // stream it sends, so the callback has nothing to add.
    return pipeline(payload, encoder, () => undefined);
  }

  // A web stream or a Response: sent as it is.
  return payload;
}

/**
 * The inflated body. Lazy: nothing is read or allocated until the body parser
 * reads, which it never does for a method without a body.
 *
 * Past `limit` encoded or inflated bytes the decoder is destroyed and the body
 * fails with a 413: a bomb, or encoded bytes that inflate to nothing, cost no
 * more than an honest body, and the request is not read on. `limit` is the
 * route's body limit, which is Fastify's as long as no content-type parser sets
 * its own, so Fastify's check never fires first. It would stop listening while
 * the decoder ran on, and a later decoder error would be an unhandled 'error'.
 */
async function* inflate(
  payload: HttpRequestPayload,
  createDecoder: () => Transform,
  limit: number,
  reportEncoded: (bytes: number) => void,
): AsyncGenerator<Buffer> {
  const decoder = createDecoder();
  let encodedBytes = 0;
  payload.on('data', (chunk: Buffer) => {
    encodedBytes += chunk.length;
    if (encodedBytes > limit) decoder.destroy(new httpErrorCodes.BODY_TOO_LARGE());
    else reportEncoded(encodedBytes);
  });
  finished(payload, (error) => {
    if (error) decoder.destroy(error);
  });
  // Not `pipeline`: on a refusal it destroys the request and detaches its
  // socket, which the answer's hooks still read (`request.ip`).
  payload.pipe(decoder);
  let inflatedBytes = 0;
  try {
    for await (const chunk of decoder as AsyncIterable<Buffer>) {
      inflatedBytes += chunk.length;
      if (inflatedBytes > limit) throw new httpErrorCodes.BODY_TOO_LARGE();
      yield chunk;
    }
  } catch (error) {
    if (error instanceof httpErrorCodes.BODY_TOO_LARGE) throw error;
    throw new BadRequestError('The request body does not match its Content-Encoding');
  }
}

const inflateRequest: PreParsingHookHandler = (request, _reply, payload, done) => {
  const coding = request.headers['content-encoding']?.trim().toLowerCase();
  // An empty field names no coding (RFC 9110, section 5.6.1.2).
  if (coding === undefined || coding === '' || coding === 'identity') {
    done(null, payload);
    return;
  }
  const createDecoder = Object.hasOwn(DECODERS, coding) ? DECODERS[coding] : undefined;
  if (createDecoder === undefined) {
    done(new httpErrorCodes.INVALID_MEDIA_TYPE());
    return;
  }
  const body: HttpRequestPayload = Readable.from(
    inflate(payload, createDecoder, request.routeOptions.bodyLimit, (bytes) => {
      body.receivedEncodedLength = bytes;
    }),
    { objectMode: false },
  );
  done(null, body);
};

/** Encode responses and inflate request bodies on every route registered after this call. */
export function registerCompression(server: HttpServer): void {
  server.addHook('onRoute', (route) => {
    route.preParsing = [inflateRequest, ...[route.preParsing ?? []].flat()];
    route.onSend = [...[route.onSend ?? []].flat(), encodeResponse];
  });
}
