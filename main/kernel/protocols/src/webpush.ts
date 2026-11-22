// main/kernel/protocols/src/webpush.ts
/**
 * Owned Web Push protocol implementation (RFC 8291 `aes128gcm` message
 * encryption over RFC 8188 + RFC 8292 VAPID ES256 authentication) built strictly
 * on `node:crypto` and standard `fetch` (restructure plan §13 B2).
 */
import {
  createCipheriv,
  createDecipheriv,
  createECDH,
  createHmac,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign,
  type KeyObject,
} from 'node:crypto';

interface WebPushSubscriptionKeys {
  readonly p256dh: string;
  readonly auth: string;
}

export interface WebPushSubscription {
  readonly endpoint: string;
  readonly keys: WebPushSubscriptionKeys;
}

interface VapidDetails {
  readonly subject: string;
  readonly publicKey: string;
  readonly privateKey: string;
}

interface VapidHeaderOptions {
  readonly nowSeconds?: number;
  /** Token lifetime in seconds (default 12 hours; RFC 8292 caps at 24 hours). */
  readonly expirationSeconds?: number;
}

interface EncryptWebPushOptions {
  readonly salt?: Uint8Array;
  readonly senderPrivateKey?: Uint8Array;
  readonly recordSize?: number;
}

interface EncryptedWebPushPayload {
  readonly body: Buffer;
  readonly salt: Buffer;
  readonly senderPublicKey: Buffer;
  readonly recordSize: number;
}

interface DecryptWebPushOptions {
  readonly receiverPrivateKey: Uint8Array;
  readonly receiverPublicKey: Uint8Array;
  readonly authSecret: Uint8Array;
}

export interface SendWebPushOptions {
  readonly ttl?: number;
  readonly urgency?: 'very-low' | 'low' | 'normal' | 'high';
  readonly topic?: string;
  readonly fetchImpl?: typeof fetch;
}

interface SendWebPushResponse {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export class WebPushProtocolError extends Error {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;

  constructor(
    message: string,
    statusCode: number,
    headers: Readonly<Record<string, string>>,
    body: string,
  ) {
    super(message);
    this.name = 'WebPushProtocolError';
    this.statusCode = statusCode;
    this.headers = headers;
    this.body = body;
  }
}

const DEFAULT_RECORD_SIZE = 4096;
const AES128GCM_HEADER_BYTES = 86; // 16 salt + 4 rs + 1 idlen + 65 P-256 uncompressed key
const GCM_TAG_BYTES = 16;
const MAX_VAPID_EXPIRATION_SECONDS = 86_400;
const DEFAULT_VAPID_EXPIRATION_SECONDS = 43_200;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+={0,2}$/u;

const WEBPUSH_INFO_PREFIX = Buffer.from('WebPush: info\0', 'ascii');
const CEK_INFO = Buffer.from('Content-Encoding: aes128gcm\0', 'ascii');
const NONCE_INFO = Buffer.from('Content-Encoding: nonce\0', 'ascii');

function decodeBase64Url(input: string, label: string): Buffer {
  if (input === '' || !BASE64URL_PATTERN.test(input)) {
    throw new TypeError(`Invalid base64url encoding for ${label}`);
  }
  const unpadded = input.replace(/=+$/u, '');
  if (unpadded.length % 4 === 1) {
    throw new TypeError(`Malformed base64url length for ${label}`);
  }
  return Buffer.from(unpadded, 'base64url');
}

function validateUncompressedP256PublicKey(bytes: Buffer, label: string): void {
  if (bytes.byteLength !== 65 || bytes[0] !== 0x04) {
    throw new TypeError(`${label} must be a 65-byte uncompressed P-256 public key`);
  }
  // Verify the point lies on prime256v1 via OpenSSL JWK import.
  createPublicKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: bytes.subarray(1, 33).toString('base64url'),
      y: bytes.subarray(33, 65).toString('base64url'),
    },
    format: 'jwk',
  });
}

function hkdfExtract(salt: Uint8Array, ikm: Uint8Array): Buffer {
  return createHmac('sha256', salt).update(ikm).digest();
}

function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Buffer {
  if (length <= 0 || length > 32) {
    throw new RangeError('HKDF single-step expand length must be between 1 and 32 bytes');
  }
  return createHmac('sha256', prk)
    .update(info)
    .update(Buffer.from([0x01]))
    .digest()
    .subarray(0, length);
}

function deriveAes128GcmKeyAndNonce(params: {
  readonly sharedSecret: Uint8Array;
  readonly authSecret: Uint8Array;
  readonly receiverPublicKey: Uint8Array;
  readonly senderPublicKey: Uint8Array;
  readonly salt: Uint8Array;
}): { readonly cek: Buffer; readonly nonce: Buffer } {
  const prkKey = hkdfExtract(params.authSecret, params.sharedSecret);
  const keyInfo = Buffer.concat([
    WEBPUSH_INFO_PREFIX,
    Buffer.from(params.receiverPublicKey),
    Buffer.from(params.senderPublicKey),
  ]);
  const ikm = hkdfExpand(prkKey, keyInfo, 32);
  const prk = hkdfExtract(params.salt, ikm);
  const cek = hkdfExpand(prk, CEK_INFO, 16);
  const nonce = hkdfExpand(prk, NONCE_INFO, 12);
  return { cek, nonce };
}

/** Generate a fresh P-256 VAPID keypair encoded as unpadded base64url strings. */
export function generateVapidKeys(): {
  readonly publicKey: string;
  readonly privateKey: string;
} {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const rawPriv = ecdh.getPrivateKey();
  const privPadded =
    rawPriv.byteLength === 32
      ? rawPriv
      : Buffer.concat([Buffer.alloc(32 - rawPriv.byteLength, 0), rawPriv]);
  return {
    publicKey: ecdh.getPublicKey().toString('base64url'),
    privateKey: privPadded.toString('base64url'),
  };
}

function buildVapidPrivateKeyObject(vapid: VapidDetails): {
  readonly privateKeyObj: KeyObject;
  readonly publicKeyB64Url: string;
} {
  const pubBytes = decodeBase64Url(vapid.publicKey, 'VAPID publicKey');
  validateUncompressedP256PublicKey(pubBytes, 'VAPID publicKey');

  const privBytes = decodeBase64Url(vapid.privateKey, 'VAPID privateKey');
  if (privBytes.byteLength !== 32) {
    throw new TypeError('VAPID privateKey must decode to 32 bytes');
  }

  // Verify the private scalar actually derives the supplied public point (d * G == Q).
  const checkEcdh = createECDH('prime256v1');
  checkEcdh.setPrivateKey(privBytes);
  if (!checkEcdh.getPublicKey().equals(pubBytes)) {
    throw new TypeError('VAPID publicKey does not match VAPID privateKey');
  }

  const x = pubBytes.subarray(1, 33).toString('base64url');
  const y = pubBytes.subarray(33, 65).toString('base64url');
  const d = privBytes.toString('base64url');

  const privateKeyObj = createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', x, y, d },
    format: 'jwk',
  });

  return { privateKeyObj, publicKeyB64Url: pubBytes.toString('base64url') };
}

function validateVapidSubject(subject: string): void {
  if (subject === '') {
    throw new TypeError('VAPID subject is required');
  }
  if (subject.startsWith('mailto:')) {
    if (subject.length <= 'mailto:'.length) {
      throw new TypeError('VAPID mailto: subject must include an address');
    }
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(subject);
  } catch {
    throw new TypeError('VAPID subject must be a mailto: or https: URI');
  }
  if (parsed.protocol !== 'https:') {
    throw new TypeError('VAPID URL subject must use https:');
  }
}

function parsePushEndpointOrigin(endpoint: string): string {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new TypeError('Web Push endpoint must be a valid URL');
  }
  const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalhost)) {
    throw new TypeError('Web Push endpoint must use https:');
  }
  return `${url.protocol}//${url.host}`;
}

/** Build an RFC 8292 `vapid t=<jwt>, k=<publicKey>` Authorization header. */
export function createVapidAuthorizationHeader(
  endpoint: string,
  vapid: VapidDetails,
  options: VapidHeaderOptions = {},
): string {
  validateVapidSubject(vapid.subject);
  const audience = parsePushEndpointOrigin(endpoint);
  const expirationSeconds = options.expirationSeconds ?? DEFAULT_VAPID_EXPIRATION_SECONDS;
  if (
    !Number.isInteger(expirationSeconds) ||
    expirationSeconds <= 0 ||
    expirationSeconds > MAX_VAPID_EXPIRATION_SECONDS
  ) {
    throw new RangeError('VAPID expirationSeconds must be between 1 and 86400 seconds');
  }

  const { privateKeyObj, publicKeyB64Url } = buildVapidPrivateKeyObject(vapid);
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);

  const encodedHeader = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' }), 'utf8').toString(
    'base64url',
  );
  const encodedPayload = Buffer.from(
    JSON.stringify({
      aud: audience,
      exp: nowSeconds + expirationSeconds,
      sub: vapid.subject,
    }),
    'utf8',
  ).toString('base64url');

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = sign('sha256', Buffer.from(signingInput, 'ascii'), {
    key: privateKeyObj,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');

  return `vapid t=${signingInput}.${signature}, k=${publicKeyB64Url}`;
}

/** Encrypt a Web Push payload with RFC 8291 (`aes128gcm`). */
export function encryptWebPushPayload(
  plaintext: string | Uint8Array,
  subscriptionKeys: WebPushSubscriptionKeys,
  options: EncryptWebPushOptions = {},
): EncryptedWebPushPayload {
  const uaPublic = decodeBase64Url(subscriptionKeys.p256dh, 'subscription p256dh');
  validateUncompressedP256PublicKey(uaPublic, 'subscription p256dh');

  const authSecret = decodeBase64Url(subscriptionKeys.auth, 'subscription auth');
  if (authSecret.byteLength !== 16) {
    throw new TypeError('Web Push auth secret must decode to exactly 16 bytes (RFC 8291 §3.2)');
  }

  const recordSize = options.recordSize ?? DEFAULT_RECORD_SIZE;
  if (!Number.isInteger(recordSize) || recordSize < AES128GCM_HEADER_BYTES + GCM_TAG_BYTES + 2) {
    throw new RangeError('Invalid aes128gcm recordSize');
  }

  const plaintextBuf =
    typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : Buffer.from(plaintext);
  const maxPlaintextBytes = recordSize - AES128GCM_HEADER_BYTES - GCM_TAG_BYTES - 1;
  if (plaintextBuf.byteLength > maxPlaintextBytes) {
    throw new RangeError(
      `Web Push payload (${String(plaintextBuf.byteLength)} bytes) exceeds maximum ${String(maxPlaintextBytes)} bytes`,
    );
  }

  const salt = options.salt !== undefined ? Buffer.from(options.salt) : randomBytes(16);
  if (salt.byteLength !== 16) {
    throw new TypeError('aes128gcm salt must be 16 bytes');
  }

  const senderEcdh = createECDH('prime256v1');
  if (options.senderPrivateKey !== undefined) {
    senderEcdh.setPrivateKey(Buffer.from(options.senderPrivateKey));
  } else {
    senderEcdh.generateKeys();
  }
  const asPublic = senderEcdh.getPublicKey();
  const sharedSecret = senderEcdh.computeSecret(uaPublic);

  const { cek, nonce } = deriveAes128GcmKeyAndNonce({
    sharedSecret,
    authSecret,
    receiverPublicKey: uaPublic,
    senderPublicKey: asPublic,
    salt,
  });

  // Single final record: plaintext followed by the 0x02 final-record delimiter (RFC 8188 §2).
  const paddedRecord = Buffer.concat([plaintextBuf, Buffer.from([0x02])]);
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(paddedRecord), cipher.final()]);
  const tag = cipher.getAuthTag();

  const header = Buffer.alloc(AES128GCM_HEADER_BYTES);
  salt.copy(header, 0);
  header.writeUInt32BE(recordSize, 16);
  header.writeUInt8(asPublic.byteLength, 20);
  asPublic.copy(header, 21);

  return {
    body: Buffer.concat([header, ciphertext, tag]),
    salt,
    senderPublicKey: asPublic,
    recordSize,
  };
}

/** Decrypt an RFC 8291 (`aes128gcm`) single-record payload (used for conformance verification). */
export function decryptWebPushPayload(
  encryptedBody: Uint8Array,
  options: DecryptWebPushOptions,
): Buffer {
  const buf = Buffer.from(encryptedBody);
  if (buf.byteLength < AES128GCM_HEADER_BYTES + GCM_TAG_BYTES + 1) {
    throw new RangeError('Truncated aes128gcm message');
  }

  const salt = buf.subarray(0, 16);
  const idLen = buf.readUInt8(20);
  if (idLen !== 65 || buf.byteLength < 21 + idLen + GCM_TAG_BYTES + 1) {
    throw new TypeError('Invalid aes128gcm sender keyid length');
  }
  const senderPublicKey = buf.subarray(21, 21 + idLen);
  validateUncompressedP256PublicKey(senderPublicKey, 'aes128gcm sender keyid');

  const receiverPublicKey = Buffer.from(options.receiverPublicKey);
  validateUncompressedP256PublicKey(receiverPublicKey, 'receiver publicKey');

  const receiverEcdh = createECDH('prime256v1');
  receiverEcdh.setPrivateKey(Buffer.from(options.receiverPrivateKey));
  const sharedSecret = receiverEcdh.computeSecret(senderPublicKey);

  const { cek, nonce } = deriveAes128GcmKeyAndNonce({
    sharedSecret,
    authSecret: options.authSecret,
    receiverPublicKey,
    senderPublicKey,
    salt,
  });

  const payloadAndTag = buf.subarray(21 + idLen);
  const ciphertext = payloadAndTag.subarray(0, payloadAndTag.byteLength - GCM_TAG_BYTES);
  const tag = payloadAndTag.subarray(payloadAndTag.byteLength - GCM_TAG_BYTES);

  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(tag);
  const padded = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  // Strip trailing 0x00 padding bytes, then require the 0x02 final-record delimiter.
  let end = padded.byteLength - 1;
  while (end >= 0 && padded[end] === 0x00) {
    end -= 1;
  }
  if (end < 0 || padded[end] !== 0x02) {
    throw new Error('Missing RFC 8188 0x02 final-record delimiter');
  }
  return padded.subarray(0, end);
}

/** Encrypt and POST a Web Push notification to the subscription's push service endpoint. */
export async function sendWebPushNotification(
  subscription: WebPushSubscription,
  payload: string | Uint8Array,
  vapid: VapidDetails,
  options: SendWebPushOptions = {},
): Promise<SendWebPushResponse> {
  const authorization = createVapidAuthorizationHeader(subscription.endpoint, vapid);
  const encrypted = encryptWebPushPayload(payload, subscription.keys);

  const headers: Record<string, string> = {
    Authorization: authorization,
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(encrypted.body.byteLength),
    TTL: String(options.ttl ?? 86_400),
  };
  if (options.urgency !== undefined) {
    headers['Urgency'] = options.urgency;
  }
  if (options.topic !== undefined && options.topic !== '') {
    headers['Topic'] = options.topic;
  }

  const fetchFn = options.fetchImpl ?? fetch;
  const response = await fetchFn(subscription.endpoint, {
    method: 'POST',
    headers,
    body: new Uint8Array(encrypted.body),
  });

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((val, key) => {
    responseHeaders[key] = val;
  });
  const responseBody = await response.text();

  if (response.status < 200 || response.status >= 300) {
    throw new WebPushProtocolError(
      responseBody !== ''
        ? `Web Push failed with HTTP ${String(response.status)}: ${responseBody}`
        : `Web Push failed with HTTP ${String(response.status)}`,
      response.status,
      responseHeaders,
      responseBody,
    );
  }

  return {
    statusCode: response.status,
    headers: responseHeaders,
    body: responseBody,
  };
}
