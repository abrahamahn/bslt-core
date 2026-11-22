# `@bslt/protocols`

Owned implementations of standard protocols, one subpath each, built only on Node built-ins
(restructure plan, section 4). A subpath arrives with its first consumer and ships its RFC or
conformance vectors in the same change (rule K4).

Subpaths are Node-only. An export has two keys, `types` and `node`, each with `source` (read by
TypeScript, Vitest, tsx and Playwright) before the built file. A browser build sets neither key, so
it cannot resolve the subpath, even with `source` first among its conditions as the web app's Vite
config has. A top-level `source` key would undo this, and `browser: null` does not do it, because
Vite's resolver treats a `null` target as no match and goes on to the next key. ESLint's boundaries
rule also limits importers to `server-core` and `tests`.

## `@bslt/protocols/totp`

TOTP (RFC 6238) over HOTP (RFC 4226), with RFC 4648 base32 secrets and the `otpauth://totp/` key
URI. Verification uses HMAC-SHA-1, six digits and a 30-second step. Tested against the RFC 4226
Appendix D and RFC 6238 Appendix B vectors.

- `createTotpSecret()`: 20 random bytes as 32 base32 symbols.
- `totpCode(secret, { algorithm?, digits?, timestamp? })`: the code at a moment.
- `verifyTotp(secret, token, window)`: the current step and `window` steps either side, compared
  in constant time.
- `totpUri({ issuer, label, secret })`: the URI an authenticator app scans.

## `@bslt/protocols/resp`

RESP2 wire framing, streaming parser, pipelined client, pub/sub subscriber, automatic reconnect
and TLS over `node:net` and `node:tls`. Powers Redis/Valkey cache, rate-limiting and optional
realtime pub/sub without `ioredis`.

## `@bslt/protocols/webpush`

Web Push payload encryption (`aes128gcm`, RFC 8291 / RFC 8188) and VAPID ES256 authentication
headers (RFC 8292) over `node:crypto` and `fetch`. Tested against the RFC 8291 Appendix A
known-answer vector.

## `@bslt/protocols/ws`

RFC 6455 WebSocket handshake, framing, masking, fragmentation, ping/pong, close-code validation,
strict UTF-8 verification and `bufferedAmount` backpressure over `node:http` and `node:crypto`.

## `@bslt/protocols/otlp`

OpenTelemetry Protocol over HTTP/JSON (`/v1/traces` and `/v1/metrics`) and W3C Trace Context v1
(`traceparent`) over `node:crypto` and `fetch`, with bounded queueing, timeout and retry.
