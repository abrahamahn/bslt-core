// main/kernel/storage/src/providers/s3.test.ts
import { createServer, type ServerResponse } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { StorageError, StorageNotFoundError } from '../errors';

import { S3StorageProvider } from './s3';

import type { S3StorageConfig } from '../types';

async function startServer(
  handler: (req: { method: string; url: string; body: Buffer }, res: ServerResponse) => void,
): Promise<{ endpoint: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      handler(
        {
          method: req.method ?? 'GET',
          url: req.url ?? '/',
          body: Buffer.concat(chunks),
        },
        res,
      );
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  if (addr === null || typeof addr === 'string') {
    throw new Error('Expected TCP address');
  }
  return {
    endpoint: `http://127.0.0.1:${String(addr.port)}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err !== undefined && err !== null ? reject(err) : resolve()));
      }),
  };
}

function makeConfig(endpoint: string, overrides: Partial<S3StorageConfig> = {}): S3StorageConfig {
  return {
    provider: 's3',
    bucket: 'test-bucket',
    region: 'us-east-1',
    endpoint,
    forcePathStyle: true,
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    presignExpiresInSeconds: 900,
    maxFileSize: 10 * 1024 * 1024,
    allowedTypes: ['*'],
    ...overrides,
  };
}

describe('S3StorageProvider over @bslt/protocols/s3', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) {
      const close = cleanups.pop();
      if (close !== undefined) await close();
    }
  });

  it('rejects missing S3 credentials, missing objects (StorageNotFoundError), invalid multipart inputs, and out-of-range presign expiries', async () => {
    const prevKey = process.env['AWS_ACCESS_KEY_ID'];
    const prevSecret = process.env['AWS_SECRET_ACCESS_KEY'];
    delete process.env['AWS_ACCESS_KEY_ID'];
    delete process.env['AWS_SECRET_ACCESS_KEY'];
    try {
      const unconfigured = new S3StorageProvider(
        makeConfig('http://127.0.0.1:9', { accessKeyId: '', secretAccessKey: '' }),
      );
      await expect(unconfigured.getSignedUrl('files/a.bin', 300)).rejects.toThrow(StorageError);
    } finally {
      if (prevKey !== undefined) process.env['AWS_ACCESS_KEY_ID'] = prevKey;
      if (prevSecret !== undefined) process.env['AWS_SECRET_ACCESS_KEY'] = prevSecret;
    }

    const mock = await startServer((_req, res) => {
      res.writeHead(404, { 'content-type': 'application/xml' });
      res.end('<Error><Code>NoSuchKey</Code><Message>No such key</Message></Error>');
    });
    cleanups.push(mock.close);

    const provider = new S3StorageProvider(makeConfig(mock.endpoint));
    await expect(provider.download('files/missing.bin')).rejects.toThrow(StorageNotFoundError);
    await expect(provider.downloadStream('files/missing.bin')).rejects.toThrow(
      StorageNotFoundError,
    );
    await expect(provider.getSignedUrl('files/a.bin', 0)).rejects.toThrow(StorageError);
    await expect(provider.getSignedUploadUrl('files/a.bin', 'image/png', -1)).rejects.toThrow(
      StorageError,
    );
    await expect(provider.completeMultipartUpload('files/a.bin', 'up-1', [])).rejects.toThrow(
      StorageError,
    );
  });

  it('supports upload, head, download, downloadStream, copy, delete, presigned GET/PUT, and multipart sessions', async () => {
    const objects = new Map<string, Buffer>();
    const parts = new Map<number, Buffer>();

    const mock = await startServer((req, res) => {
      const parsed = new URL(req.url, 'http://127.0.0.1');
      const key = decodeURIComponent(parsed.pathname.replace(/^\/test-bucket\//u, ''));

      if (req.method === 'POST' && parsed.searchParams.has('uploads')) {
        parts.clear();
        res.writeHead(200, { 'content-type': 'application/xml' });
        res.end(
          '<InitiateMultipartUploadResult><UploadId>mp-1</UploadId></InitiateMultipartUploadResult>',
        );
        return;
      }
      if (req.method === 'PUT' && parsed.searchParams.has('uploadId')) {
        const pn = Number(parsed.searchParams.get('partNumber'));
        parts.set(pn, req.body);
        res.writeHead(200, { etag: `"etag-${String(pn)}"` });
        res.end();
        return;
      }
      if (req.method === 'GET' && parsed.searchParams.has('uploadId')) {
        const xmlParts = [...parts.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(
            ([pn, buf]) =>
              `<Part><PartNumber>${String(pn)}</PartNumber><ETag>"etag-${String(pn)}"</ETag><Size>${String(buf.length)}</Size></Part>`,
          )
          .join('');
        res.writeHead(200, { 'content-type': 'application/xml' });
        res.end(`<ListPartsResult><IsTruncated>false</IsTruncated>${xmlParts}</ListPartsResult>`);
        return;
      }
      if (req.method === 'POST' && parsed.searchParams.has('uploadId')) {
        const merged = Buffer.concat(
          [...parts.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b),
        );
        objects.set(key, merged);
        res.writeHead(200, { 'content-type': 'application/xml' });
        res.end(
          '<CompleteMultipartUploadResult><ETag>"mp-done"</ETag></CompleteMultipartUploadResult>',
        );
        return;
      }
      if (req.method === 'DELETE' && parsed.searchParams.has('uploadId')) {
        parts.clear();
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.method === 'PUT' && req.body.length === 0) {
        objects.set(key, objects.get('files/u1/hello.txt') ?? Buffer.alloc(0));
        res.writeHead(200, { 'content-type': 'application/xml' });
        res.end('<CopyObjectResult><ETag>"copied"</ETag></CopyObjectResult>');
        return;
      }
      if (req.method === 'PUT') {
        objects.set(key, req.body);
        res.writeHead(200, { etag: '"put-1"' });
        res.end();
        return;
      }
      if (req.method === 'HEAD') {
        const found = objects.get(key);
        if (found === undefined) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, { 'content-length': String(found.length), etag: '"put-1"' });
        res.end();
        return;
      }
      if (req.method === 'GET') {
        const found = objects.get(key);
        if (found === undefined) {
          res.writeHead(404, { 'content-type': 'application/xml' });
          res.end('<Error><Code>NoSuchKey</Code><Message>Not found</Message></Error>');
          return;
        }
        res.writeHead(200, { 'content-length': String(found.length) });
        res.end(found);
        return;
      }
      if (req.method === 'DELETE') {
        objects.delete(key);
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(405);
      res.end();
    });
    cleanups.push(mock.close);

    const provider = new S3StorageProvider(makeConfig(mock.endpoint));
    const storedKey = await provider.upload('/files/u1/hello.txt', 'hello world', 'text/plain');
    expect(storedKey).toBe('files/u1/hello.txt');

    expect(await provider.head('files/u1/hello.txt')).toEqual({
      exists: true,
      sizeBytes: 11,
      etag: '"put-1"',
    });

    const downloaded = await provider.download('files/u1/hello.txt');
    expect(Buffer.from(downloaded).toString('utf8')).toBe('hello world');

    await provider.copy('files/u1/hello.txt', 'files/u1/copy.txt');
    expect(Buffer.from(await provider.download('files/u1/copy.txt')).toString('utf8')).toBe(
      'hello world',
    );

    const signedGet = await provider.getSignedUrl('files/u1/hello.txt', 300);
    expect(signedGet).toContain('X-Amz-Signature=');
    const signedPut = await provider.getSignedUploadUrl('files/u1/direct.bin', 'image/png', 300);
    expect(signedPut).toContain('X-Amz-Signature=');

    const mp = await provider.createMultipartUpload('files/u1/big.bin', 'application/octet-stream');
    expect(mp.uploadId).toBe('mp-1');
    const signedPartUrl = await provider.getSignedPartUploadUrl(
      'files/u1/big.bin',
      mp.uploadId,
      1,
      300,
    );
    expect(signedPartUrl).toContain('partNumber=1');

    const p1 = await provider.uploadPart('files/u1/big.bin', mp.uploadId, 1, Buffer.from('AA'));
    const p2 = await provider.uploadPart('files/u1/big.bin', mp.uploadId, 2, Buffer.from('BB'));
    const listed = await provider.listUploadedParts('files/u1/big.bin', mp.uploadId);
    expect(listed).toHaveLength(2);

    await provider.completeMultipartUpload('files/u1/big.bin', mp.uploadId, [
      { partNumber: 1, etag: p1.etag },
      { partNumber: 2, etag: p2.etag },
    ]);
    expect(Buffer.from(await provider.download('files/u1/big.bin')).toString('utf8')).toBe('AABB');

    await provider.abortMultipartUpload('files/u1/big.bin', mp.uploadId);
    await provider.delete('files/u1/copy.txt');
    expect(await provider.head('files/u1/copy.txt')).toEqual({ exists: false });
  });
});
