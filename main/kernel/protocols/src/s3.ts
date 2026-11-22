// main/kernel/protocols/src/s3.ts
/**
 * Owned S3 & AWS Signature Version 4 protocol implementation (`@bslt/protocols/s3`),
 * built strictly on `node:crypto` and standard `fetch` (restructure plan §13 B4).
 *
 * Implements:
 * - AWS SigV4 canonical request, signing key derivation, Authorization header signing,
 *   and query-string presigning (`UNSIGNED-PAYLOAD`, up to 7 days)
 * - S3 REST XML operations: `PutObject`, `GetObject` (bytes + stream), `HeadObject`,
 *   `CopyObject`, `DeleteObject`, `CreateMultipartUpload`, `UploadPart`,
 *   `CompleteMultipartUpload`, `AbortMultipartUpload`, and `ListParts`.
 */
import { createHash, createHmac } from 'node:crypto';

const SIGV4_ALGORITHM = 'AWS4-HMAC-SHA256';
const SIGV4_TERMINATOR = 'aws4_request';
const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';
const MAX_PRESIGN_EXPIRES_SECONDS = 7 * 24 * 60 * 60; // 604,800s (7 days)
const MAX_MULTIPART_PART_NUMBER = 10_000;

interface S3Credentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
}

interface S3ClientOptions {
  readonly region: string;
  readonly endpoint?: string;
  readonly forcePathStyle?: boolean;
  readonly credentials?: S3Credentials;
  readonly fetchImpl?: typeof fetch;
}

interface S3UploadedPart {
  readonly partNumber: number;
  readonly etag: string;
  readonly size?: number;
}

export class S3ProtocolError extends Error {
  public readonly statusCode: number;
  public readonly s3Code: string;
  public readonly isNotFound: boolean;
  public readonly key?: string;

  constructor(
    message: string,
    options: {
      readonly statusCode?: number;
      readonly s3Code?: string;
      readonly key?: string;
      readonly cause?: unknown;
    } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'S3ProtocolError';
    this.statusCode = options.statusCode ?? 500;
    this.s3Code = options.s3Code ?? 'S3ProtocolError';
    this.isNotFound =
      this.statusCode === 404 || this.s3Code === 'NoSuchKey' || this.s3Code === 'NotFound';
    if (options.key !== undefined) {
      this.key = options.key;
    }
  }
}

function isUnreservedByte(byte: number): boolean {
  return (
    (byte >= 0x41 && byte <= 0x5a) || // A-Z
    (byte >= 0x61 && byte <= 0x7a) || // a-z
    (byte >= 0x30 && byte <= 0x39) || // 0-9
    byte === 0x2d || // -
    byte === 0x5f || // _
    byte === 0x2e || // .
    byte === 0x7e // ~
  );
}

/**
 * AWS SigV4 URI encoding (RFC 3986 unreserved set; uppercase hex `%XX`; spaces as `%20`).
 */
export function s3UriEncode(input: string, encodeSlash = true): string {
  const bytes = Buffer.from(input, 'utf8');
  let out = '';
  for (const byte of bytes) {
    if (isUnreservedByte(byte) || (!encodeSlash && byte === 0x2f)) {
      out += String.fromCharCode(byte);
    } else {
      out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    }
  }
  return out;
}

function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function formatAmzTimestamps(date: Date): { readonly amzDate: string; readonly dateStamp: string } {
  const iso = date.toISOString(); // YYYY-MM-DDTHH:mm:ss.sssZ
  const amzDate = `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
  return {
    amzDate,
    dateStamp: amzDate.slice(0, 8),
  };
}

/**
 * Derive the 32-byte AWS Signature Version 4 signing key.
 */
export function deriveSigV4SigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service = 's3',
): Buffer {
  const kDate = hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, SIGV4_TERMINATOR);
}

function canonicalHostHeader(url: URL): string {
  const isDefaultPort =
    url.port === '' ||
    (url.protocol === 'https:' && url.port === '443') ||
    (url.protocol === 'http:' && url.port === '80');
  return isDefaultPort ? url.hostname : `${url.hostname}:${url.port}`;
}

function canonicalizeS3Pathname(pathname: string): string {
  if (pathname === '' || pathname === '/') return '/';
  const decodedSegments = pathname.split('/').map((seg) => {
    try {
      return decodeURIComponent(seg);
    } catch {
      return seg;
    }
  });
  return decodedSegments.map((seg) => s3UriEncode(seg, true)).join('/');
}

function buildCanonicalQueryString(entries: ReadonlyArray<readonly [string, string]>): string {
  const encoded = entries.map(
    ([name, value]) => [s3UriEncode(name, true), s3UriEncode(value, true)] as const,
  );
  encoded.sort((a, b) => {
    if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
    if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
    return 0;
  });
  return encoded.map(([k, v]) => `${k}=${v}`).join('&');
}

function normalizeHeaderValue(value: string): string {
  return value.trim().replace(/ +/gu, ' ');
}

function validateCredentials(credentials: S3Credentials): void {
  if (credentials.accessKeyId.trim() === '' || credentials.secretAccessKey.trim() === '') {
    throw new S3ProtocolError('S3 credentials (accessKeyId and secretAccessKey) are required', {
      statusCode: 500,
      s3Code: 'InvalidCredentials',
    });
  }
}

function resolveEnvCredentials(): S3Credentials {
  const accessKeyId = process.env['AWS_ACCESS_KEY_ID'] ?? '';
  const secretAccessKey = process.env['AWS_SECRET_ACCESS_KEY'] ?? '';
  const sessionToken = process.env['AWS_SESSION_TOKEN'];
  return {
    accessKeyId,
    secretAccessKey,
    ...(sessionToken !== undefined && sessionToken !== '' ? { sessionToken } : {}),
  };
}

function toArrayBufferBody(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

interface SignS3RequestInput {
  readonly method: string;
  readonly url: string | URL;
  readonly region: string;
  readonly credentials: S3Credentials;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: Uint8Array | string;
  readonly payloadHash?: string;
  readonly now?: Date;
  readonly service?: string;
}

interface SignedS3Request {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly authorization: string;
  readonly signature: string;
}

/**
 * Sign an HTTP request with AWS Signature Version 4 (`Authorization: AWS4-HMAC-SHA256 ...`).
 */
export function signS3Request(input: SignS3RequestInput): SignedS3Request {
  validateCredentials(input.credentials);
  if (input.region.trim() === '') {
    throw new S3ProtocolError('S3 region must be non-empty', {
      statusCode: 500,
      s3Code: 'InvalidRegion',
    });
  }

  const service = input.service ?? 's3';
  const parsedUrl = typeof input.url === 'string' ? new URL(input.url) : new URL(input.url.href);
  const { amzDate, dateStamp } = formatAmzTimestamps(input.now ?? new Date());
  const payloadHash = input.payloadHash ?? sha256Hex(input.body ?? new Uint8Array(0));

  const lowerHeaders = new Map<string, string>();
  if (input.headers !== undefined) {
    for (const [k, v] of Object.entries(input.headers)) {
      lowerHeaders.set(k.toLowerCase(), normalizeHeaderValue(v));
    }
  }
  lowerHeaders.set('host', canonicalHostHeader(parsedUrl));
  if (!lowerHeaders.has('x-amz-date')) {
    lowerHeaders.set('x-amz-date', amzDate);
  }
  lowerHeaders.set('x-amz-content-sha256', payloadHash);
  if (
    input.credentials.sessionToken !== undefined &&
    input.credentials.sessionToken !== '' &&
    !lowerHeaders.has('x-amz-security-token')
  ) {
    lowerHeaders.set('x-amz-security-token', input.credentials.sessionToken);
  }

  const sortedHeaderNames = [...lowerHeaders.keys()].sort();
  const canonicalHeaders = sortedHeaderNames
    .map((name) => `${name}:${lowerHeaders.get(name) ?? ''}\n`)
    .join('');
  const signedHeaders = sortedHeaderNames.join(';');

  const queryEntries: Array<readonly [string, string]> = [];
  parsedUrl.searchParams.forEach((v, k) => {
    queryEntries.push([k, v]);
  });
  const canonicalUri = canonicalizeS3Pathname(parsedUrl.pathname);
  const canonicalQuery = buildCanonicalQueryString(queryEntries);

  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${input.region}/${service}/${SIGV4_TERMINATOR}`;
  const stringToSign = [
    SIGV4_ALGORITHM,
    lowerHeaders.get('x-amz-date') ?? amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = deriveSigV4SigningKey(
    input.credentials.secretAccessKey,
    dateStamp,
    input.region,
    service,
  );
  const signature = hmacSha256(signingKey, stringToSign).toString('hex');
  const authorization = `${SIGV4_ALGORITHM} Credential=${input.credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const outputHeaders: Record<string, string> = {};
  for (const [k, v] of lowerHeaders.entries()) {
    if (k === 'host') continue;
    outputHeaders[k] = v;
  }
  outputHeaders['authorization'] = authorization;

  const finalUrl = `${parsedUrl.origin}${canonicalUri}${canonicalQuery !== '' ? `?${canonicalQuery}` : ''}`;
  return {
    url: finalUrl,
    headers: outputHeaders,
    authorization,
    signature,
  };
}

interface PresignS3RequestInput {
  readonly method: 'GET' | 'PUT' | 'HEAD' | 'DELETE';
  readonly url: string | URL;
  readonly region: string;
  readonly credentials: S3Credentials;
  readonly expiresInSeconds: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly now?: Date;
  readonly service?: string;
}

/**
 * Generate a SigV4 query-authenticated presigned S3 URL (`UNSIGNED-PAYLOAD`).
 */
export function presignS3Request(input: PresignS3RequestInput): string {
  validateCredentials(input.credentials);
  if (input.region.trim() === '') {
    throw new S3ProtocolError('S3 region must be non-empty', {
      statusCode: 500,
      s3Code: 'InvalidRegion',
    });
  }
  if (
    !Number.isInteger(input.expiresInSeconds) ||
    input.expiresInSeconds <= 0 ||
    input.expiresInSeconds > MAX_PRESIGN_EXPIRES_SECONDS
  ) {
    throw new S3ProtocolError(
      `Presign expiresInSeconds must be an integer in 1..${String(MAX_PRESIGN_EXPIRES_SECONDS)}`,
      { statusCode: 400, s3Code: 'InvalidArgument' },
    );
  }

  const service = input.service ?? 's3';
  const parsedUrl = typeof input.url === 'string' ? new URL(input.url) : new URL(input.url.href);
  const { amzDate, dateStamp } = formatAmzTimestamps(input.now ?? new Date());
  const credentialScope = `${dateStamp}/${input.region}/${service}/${SIGV4_TERMINATOR}`;

  const lowerHeaders = new Map<string, string>();
  if (input.headers !== undefined) {
    for (const [k, v] of Object.entries(input.headers)) {
      lowerHeaders.set(k.toLowerCase(), normalizeHeaderValue(v));
    }
  }
  lowerHeaders.set('host', canonicalHostHeader(parsedUrl));

  const sortedHeaderNames = [...lowerHeaders.keys()].sort();
  const canonicalHeaders = sortedHeaderNames
    .map((name) => `${name}:${lowerHeaders.get(name) ?? ''}\n`)
    .join('');
  const signedHeaders = sortedHeaderNames.join(';');

  const queryEntries: Array<readonly [string, string]> = [];
  parsedUrl.searchParams.forEach((v, k) => {
    queryEntries.push([k, v]);
  });
  queryEntries.push(['X-Amz-Algorithm', SIGV4_ALGORITHM]);
  queryEntries.push(['X-Amz-Credential', `${input.credentials.accessKeyId}/${credentialScope}`]);
  queryEntries.push(['X-Amz-Date', amzDate]);
  queryEntries.push(['X-Amz-Expires', String(input.expiresInSeconds)]);
  if (input.credentials.sessionToken !== undefined && input.credentials.sessionToken !== '') {
    queryEntries.push(['X-Amz-Security-Token', input.credentials.sessionToken]);
  }
  queryEntries.push(['X-Amz-SignedHeaders', signedHeaders]);

  const canonicalUri = canonicalizeS3Pathname(parsedUrl.pathname);
  const canonicalQuery = buildCanonicalQueryString(queryEntries);

  const canonicalRequest = [
    input.method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    UNSIGNED_PAYLOAD,
  ].join('\n');

  const stringToSign = [
    SIGV4_ALGORITHM,
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = deriveSigV4SigningKey(
    input.credentials.secretAccessKey,
    dateStamp,
    input.region,
    service,
  );
  const signature = hmacSha256(signingKey, stringToSign).toString('hex');

  return `${parsedUrl.origin}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

function decodeXmlEntities(text: string): string {
  return text
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function encodeXmlText(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function extractXmlTag(xml: string, tag: string): string | undefined {
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'u');
  const match = regex.exec(xml);
  return match?.[1] !== undefined ? decodeXmlEntities(match[1].trim()) : undefined;
}

function parseXmlErrorIfPresent(
  xml: string,
): { readonly code: string; readonly message: string } | null {
  if (!xml.includes('<Error>') && !xml.includes('<Error ')) return null;
  const code = extractXmlTag(xml, 'Code') ?? 'S3Error';
  const message = extractXmlTag(xml, 'Message') ?? 'S3 error response';
  return { code, message };
}

function isDnsCompatibleBucket(bucket: string, isHttps: boolean): boolean {
  if (bucket.length < 3 || bucket.length > 63) return false;
  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/u.test(bucket)) return false;
  if (bucket.includes('..') || /^\d+\.\d+\.\d+\.\d+$/u.test(bucket)) return false;
  if (isHttps && bucket.includes('.')) return false;
  return true;
}

function validateBucketAndKey(bucket: string, key: string): string {
  if (bucket.trim() === '') {
    throw new S3ProtocolError('S3 bucket name must be non-empty', {
      statusCode: 400,
      s3Code: 'InvalidBucketName',
    });
  }
  const normalizedKey = key.replace(/^\/+/u, '');
  if (normalizedKey === '') {
    throw new S3ProtocolError('S3 object key must be non-empty', {
      statusCode: 400,
      s3Code: 'InvalidKey',
    });
  }
  return normalizedKey;
}

function validatePartNumber(partNumber: number): void {
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > MAX_MULTIPART_PART_NUMBER) {
    throw new S3ProtocolError(
      `Multipart partNumber must be an integer in 1..${String(MAX_MULTIPART_PART_NUMBER)}`,
      { statusCode: 400, s3Code: 'InvalidPart' },
    );
  }
}

export interface S3ProtocolClient {
  putObject(params: {
    readonly bucket: string;
    readonly key: string;
    readonly body: Uint8Array | Buffer | string;
    readonly contentType?: string;
    readonly metadata?: Readonly<Record<string, string>>;
  }): Promise<{ readonly etag?: string }>;

  getObject(params: {
    readonly bucket: string;
    readonly key: string;
    readonly range?: string;
  }): Promise<{
    readonly body: Uint8Array;
    readonly contentType?: string;
    readonly contentLength?: number;
    readonly etag?: string;
  }>;

  getObjectStream(params: {
    readonly bucket: string;
    readonly key: string;
    readonly range?: string;
  }): Promise<{
    readonly stream: ReadableStream<Uint8Array>;
    readonly contentType?: string;
    readonly contentLength?: number;
    readonly etag?: string;
  }>;

  headObject(params: { readonly bucket: string; readonly key: string }): Promise<
    | {
        readonly exists: true;
        readonly contentType?: string;
        readonly contentLength: number;
        readonly etag?: string;
      }
    | { readonly exists: false }
  >;

  copyObject(params: {
    readonly sourceBucket: string;
    readonly sourceKey: string;
    readonly destinationBucket: string;
    readonly destinationKey: string;
    readonly contentType?: string;
  }): Promise<{ readonly etag?: string }>;

  deleteObject(params: { readonly bucket: string; readonly key: string }): Promise<void>;

  createMultipartUpload(params: {
    readonly bucket: string;
    readonly key: string;
    readonly contentType?: string;
    readonly metadata?: Readonly<Record<string, string>>;
  }): Promise<{ readonly uploadId: string }>;

  uploadPart(params: {
    readonly bucket: string;
    readonly key: string;
    readonly uploadId: string;
    readonly partNumber: number;
    readonly body: Uint8Array | Buffer | string;
  }): Promise<{ readonly etag: string }>;

  completeMultipartUpload(params: {
    readonly bucket: string;
    readonly key: string;
    readonly uploadId: string;
    readonly parts: readonly S3UploadedPart[];
  }): Promise<{ readonly etag?: string }>;

  abortMultipartUpload(params: {
    readonly bucket: string;
    readonly key: string;
    readonly uploadId: string;
  }): Promise<void>;

  listParts(params: {
    readonly bucket: string;
    readonly key: string;
    readonly uploadId: string;
    readonly maxParts?: number;
    readonly partNumberMarker?: number;
  }): Promise<{
    readonly parts: S3UploadedPart[];
    readonly isTruncated: boolean;
    readonly nextPartNumberMarker?: number;
  }>;

  presignGetObject(params: {
    readonly bucket: string;
    readonly key: string;
    readonly expiresInSeconds: number;
    readonly responseContentDisposition?: string;
    readonly responseContentType?: string;
    readonly now?: Date;
  }): string;

  presignPutObject(params: {
    readonly bucket: string;
    readonly key: string;
    readonly expiresInSeconds: number;
    readonly contentType?: string;
    readonly now?: Date;
  }): string;

  presignUploadPart(params: {
    readonly bucket: string;
    readonly key: string;
    readonly uploadId: string;
    readonly partNumber: number;
    readonly expiresInSeconds: number;
    readonly now?: Date;
  }): string;
}

/**
 * Create an S3 protocol client over Node `fetch` + AWS Signature Version 4.
 */
export function createS3Client(options: S3ClientOptions): S3ProtocolClient {
  if (options.region.trim() === '') {
    throw new S3ProtocolError('S3 region must be non-empty', {
      statusCode: 500,
      s3Code: 'InvalidRegion',
    });
  }
  if (options.credentials !== undefined) {
    validateCredentials(options.credentials);
  }
  const getCredentials = (): S3Credentials => {
    const resolved = options.credentials ?? resolveEnvCredentials();
    validateCredentials(resolved);
    return resolved;
  };

  const baseEndpoint =
    options.endpoint !== undefined && options.endpoint !== ''
      ? new URL(options.endpoint)
      : new URL(`https://s3.${options.region}.amazonaws.com`);
  const forcePathStyle = options.forcePathStyle ?? false;
  const fetchFn = options.fetchImpl ?? fetch;

  function buildObjectUrl(
    bucket: string,
    key: string,
    query?: ReadonlyArray<readonly [string, string]>,
  ): URL {
    const cleanKey = validateBucketAndKey(bucket, key);
    const encodedKey = cleanKey
      .split('/')
      .map((seg) => s3UriEncode(seg, true))
      .join('/');
    const basePath = baseEndpoint.pathname.replace(/\/+$/u, '');
    const useVirtualHost =
      !forcePathStyle && isDnsCompatibleBucket(bucket, baseEndpoint.protocol === 'https:');

    const url = new URL(baseEndpoint.origin);
    if (useVirtualHost) {
      url.hostname = `${bucket}.${baseEndpoint.hostname}`;
      url.pathname = `${basePath}/${encodedKey}`;
    } else {
      url.pathname = `${basePath}/${s3UriEncode(bucket, true)}/${encodedKey}`;
    }

    if (query !== undefined) {
      for (const [k, v] of query) {
        url.searchParams.append(k, v);
      }
    }
    return url;
  }

  async function sendSigned(params: {
    readonly method: string;
    readonly url: URL;
    readonly headers?: Record<string, string>;
    readonly body?: Uint8Array | Buffer | string;
    readonly keyForError: string;
    readonly allow404?: boolean;
  }): Promise<Response> {
    const bodyBytes =
      params.body === undefined
        ? undefined
        : typeof params.body === 'string'
          ? Buffer.from(params.body, 'utf8')
          : params.body;
    const signed = signS3Request({
      method: params.method,
      url: params.url,
      region: options.region,
      credentials: getCredentials(),
      ...(params.headers !== undefined ? { headers: params.headers } : {}),
      ...(bodyBytes !== undefined ? { body: bodyBytes } : {}),
    });

    let response: Response;
    try {
      response = await fetchFn(signed.url, {
        method: params.method,
        headers: signed.headers,
        ...(bodyBytes !== undefined ? { body: toArrayBufferBody(bodyBytes) } : {}),
      });
    } catch (error) {
      throw new S3ProtocolError(`S3 network error for "${params.keyForError}"`, {
        statusCode: 502,
        s3Code: 'NetworkError',
        key: params.keyForError,
        cause: error,
      });
    }

    if (params.allow404 === true && response.status === 404) {
      return response;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const parsedErr = parseXmlErrorIfPresent(text);
      throw new S3ProtocolError(
        parsedErr?.message ?? `S3 ${params.method} failed with HTTP ${String(response.status)}`,
        {
          statusCode: response.status,
          s3Code: parsedErr?.code ?? (response.status === 404 ? 'NotFound' : 'HttpError'),
          key: params.keyForError,
        },
      );
    }

    return response;
  }

  return {
    async putObject(params) {
      const headers: Record<string, string> = {};
      if (params.contentType !== undefined && params.contentType !== '') {
        headers['content-type'] = params.contentType;
      }
      if (params.metadata !== undefined) {
        for (const [mk, mv] of Object.entries(params.metadata)) {
          headers[`x-amz-meta-${mk.toLowerCase()}`] = mv;
        }
      }
      const url = buildObjectUrl(params.bucket, params.key);
      const res = await sendSigned({
        method: 'PUT',
        url,
        headers,
        body: params.body,
        keyForError: params.key,
      });
      const etag = res.headers.get('etag') ?? undefined;
      await res.arrayBuffer();
      return etag !== undefined ? { etag } : {};
    },

    async getObject(params) {
      const headers: Record<string, string> = {};
      if (params.range !== undefined && params.range !== '') {
        headers['range'] = params.range;
      }
      const url = buildObjectUrl(params.bucket, params.key);
      const res = await sendSigned({
        method: 'GET',
        url,
        headers,
        keyForError: params.key,
      });
      const buf = new Uint8Array(await res.arrayBuffer());
      const contentType = res.headers.get('content-type') ?? undefined;
      const rawLength = res.headers.get('content-length');
      const contentLength = rawLength !== null ? Number(rawLength) : undefined;
      const etag = res.headers.get('etag') ?? undefined;
      return {
        body: buf,
        ...(contentType !== undefined ? { contentType } : {}),
        ...(contentLength !== undefined && Number.isFinite(contentLength) ? { contentLength } : {}),
        ...(etag !== undefined ? { etag } : {}),
      };
    },

    async getObjectStream(params) {
      const headers: Record<string, string> = {};
      if (params.range !== undefined && params.range !== '') {
        headers['range'] = params.range;
      }
      const url = buildObjectUrl(params.bucket, params.key);
      const res = await sendSigned({
        method: 'GET',
        url,
        headers,
        keyForError: params.key,
      });
      if (res.body === null) {
        throw new S3ProtocolError(`Empty S3 response body for "${params.key}"`, {
          statusCode: 500,
          s3Code: 'EmptyBody',
          key: params.key,
        });
      }
      const contentType = res.headers.get('content-type') ?? undefined;
      const rawLength = res.headers.get('content-length');
      const contentLength = rawLength !== null ? Number(rawLength) : undefined;
      const etag = res.headers.get('etag') ?? undefined;
      return {
        stream: res.body,
        ...(contentType !== undefined ? { contentType } : {}),
        ...(contentLength !== undefined && Number.isFinite(contentLength) ? { contentLength } : {}),
        ...(etag !== undefined ? { etag } : {}),
      };
    },

    async headObject(params) {
      const url = buildObjectUrl(params.bucket, params.key);
      const res = await sendSigned({
        method: 'HEAD',
        url,
        keyForError: params.key,
        allow404: true,
      });
      if (res.status === 404) {
        return { exists: false };
      }
      const contentType = res.headers.get('content-type') ?? undefined;
      const contentLength = Number(res.headers.get('content-length') ?? '0');
      const etag = res.headers.get('etag') ?? undefined;
      return {
        exists: true,
        contentLength: Number.isFinite(contentLength) ? contentLength : 0,
        ...(contentType !== undefined ? { contentType } : {}),
        ...(etag !== undefined ? { etag } : {}),
      };
    },

    async copyObject(params) {
      const srcKey = validateBucketAndKey(params.sourceBucket, params.sourceKey);
      const encodedCopySource = `/${s3UriEncode(params.sourceBucket, true)}/${srcKey
        .split('/')
        .map((seg) => s3UriEncode(seg, true))
        .join('/')}`;
      const headers: Record<string, string> = {
        'x-amz-copy-source': encodedCopySource,
      };
      if (params.contentType !== undefined && params.contentType !== '') {
        headers['content-type'] = params.contentType;
      }
      const url = buildObjectUrl(params.destinationBucket, params.destinationKey);
      const res = await sendSigned({
        method: 'PUT',
        url,
        headers,
        keyForError: params.destinationKey,
      });
      const xml = await res.text();
      const xmlErr = parseXmlErrorIfPresent(xml);
      if (xmlErr !== null) {
        throw new S3ProtocolError(xmlErr.message, {
          statusCode: 500,
          s3Code: xmlErr.code,
          key: params.destinationKey,
        });
      }
      const etag = extractXmlTag(xml, 'ETag') ?? res.headers.get('etag') ?? undefined;
      return etag !== undefined ? { etag } : {};
    },

    async deleteObject(params) {
      const url = buildObjectUrl(params.bucket, params.key);
      const res = await sendSigned({
        method: 'DELETE',
        url,
        keyForError: params.key,
        allow404: true,
      });
      await res.arrayBuffer();
    },

    async createMultipartUpload(params) {
      const headers: Record<string, string> = {};
      if (params.contentType !== undefined && params.contentType !== '') {
        headers['content-type'] = params.contentType;
      }
      if (params.metadata !== undefined) {
        for (const [mk, mv] of Object.entries(params.metadata)) {
          headers[`x-amz-meta-${mk.toLowerCase()}`] = mv;
        }
      }
      const url = buildObjectUrl(params.bucket, params.key, [['uploads', '']]);
      const res = await sendSigned({
        method: 'POST',
        url,
        headers,
        keyForError: params.key,
      });
      const xml = await res.text();
      const xmlErr = parseXmlErrorIfPresent(xml);
      if (xmlErr !== null) {
        throw new S3ProtocolError(xmlErr.message, {
          statusCode: 500,
          s3Code: xmlErr.code,
          key: params.key,
        });
      }
      const uploadId = extractXmlTag(xml, 'UploadId');
      if (uploadId === undefined || uploadId === '') {
        throw new S3ProtocolError('S3 InitiateMultipartUpload response missing UploadId', {
          statusCode: 500,
          s3Code: 'MalformedXML',
          key: params.key,
        });
      }
      return { uploadId };
    },

    async uploadPart(params) {
      validatePartNumber(params.partNumber);
      if (params.uploadId.trim() === '') {
        throw new S3ProtocolError('Multipart uploadId must be non-empty', {
          statusCode: 400,
          s3Code: 'InvalidUploadId',
        });
      }
      const url = buildObjectUrl(params.bucket, params.key, [
        ['partNumber', String(params.partNumber)],
        ['uploadId', params.uploadId],
      ]);
      const res = await sendSigned({
        method: 'PUT',
        url,
        body: params.body,
        keyForError: params.key,
      });
      const etag = res.headers.get('etag');
      await res.arrayBuffer();
      if (etag === null || etag === '') {
        throw new S3ProtocolError('S3 UploadPart response missing ETag header', {
          statusCode: 500,
          s3Code: 'MissingETag',
          key: params.key,
        });
      }
      return { etag };
    },

    async completeMultipartUpload(params) {
      if (params.uploadId.trim() === '') {
        throw new S3ProtocolError('Multipart uploadId must be non-empty', {
          statusCode: 400,
          s3Code: 'InvalidUploadId',
        });
      }
      if (params.parts.length === 0) {
        throw new S3ProtocolError('CompleteMultipartUpload requires at least one part', {
          statusCode: 400,
          s3Code: 'InvalidPartOrder',
        });
      }
      for (const part of params.parts) {
        validatePartNumber(part.partNumber);
      }
      const sortedParts = [...params.parts].sort((a, b) => a.partNumber - b.partNumber);
      const xmlBody = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<CompleteMultipartUpload xmlns="http://s3.amazonaws.com/doc/2006-03-01/">',
        ...sortedParts.map(
          (p) =>
            `<Part><PartNumber>${String(p.partNumber)}</PartNumber><ETag>${encodeXmlText(p.etag)}</ETag></Part>`,
        ),
        '</CompleteMultipartUpload>',
      ].join('');

      const url = buildObjectUrl(params.bucket, params.key, [['uploadId', params.uploadId]]);
      const res = await sendSigned({
        method: 'POST',
        url,
        headers: { 'content-type': 'application/xml' },
        body: xmlBody,
        keyForError: params.key,
      });
      const xml = await res.text();
      const xmlErr = parseXmlErrorIfPresent(xml);
      if (xmlErr !== null) {
        throw new S3ProtocolError(xmlErr.message, {
          statusCode: 500,
          s3Code: xmlErr.code,
          key: params.key,
        });
      }
      const etag = extractXmlTag(xml, 'ETag') ?? res.headers.get('etag') ?? undefined;
      return etag !== undefined ? { etag } : {};
    },

    async abortMultipartUpload(params) {
      if (params.uploadId.trim() === '') {
        throw new S3ProtocolError('Multipart uploadId must be non-empty', {
          statusCode: 400,
          s3Code: 'InvalidUploadId',
        });
      }
      const url = buildObjectUrl(params.bucket, params.key, [['uploadId', params.uploadId]]);
      const res = await sendSigned({
        method: 'DELETE',
        url,
        keyForError: params.key,
        allow404: true,
      });
      await res.arrayBuffer();
    },

    async listParts(params) {
      if (params.uploadId.trim() === '') {
        throw new S3ProtocolError('Multipart uploadId must be non-empty', {
          statusCode: 400,
          s3Code: 'InvalidUploadId',
        });
      }
      const query: Array<readonly [string, string]> = [['uploadId', params.uploadId]];
      if (params.maxParts !== undefined) {
        query.push(['max-parts', String(params.maxParts)]);
      }
      if (params.partNumberMarker !== undefined) {
        query.push(['part-number-marker', String(params.partNumberMarker)]);
      }
      const url = buildObjectUrl(params.bucket, params.key, query);
      const res = await sendSigned({
        method: 'GET',
        url,
        keyForError: params.key,
      });
      const xml = await res.text();
      const xmlErr = parseXmlErrorIfPresent(xml);
      if (xmlErr !== null) {
        throw new S3ProtocolError(xmlErr.message, {
          statusCode: 500,
          s3Code: xmlErr.code,
          key: params.key,
        });
      }

      const parts: S3UploadedPart[] = [];
      const partRegex = /<Part>([\s\S]*?)<\/Part>/gu;
      let match: RegExpExecArray | null;
      while ((match = partRegex.exec(xml)) !== null) {
        const block = match[1] ?? '';
        const partNumber = Number(extractXmlTag(block, 'PartNumber') ?? '0');
        const etag = extractXmlTag(block, 'ETag') ?? '';
        const rawSize = extractXmlTag(block, 'Size');
        const size = rawSize !== undefined ? Number(rawSize) : undefined;
        if (partNumber > 0 && etag !== '') {
          parts.push({
            partNumber,
            etag,
            ...(size !== undefined && Number.isFinite(size) ? { size } : {}),
          });
        }
      }
      const isTruncated = extractXmlTag(xml, 'IsTruncated') === 'true';
      const rawNext = extractXmlTag(xml, 'NextPartNumberMarker');
      const nextPartNumberMarker = rawNext !== undefined ? Number(rawNext) : undefined;

      return {
        parts,
        isTruncated,
        ...(isTruncated &&
        nextPartNumberMarker !== undefined &&
        Number.isFinite(nextPartNumberMarker) &&
        nextPartNumberMarker > 0
          ? { nextPartNumberMarker }
          : {}),
      };
    },

    presignGetObject(params) {
      const query: Array<readonly [string, string]> = [];
      if (params.responseContentDisposition !== undefined) {
        query.push(['response-content-disposition', params.responseContentDisposition]);
      }
      if (params.responseContentType !== undefined) {
        query.push(['response-content-type', params.responseContentType]);
      }
      const url = buildObjectUrl(params.bucket, params.key, query);
      return presignS3Request({
        method: 'GET',
        url,
        region: options.region,
        credentials: getCredentials(),
        expiresInSeconds: params.expiresInSeconds,
        ...(params.now !== undefined ? { now: params.now } : {}),
      });
    },

    presignPutObject(params) {
      const url = buildObjectUrl(params.bucket, params.key);
      return presignS3Request({
        method: 'PUT',
        url,
        region: options.region,
        credentials: getCredentials(),
        expiresInSeconds: params.expiresInSeconds,
        ...(params.contentType !== undefined && params.contentType !== ''
          ? { headers: { 'content-type': params.contentType } }
          : {}),
        ...(params.now !== undefined ? { now: params.now } : {}),
      });
    },

    presignUploadPart(params) {
      validatePartNumber(params.partNumber);
      if (params.uploadId.trim() === '') {
        throw new S3ProtocolError('Multipart uploadId must be non-empty', {
          statusCode: 400,
          s3Code: 'InvalidUploadId',
        });
      }
      const url = buildObjectUrl(params.bucket, params.key, [
        ['partNumber', String(params.partNumber)],
        ['uploadId', params.uploadId],
      ]);
      return presignS3Request({
        method: 'PUT',
        url,
        region: options.region,
        credentials: getCredentials(),
        expiresInSeconds: params.expiresInSeconds,
        ...(params.now !== undefined ? { now: params.now } : {}),
      });
    },
  };
}
