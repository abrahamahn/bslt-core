// main/kernel/protocols/src/s3.test.ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createS3Client,
  deriveSigV4SigningKey,
  presignS3Request,
  S3ProtocolError,
  s3UriEncode,
  signS3Request,
} from './s3';

const AWS_VECTOR_CREDENTIALS = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
} as const;

const AWS_VECTOR_DATE = new Date('2013-05-24T00:00:00.000Z');

interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: IncomingMessage['headers'];
  readonly body: Buffer;
}

async function startMockS3Server(
  handler: (req: RecordedRequest, res: ServerResponse) => void,
): Promise<{
  readonly endpoint: string;
  readonly requests: RecordedRequest[];
  readonly close: () => Promise<void>;
}> {
  const requests: RecordedRequest[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const recorded: RecordedRequest = {
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        headers: req.headers,
        body: Buffer.concat(chunks),
      };
      requests.push(recorded);
      handler(recorded, res);
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  if (addr === null || typeof addr === 'string') {
    throw new Error('Expected TCP server address');
  }

  return {
    endpoint: `http://127.0.0.1:${String(addr.port)}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err !== undefined && err !== null ? reject(err) : resolve()));
      }),
  };
}

describe('@bslt/protocols/s3 — AWS SigV4 official vectors & failure invariants', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      if (fn !== undefined) await fn();
    }
  });

  it('encodes RFC 3986 / SigV4 URI bytes with uppercase hex, preserving unreserved chars and optional slashes', () => {
    expect(s3UriEncode('azAZ09-_.~', true)).toBe('azAZ09-_.~');
    expect(s3UriEncode('hello world/test$file.text', false)).toBe('hello%20world/test%24file.text');
    expect(s3UriEncode('hello world/test$file.text', true)).toBe(
      'hello%20world%2Ftest%24file.text',
    );
  });

  it('matches AWS S3 SigV4 official vector 1: GET Object with Range header', () => {
    const key = deriveSigV4SigningKey(
      AWS_VECTOR_CREDENTIALS.secretAccessKey,
      '20130524',
      'us-east-1',
      's3',
    );
    expect(key.length).toBe(32);

    const signed = signS3Request({
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      region: 'us-east-1',
      credentials: AWS_VECTOR_CREDENTIALS,
      now: AWS_VECTOR_DATE,
      headers: {
        Range: 'bytes=0-9',
      },
      body: new Uint8Array(0),
    });

    expect(signed.headers['x-amz-date']).toBe('20130524T000000Z');
    expect(signed.headers['x-amz-content-sha256']).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(signed.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });

  it('matches AWS S3 SigV4 official vector 2: PUT Object with special path char and payload hash', () => {
    const payload = Buffer.from('Welcome to Amazon S3.', 'utf8');
    const signed = signS3Request({
      method: 'PUT',
      url: 'https://examplebucket.s3.amazonaws.com/test%24file.text',
      region: 'us-east-1',
      credentials: AWS_VECTOR_CREDENTIALS,
      now: AWS_VECTOR_DATE,
      headers: {
        Date: 'Fri, 24 May 2013 00:00:00 GMT',
        'x-amz-storage-class': 'REDUCED_REDUNDANCY',
      },
      body: payload,
    });

    expect(signed.headers['x-amz-content-sha256']).toBe(
      '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072',
    );
    expect(signed.signature).toBe(
      '98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd',
    );
  });

  it('matches AWS S3 SigV4 official vector 3: Presigned GET URL (UNSIGNED-PAYLOAD, 86400s)', () => {
    const presigned = presignS3Request({
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      region: 'us-east-1',
      credentials: AWS_VECTOR_CREDENTIALS,
      expiresInSeconds: 86400,
      now: AWS_VECTOR_DATE,
    });

    const parsed = new URL(presigned);
    expect(parsed.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(parsed.searchParams.get('X-Amz-Credential')).toBe(
      'AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request',
    );
    expect(parsed.searchParams.get('X-Amz-Date')).toBe('20130524T000000Z');
    expect(parsed.searchParams.get('X-Amz-Expires')).toBe('86400');
    expect(parsed.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    expect(parsed.searchParams.get('X-Amz-Signature')).toBe(
      'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
  });

  it('includes X-Amz-Security-Token in canonical query when temporary STS credentials are used', () => {
    const presigned = presignS3Request({
      method: 'PUT',
      url: 'https://examplebucket.s3.amazonaws.com/uploads/part1.bin',
      region: 'us-east-1',
      credentials: {
        ...AWS_VECTOR_CREDENTIALS,
        sessionToken: 'IQoJb3JpZ2luX2VjExampleToken==',
      },
      expiresInSeconds: 900,
      now: AWS_VECTOR_DATE,
    });
    const parsed = new URL(presigned);
    expect(parsed.searchParams.get('X-Amz-Security-Token')).toBe('IQoJb3JpZ2luX2VjExampleToken==');
    expect(parsed.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('rejects missing credentials, invalid region, invalid presign expiry bounds, and empty bucket/key', async () => {
    expect(() =>
      createS3Client({
        region: '',
        credentials: AWS_VECTOR_CREDENTIALS,
      }),
    ).toThrow(S3ProtocolError);

    expect(() =>
      createS3Client({
        region: 'us-east-1',
        credentials: { accessKeyId: '', secretAccessKey: 'secret' },
      }),
    ).toThrow(S3ProtocolError);

    expect(() =>
      presignS3Request({
        method: 'GET',
        url: 'https://examplebucket.s3.amazonaws.com/test.txt',
        region: 'us-east-1',
        credentials: AWS_VECTOR_CREDENTIALS,
        expiresInSeconds: 0,
      }),
    ).toThrow(S3ProtocolError);

    expect(() =>
      presignS3Request({
        method: 'GET',
        url: 'https://examplebucket.s3.amazonaws.com/test.txt',
        region: 'us-east-1',
        credentials: AWS_VECTOR_CREDENTIALS,
        expiresInSeconds: 604801,
      }),
    ).toThrow(S3ProtocolError);

    expect(() =>
      presignS3Request({
        method: 'GET',
        url: 'https://examplebucket.s3.amazonaws.com/test.txt',
        region: 'us-east-1',
        credentials: AWS_VECTOR_CREDENTIALS,
        expiresInSeconds: 3600.5,
      }),
    ).toThrow(S3ProtocolError);

    const client = createS3Client({
      region: 'us-east-1',
      endpoint: 'http://127.0.0.1:9',
      forcePathStyle: true,
      credentials: AWS_VECTOR_CREDENTIALS,
    });

    await expect(
      client.putObject({ bucket: '', key: 'a.txt', body: Buffer.from('x') }),
    ).rejects.toThrow(S3ProtocolError);
    await expect(
      client.putObject({ bucket: 'my-bucket', key: '', body: Buffer.from('x') }),
    ).rejects.toThrow(S3ProtocolError);
    await expect(
      client.uploadPart({
        bucket: 'my-bucket',
        key: 'a.txt',
        uploadId: 'u1',
        partNumber: 0,
        body: Buffer.from('x'),
      }),
    ).rejects.toThrow(S3ProtocolError);
    await expect(
      client.uploadPart({
        bucket: 'my-bucket',
        key: 'a.txt',
        uploadId: 'u1',
        partNumber: 10001,
        body: Buffer.from('x'),
      }),
    ).rejects.toThrow(S3ProtocolError);
    await expect(
      client.completeMultipartUpload({
        bucket: 'my-bucket',
        key: 'a.txt',
        uploadId: 'u1',
        parts: [],
      }),
    ).rejects.toThrow(S3ProtocolError);
  });

  it('maps S3 XML error responses (404 NoSuchKey, 403 AccessDenied) and 200-OK XML error bodies into S3ProtocolError', async () => {
    const mock = await startMockS3Server((req, res) => {
      if (req.url.includes('missing.bin')) {
        res.writeHead(404, { 'content-type': 'application/xml' });
        res.end(
          '<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>',
        );
        return;
      }
      if (req.url.includes('denied.bin')) {
        res.writeHead(403, { 'content-type': 'application/xml' });
        res.end(
          '<?xml version="1.0" encoding="UTF-8"?><Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>',
        );
        return;
      }
      // S3 spec quirk: CopyObject / CompleteMultipartUpload can return HTTP 200 with <Error> XML!
      res.writeHead(200, { 'content-type': 'application/xml' });
      res.end(
        '<?xml version="1.0" encoding="UTF-8"?><Error><Code>InternalError</Code><Message>We encountered an internal error. Please try again.</Message></Error>',
      );
    });
    cleanups.push(mock.close);

    const client = createS3Client({
      region: 'us-east-1',
      endpoint: mock.endpoint,
      forcePathStyle: true,
      credentials: AWS_VECTOR_CREDENTIALS,
    });

    await expect(client.getObject({ bucket: 'bkt', key: 'missing.bin' })).rejects.toMatchObject({
      statusCode: 404,
      s3Code: 'NoSuchKey',
      isNotFound: true,
    });

    const headMissing = await client.headObject({ bucket: 'bkt', key: 'missing.bin' });
    expect(headMissing).toEqual({ exists: false });

    await expect(client.headObject({ bucket: 'bkt', key: 'denied.bin' })).rejects.toMatchObject({
      statusCode: 403,
      isNotFound: false,
    });

    await expect(
      client.copyObject({
        sourceBucket: 'bkt',
        sourceKey: 'src.bin',
        destinationBucket: 'bkt',
        destinationKey: 'dst.bin',
      }),
    ).rejects.toMatchObject({
      s3Code: 'InternalError',
    });

    await expect(
      client.completeMultipartUpload({
        bucket: 'bkt',
        key: 'multipart.bin',
        uploadId: 'up-1',
        parts: [{ partNumber: 1, etag: '"etag-1"' }],
      }),
    ).rejects.toMatchObject({
      s3Code: 'InternalError',
    });
  });

  it('executes PutObject, HeadObject, GetObject (bytes + stream), CopyObject, DeleteObject, and full Multipart lifecycle', async () => {
    const store = new Map<string, { body: Buffer; contentType: string; etag: string }>();
    const multiparts = new Map<string, Map<number, { body: Buffer; etag: string }>>();

    const mock = await startMockS3Server((req, res) => {
      expect(req.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=/u);
      const parsed = new URL(req.url, 'http://127.0.0.1');
      const keyPath = decodeURIComponent(parsed.pathname.replace(/^\/+/u, ''));

      if (req.method === 'POST' && parsed.searchParams.has('uploads')) {
        const uploadId = 'upload-session-123';
        multiparts.set(uploadId, new Map());
        res.writeHead(200, { 'content-type': 'application/xml' });
        res.end(
          `<?xml version="1.0" encoding="UTF-8"?><InitiateMultipartUploadResult><Bucket>bkt</Bucket><Key>${keyPath}</Key><UploadId>${uploadId}</UploadId></InitiateMultipartUploadResult>`,
        );
        return;
      }

      if (req.method === 'PUT' && parsed.searchParams.has('uploadId')) {
        const uploadId = parsed.searchParams.get('uploadId') ?? '';
        const partNumber = Number(parsed.searchParams.get('partNumber'));
        const etag = `"part-etag-${String(partNumber)}"`;
        multiparts.get(uploadId)?.set(partNumber, { body: req.body, etag });
        res.writeHead(200, { etag });
        res.end();
        return;
      }

      if (req.method === 'GET' && parsed.searchParams.has('uploadId')) {
        const uploadId = parsed.searchParams.get('uploadId') ?? '';
        const parts = [...(multiparts.get(uploadId)?.entries() ?? [])].sort((a, b) => a[0] - b[0]);
        const xmlParts = parts
          .map(
            ([num, p]) =>
              `<Part><PartNumber>${String(num)}</PartNumber><ETag>${p.etag}</ETag><Size>${String(p.body.length)}</Size></Part>`,
          )
          .join('');
        res.writeHead(200, { 'content-type': 'application/xml' });
        res.end(
          `<?xml version="1.0" encoding="UTF-8"?><ListPartsResult><IsTruncated>false</IsTruncated>${xmlParts}</ListPartsResult>`,
        );
        return;
      }

      if (req.method === 'POST' && parsed.searchParams.has('uploadId')) {
        const uploadId = parsed.searchParams.get('uploadId') ?? '';
        const parts = [...(multiparts.get(uploadId)?.entries() ?? [])].sort((a, b) => a[0] - b[0]);
        const merged = Buffer.concat(parts.map(([, p]) => p.body));
        store.set(keyPath, {
          body: merged,
          contentType: 'application/octet-stream',
          etag: '"completed-etag"',
        });
        multiparts.delete(uploadId);
        res.writeHead(200, { 'content-type': 'application/xml' });
        res.end(
          `<?xml version="1.0" encoding="UTF-8"?><CompleteMultipartUploadResult><ETag>"completed-etag"</ETag></CompleteMultipartUploadResult>`,
        );
        return;
      }

      if (req.method === 'DELETE' && parsed.searchParams.has('uploadId')) {
        multiparts.delete(parsed.searchParams.get('uploadId') ?? '');
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === 'PUT' && req.headers['x-amz-copy-source'] !== undefined) {
        const copySource = decodeURIComponent(String(req.headers['x-amz-copy-source'])).replace(
          /^\/+/u,
          '',
        );
        const existing = store.get(copySource);
        if (existing === undefined) {
          res.writeHead(404, { 'content-type': 'application/xml' });
          res.end('<Error><Code>NoSuchKey</Code><Message>Missing source</Message></Error>');
          return;
        }
        store.set(keyPath, { ...existing, etag: '"copied-etag"' });
        res.writeHead(200, { 'content-type': 'application/xml' });
        res.end('<CopyObjectResult><ETag>"copied-etag"</ETag></CopyObjectResult>');
        return;
      }

      if (req.method === 'PUT') {
        store.set(keyPath, {
          body: req.body,
          contentType: String(req.headers['content-type'] ?? 'application/octet-stream'),
          etag: '"put-etag"',
        });
        res.writeHead(200, { etag: '"put-etag"' });
        res.end();
        return;
      }

      if (req.method === 'HEAD') {
        const existing = store.get(keyPath);
        if (existing === undefined) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, {
          'content-type': existing.contentType,
          'content-length': String(existing.body.length),
          etag: existing.etag,
        });
        res.end();
        return;
      }

      if (req.method === 'GET') {
        const existing = store.get(keyPath);
        if (existing === undefined) {
          res.writeHead(404, { 'content-type': 'application/xml' });
          res.end('<Error><Code>NoSuchKey</Code><Message>Not found</Message></Error>');
          return;
        }
        res.writeHead(200, {
          'content-type': existing.contentType,
          'content-length': String(existing.body.length),
          etag: existing.etag,
        });
        res.end(existing.body);
        return;
      }

      if (req.method === 'DELETE') {
        store.delete(keyPath);
        res.writeHead(204);
        res.end();
        return;
      }

      res.writeHead(405);
      res.end();
    });
    cleanups.push(mock.close);

    const client = createS3Client({
      region: 'us-east-1',
      endpoint: mock.endpoint,
      forcePathStyle: true,
      credentials: AWS_VECTOR_CREDENTIALS,
    });

    await client.putObject({
      bucket: 'bkt',
      key: 'docs/hello world.txt',
      body: Buffer.from('hello s3'),
      contentType: 'text/plain',
    });

    const head = await client.headObject({ bucket: 'bkt', key: 'docs/hello world.txt' });
    expect(head).toEqual({
      exists: true,
      contentType: 'text/plain',
      contentLength: 8,
      etag: '"put-etag"',
    });

    const got = await client.getObject({ bucket: 'bkt', key: 'docs/hello world.txt' });
    expect(Buffer.from(got.body).toString('utf8')).toBe('hello s3');

    const streamed = await client.getObjectStream({ bucket: 'bkt', key: 'docs/hello world.txt' });
    const reader = streamed.stream.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(next.value);
    }
    reader.releaseLock();
    expect(Buffer.concat(chunks).toString('utf8')).toBe('hello s3');

    await client.copyObject({
      sourceBucket: 'bkt',
      sourceKey: 'docs/hello world.txt',
      destinationBucket: 'bkt',
      destinationKey: 'docs/copied.txt',
    });
    const copied = await client.getObject({ bucket: 'bkt', key: 'docs/copied.txt' });
    expect(Buffer.from(copied.body).toString('utf8')).toBe('hello s3');

    await client.deleteObject({ bucket: 'bkt', key: 'docs/copied.txt' });
    expect(await client.headObject({ bucket: 'bkt', key: 'docs/copied.txt' })).toEqual({
      exists: false,
    });

    // Multipart lifecycle: Create -> UploadPart x2 -> ListParts -> Complete -> Get
    const created = await client.createMultipartUpload({
      bucket: 'bkt',
      key: 'videos/clip.mp4',
      contentType: 'video/mp4',
    });
    expect(created.uploadId).toBe('upload-session-123');

    const p1 = await client.uploadPart({
      bucket: 'bkt',
      key: 'videos/clip.mp4',
      uploadId: created.uploadId,
      partNumber: 1,
      body: Buffer.from('chunk-A-'),
    });
    const p2 = await client.uploadPart({
      bucket: 'bkt',
      key: 'videos/clip.mp4',
      uploadId: created.uploadId,
      partNumber: 2,
      body: Buffer.from('chunk-B'),
    });

    const listed = await client.listParts({
      bucket: 'bkt',
      key: 'videos/clip.mp4',
      uploadId: created.uploadId,
    });
    expect(listed).toEqual({
      isTruncated: false,
      parts: [
        { partNumber: 1, etag: '"part-etag-1"', size: 8 },
        { partNumber: 2, etag: '"part-etag-2"', size: 7 },
      ],
    });

    const completed = await client.completeMultipartUpload({
      bucket: 'bkt',
      key: 'videos/clip.mp4',
      uploadId: created.uploadId,
      parts: [
        { partNumber: 2, etag: p2.etag },
        { partNumber: 1, etag: p1.etag },
      ],
    });
    expect(completed.etag).toBe('"completed-etag"');

    const assembled = await client.getObject({ bucket: 'bkt', key: 'videos/clip.mp4' });
    expect(Buffer.from(assembled.body).toString('utf8')).toBe('chunk-A-chunk-B');

    // Abort multipart lifecycle
    const abortedInit = await client.createMultipartUpload({
      bucket: 'bkt',
      key: 'videos/aborted.mp4',
    });
    await client.abortMultipartUpload({
      bucket: 'bkt',
      key: 'videos/aborted.mp4',
      uploadId: abortedInit.uploadId,
    });

    // Presign helpers
    const presignedGet = client.presignGetObject({
      bucket: 'bkt',
      key: 'videos/clip.mp4',
      expiresInSeconds: 300,
    });
    expect(presignedGet).toContain('X-Amz-Signature=');
    const presignedPut = client.presignPutObject({
      bucket: 'bkt',
      key: 'videos/direct.mp4',
      expiresInSeconds: 300,
    });
    expect(presignedPut).toContain('X-Amz-Signature=');
    const presignedPart = client.presignUploadPart({
      bucket: 'bkt',
      key: 'videos/direct.mp4',
      uploadId: 'u-99',
      partNumber: 3,
      expiresInSeconds: 300,
    });
    expect(presignedPart).toContain('partNumber=3');
    expect(presignedPart).toContain('uploadId=u-99');
  });
});
