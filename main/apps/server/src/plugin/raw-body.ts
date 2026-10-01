// main/apps/server/src/plugin/raw-body.ts
/**
 * Raw request body capture for routes that opt in via `config: { rawBody: true }`.
 *
 * Billing webhook signature verification (Stripe HMAC, PayPal transmission
 * checks) needs the exact bytes the provider signed, but Fastify only exposes
 * the parsed body. This preParsing hook buffers the payload onto
 * `request.rawBody` (empty bodies stay `undefined`) and hands the content-type
 * parser an equivalent replay stream, so normal JSON parsing — including the
 * prototype-pollution guards in `plugin/prototype-pollution.ts` — is unchanged.
 */

import { Readable } from 'node:stream';

import { errorCodes } from 'fastify';

import type { FastifyInstance } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }

  interface FastifyContextConfig {
    rawBody?: boolean;
  }
}

export function registerRawBodyCapture(server: FastifyInstance): void {
  server.addHook('preParsing', (request, _reply, payload, done) => {
    if (request.routeOptions.config.rawBody !== true) {
      done(null, payload);
      return;
    }

    // The body is buffered before the content-type parser enforces its size
    // check, so the route's body limit must be enforced here as well.
    const limit = request.routeOptions.bodyLimit;
    const chunks: Buffer[] = [];
    let received = 0;
    let settled = false;

    const fail = (error: Error): void => {
      settled = true;
      done(error);
    };

    payload.on('data', (chunk: Buffer) => {
      if (settled) return;
      received += chunk.length;
      if (received > limit) {
        fail(new errorCodes.FST_ERR_CTP_BODY_TOO_LARGE());
        return;
      }
      chunks.push(chunk);
    });
    payload.on('error', (error: Error) => {
      if (!settled) fail(error);
    });
    payload.on('end', () => {
      if (settled) return;
      const raw = Buffer.concat(chunks);
      if (raw.length > 0) {
        request.rawBody = raw;
      }
      const replay: Readable & { receivedEncodedLength?: number } = Readable.from([raw]);
      replay.receivedEncodedLength = payload.receivedEncodedLength ?? raw.length;
      done(null, replay);
    });
  });
}
